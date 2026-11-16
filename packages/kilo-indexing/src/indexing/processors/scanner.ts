import { stat, readFile } from "fs/promises"
import path from "path"
import { glob } from "glob"
import {
  generateNormalizedAbsolutePath,
  generateRelativeFilePath,
  generateRelativeIgnorePath,
} from "../shared/get-relative-path"
import { scannerExtensions } from "../shared/supported-extensions"
import type { CodeBlock, ICodeParser, IEmbedder, IVectorStore, IDirectoryScanner } from "../interfaces"
import { createHash } from "crypto"
import { v5 as uuidv5 } from "uuid"
import pLimit from "p-limit"
import { Mutex } from "async-mutex"
import { CacheManager } from "../cache-manager"
import {
  QDRANT_CODE_BLOCK_NAMESPACE,
  MAX_FILE_SIZE_BYTES,
  BATCH_SEGMENT_THRESHOLD,
  MAX_BATCH_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  PARSING_CONCURRENCY,
  BATCH_PROCESSING_CONCURRENCY,
  MAX_PENDING_BATCHES,
} from "../constants"
import { FileIgnore } from "../../file/ignore"
import { Log } from "../../util/log"
import { extractStatusCode, sanitizeErrorMessage } from "../shared/validation-helpers"
import type { IndexingTelemetryMeta, IndexingTelemetryMode, IndexingTelemetryReporter } from "../interfaces/telemetry"
import type { IgnoreMatcher } from "../shared/load-ignore"
import { isBinary } from "../shared/is-binary"

const log = Log.create({ service: "indexing-scanner" })

// Deterministic client errors: the provider refuses this exact input, so identical retries cannot succeed.
const REJECTED_STATUSES = new Set([400, 413, 422])

// Text for the one-off request that tells a request-wide rejection (bad model or endpoint) from an oversized input.
const PROBE_TEXT = "probe"

// A cached hash that never equals a real content hash. Files with skipped chunks get it so the next
// scan sees them as changed: old points are deleted before reindexing and removed files are found.
const PARTIAL_HASH_PREFIX = "partial:"

/** A single chunk the embedding provider refused. The rest of its file may still be indexed. */
export class RejectedChunkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RejectedChunkError"
  }
}

type FileInfo = { filePath: string; fileHash: string; isNew: boolean }

/** State shared by all batches of one scan. */
interface ScanRun {
  readonly workspace: string
  readonly mode: IndexingTelemetryMode
  readonly onError?: (error: Error) => void
  readonly onFilesIndexed?: (indexedCount: number) => void
  /** Files with at least one chunk written; each is reported to onFilesIndexed once. */
  readonly indexed: Set<string>
  /** Files with at least one chunk the provider refused. */
  readonly partial: Set<string>
  /** A batch failed for a reason other than a refused chunk, so its files must not be cached. */
  failed: boolean
  /** The provider rejects every request, so there is nothing to split. Set once, reported once. */
  rejectsAll: boolean
  probe?: Promise<boolean>
}

export class DirectoryScanner implements IDirectoryScanner {
  private _cancelled = false
  private batchSegmentThreshold: number
  private maxBatchRetries: number
  private readonly extensions: ReadonlySet<string>

  constructor(
    private readonly embedder: IEmbedder,
    private readonly vectorStore: IVectorStore,
    private readonly codeParser: ICodeParser,
    private readonly cacheManager: CacheManager,
    private readonly ignoreInstance: IgnoreMatcher,
    batchSegmentThreshold?: number,
    maxBatchRetries?: number,
    private readonly onTelemetry?: IndexingTelemetryReporter,
    private readonly telemetryMeta?: IndexingTelemetryMeta,
    extensions: readonly string[] = scannerExtensions,
  ) {
    this.batchSegmentThreshold = batchSegmentThreshold ?? BATCH_SEGMENT_THRESHOLD
    this.maxBatchRetries = maxBatchRetries ?? MAX_BATCH_RETRIES
    this.extensions = new Set(extensions)
  }

  private emitFileCount(mode: IndexingTelemetryMode, discovered: number, candidate: number): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "file_count",
      source: "scan",
      mode,
      discovered,
      candidate,
    })
  }

  private emitRetry(mode: IndexingTelemetryMode, attempt: number, batchSize: number, err: unknown): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "batch_retry",
      source: "scan",
      mode,
      attempt,
      maxRetries: this.maxBatchRetries,
      batchSize,
      error: sanitizeErrorMessage(msg),
    })
  }

  private emitError(mode: IndexingTelemetryMode, location: string, err: unknown, retryCount?: number): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "error",
      source: "scan",
      mode,
      location,
      error: sanitizeErrorMessage(msg),
      retryCount,
      maxRetries: this.maxBatchRetries,
    })
  }

  /**
   * Request cooperative cancellation of any in-flight scanning work.
   * The scanDirectory and batch operations periodically check this flag
   * and will exit as soon as practical.
   */
  public cancel(): void {
    this._cancelled = true
  }

  public get isCancelled(): boolean {
    return this._cancelled
  }

  /**
   * Updates the batch segment threshold
   * @param newThreshold New batch segment threshold value
   */
  public updateBatchSegmentThreshold(newThreshold: number): void {
    this.batchSegmentThreshold = newThreshold
  }

  /**
   * Recursively scans a directory for code blocks in supported files.
   * @param directoryPath The directory to scan
   * @param onError Optional error handler callback
   * @param onBlocksIndexed Optional callback when blocks are indexed
   * @param onFileParsed Optional callback when a file is parsed
   * @returns Promise with processing stats and total block count
   */
  public async scanDirectory(
    directory: string,
    onError?: (error: Error) => void,
    onFilesIndexed?: (indexedCount: number) => void,
    onFileParsed?: () => void,
    mode: IndexingTelemetryMode = "full",
  ): Promise<{ stats: { processed: number; skipped: number }; totalBlockCount: number }> {
    // reset cooperative cancel flag on new full scan
    this._cancelled = false

    const directoryPath = directory
    // Use the directory path directly as the workspace root
    const scanWorkspace = directoryPath
    log.info("starting directory scan", { workspacePath: scanWorkspace })

    // Get all files recursively, filtering out ignored directories via glob
    const allPaths = await glob("**/*", {
      cwd: directoryPath,
      absolute: true,
      nodir: true,
      dot: false,
      ignore: FileIgnore.globs(),
      // Keep ignore matching case-sensitive on every platform. FileIgnore.match()
      // compares path segments exactly, so the macOS/Windows nocase default would
      // prune valid sources (e.g. src/Build/Main.ts) that match() keeps.
      nocase: false,
      maxDepth: Infinity,
    })

    // Filter by supported extensions, ignore patterns, and excluded directories
    const supportedPaths = allPaths.filter((filePath) => {
      const ext = path.extname(filePath).toLowerCase()
      const relativeFilePath = generateRelativeIgnorePath(filePath, scanWorkspace)
      if (!relativeFilePath) {
        return false
      }

      // Check if file is in an ignored directory using FileIgnore
      if (FileIgnore.match(relativeFilePath)) {
        return false
      }

      return this.extensions.has(ext) && !this.ignoreInstance.ignores(relativeFilePath)
    })
    log.info("discovered candidate files for indexing", {
      workspacePath: scanWorkspace,
      discoveredFiles: allPaths.length,
      supportedFiles: supportedPaths.length,
    })
    this.emitFileCount(mode, allPaths.length, supportedPaths.length)

    // Initialize tracking variables
    const processedFiles = new Set<string>()
    let processedCount = 0
    let skippedCount = 0

    // Initialize parallel processing tools
    const parseLimiter = pLimit(PARSING_CONCURRENCY) // Concurrency for file parsing
    const batchLimiter = pLimit(BATCH_PROCESSING_CONCURRENCY) // Concurrency for batch processing
    const mutex = new Mutex()

    // Shared batch accumulators (protected by mutex)
    let currentBatchBlocks: CodeBlock[] = []
    let currentBatchTexts: string[] = []
    let currentBatchFileInfos: FileInfo[] = []
    const batched = new Map<string, string>()
    const run: ScanRun = {
      workspace: scanWorkspace,
      mode,
      onError,
      onFilesIndexed,
      indexed: new Set(),
      partial: new Set(),
      failed: false,
      rejectsAll: false,
    }
    const activeBatchPromises = new Set<Promise<void>>()
    let pendingBatchCount = 0

    // Initialize block counter
    let totalBlockCount = 0

    const queueBatch = async (
      batchBlocks: CodeBlock[],
      batchTexts: string[],
      batchFileInfos: FileInfo[],
    ): Promise<void> => {
      while (!this._cancelled) {
        const release = await mutex.acquire()
        let wait: Promise<void> | null = null

        try {
          if (pendingBatchCount < MAX_PENDING_BATCHES) {
            pendingBatchCount++

            const batchPromise = batchLimiter(() => this.processBatch(run, batchBlocks, batchTexts, batchFileInfos))
            activeBatchPromises.add(batchPromise)

            // Clean up completed promises to prevent memory accumulation
            batchPromise.finally(() => {
              activeBatchPromises.delete(batchPromise)
              pendingBatchCount--
            })

            return
          }

          wait = activeBatchPromises.size > 0 ? Promise.race(activeBatchPromises) : Promise.resolve()
        } finally {
          release()
        }

        await wait
      }
    }

    // Process all files in parallel with concurrency control
    const parsePromises = supportedPaths.map((filePath) =>
      parseLimiter(async () => {
        // Early exit if cancellation requested
        if (this._cancelled) {
          return
        }

        try {
          // Check file size
          const stats = await stat(filePath)
          if (this._cancelled) {
            return
          }

          if (stats.size > MAX_FILE_SIZE_BYTES) {
            skippedCount++ // Skip large files
            return
          }

          // Read file content using fs/promises
          const bytes = await readFile(filePath)
          if (isBinary(bytes)) {
            skippedCount++
            return
          }
          const content = bytes.toString("utf-8")

          if (this._cancelled) {
            return
          }

          // Calculate current hash
          const currentFileHash = createHash("sha256").update(content).digest("hex")
          processedFiles.add(filePath)

          // Check against cache
          const cachedFileHash = this.cacheManager.getHash(filePath)
          const isNewFile = !cachedFileHash
          if (cachedFileHash === currentFileHash) {
            // File is unchanged
            skippedCount++
            return
          }

          // File is new or changed - parse it using the injected parser function
          const blocks = await this.codeParser.parseFile(filePath, { content, fileHash: currentFileHash })

          if (this._cancelled) {
            return
          }

          const fileBlockCount = blocks.length
          onFileParsed?.()
          processedCount++

          if (!isNewFile && this.vectorStore) {
            await this.vectorStore.deletePointsByMultipleFilePaths([filePath])
          }

          // Process embeddings if configured
          if (this.embedder && this.vectorStore && blocks.length > 0) {
            // Add to batch accumulators
            let addedBlocksFromFile = false
            let queued = false
            const info = {
              filePath,
              fileHash: currentFileHash,
              isNew: true,
            }
            for (const block of blocks) {
              if (this._cancelled) break
              const trimmedContent = block.content.trim()
              if (trimmedContent) {
                const nextBatch = await (async () => {
                  const release = await mutex.acquire()
                  try {
                    if (this._cancelled) {
                      // Abort adding more items if cancelled
                      return null
                    }

                    currentBatchBlocks.push(block)
                    currentBatchTexts.push(trimmedContent)
                    addedBlocksFromFile = true

                    // Check if batch threshold is met
                    if (currentBatchBlocks.length < this.batchSegmentThreshold) {
                      return null
                    }

                    // Copy current batch data and clear accumulators
                    const batchBlocks = [...currentBatchBlocks]
                    const batchTexts = [...currentBatchTexts]
                    // RATIONALE: Include the current file metadata before the flush snapshot
                    // so threshold-triggered batches still run delete updates for this file.
                    const batchFileInfos = queued ? [...currentBatchFileInfos] : [...currentBatchFileInfos, info]
                    queued = true
                    currentBatchBlocks = []
                    currentBatchTexts = []
                    currentBatchFileInfos = []

                    return {
                      batchBlocks,
                      batchTexts,
                      batchFileInfos,
                    }
                  } finally {
                    release()
                  }
                })()

                if (!nextBatch) {
                  continue
                }

                await queueBatch(nextBatch.batchBlocks, nextBatch.batchTexts, nextBatch.batchFileInfos)
              }
            }

            // Add file info once per file (outside the block loop)
            if (addedBlocksFromFile) {
              const release = await mutex.acquire()
              try {
                totalBlockCount += fileBlockCount
                batched.set(filePath, currentFileHash)
                if (!queued) {
                  currentBatchFileInfos.push(info)
                  queued = true
                }
              } finally {
                release()
              }
            }
          } else {
            // Only update hash if not being processed in a batch
            this.cacheManager.updateHash(filePath, currentFileHash)
          }
        } catch (error) {
          log.error(`Error processing file ${filePath} in workspace ${scanWorkspace}`, {
            error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
            stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
            location: "scanDirectory:processFile",
          })
          if (onError) {
            onError(
              error instanceof Error
                ? new Error(`${error.message} (Workspace: ${scanWorkspace}, File: ${filePath})`)
                : new Error(`Unknown error processing file ${filePath} (Workspace: ${scanWorkspace})`),
            )
          }
        }
      }),
    )

    // Wait for all parsing to complete
    await Promise.all(parsePromises)
    log.info("finished parsing scan candidates", {
      workspacePath: scanWorkspace,
      processedCount,
      skippedCount,
      pendingBatches: pendingBatchCount,
      cancelled: this._cancelled,
    })

    // Process any remaining items in batch
    const finalBatch = await (async () => {
      const release = await mutex.acquire()
      try {
        if (this._cancelled || currentBatchBlocks.length === 0) {
          return null
        }

        // Copy current batch data and clear accumulators
        const batchBlocks = [...currentBatchBlocks]
        const batchTexts = [...currentBatchTexts]
        const batchFileInfos = [...currentBatchFileInfos]
        currentBatchBlocks = []
        currentBatchTexts = []
        currentBatchFileInfos = []

        return {
          batchBlocks,
          batchTexts,
          batchFileInfos,
        }
      } finally {
        release()
      }
    })()

    if (finalBatch) {
      await queueBatch(finalBatch.batchBlocks, finalBatch.batchTexts, finalBatch.batchFileInfos)
    }

    // Short-circuit if cancelled before handling deletions
    if (this._cancelled) {
      log.info("directory scan cancelled", {
        workspacePath: scanWorkspace,
        processedCount,
        skippedCount,
        totalBlockCount,
      })
      return {
        stats: {
          processed: processedCount,
          skipped: skippedCount,
        },
        totalBlockCount,
      }
    } else {
      await Promise.all(activeBatchPromises)
    }

    for (const [filePath, fileHash] of batched.entries()) {
      if (run.partial.has(filePath)) {
        this.cacheManager.updateHash(filePath, `${PARTIAL_HASH_PREFIX}${fileHash}`)
      } else if (!run.failed) {
        this.cacheManager.updateHash(filePath, fileHash)
      }
    }

    if (run.failed && batched.size > 0) {
      log.warn("skipping cache hash updates due failed batch", {
        workspacePath: scanWorkspace,
        affectedFiles: batched.size,
      })
    }

    // Handle deleted files
    const oldHashes = this.cacheManager.getAllHashes()
    for (const cachedFilePath of Object.keys(oldHashes)) {
      if (!processedFiles.has(cachedFilePath)) {
        // File was deleted or is no longer supported/indexed
        if (this.vectorStore) {
          try {
            await this.vectorStore.deletePointsByFilePath(cachedFilePath)
            this.cacheManager.deleteHash(cachedFilePath)
          } catch (error: any) {
            const errorStatus = error?.status || error?.response?.status || error?.statusCode
            const errorMessage = error instanceof Error ? error.message : String(error)

            log.error(`Failed to delete points for ${cachedFilePath} in workspace ${scanWorkspace}`, {
              error: sanitizeErrorMessage(errorMessage),
              stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
              location: "scanDirectory:deleteRemovedFiles",
              errorStatus,
            })

            if (onError) {
              // Report error to error handler
              onError(
                error instanceof Error
                  ? new Error(`${error.message} (Workspace: ${scanWorkspace}, File: ${cachedFilePath})`)
                  : new Error(`Unknown error deleting points for ${cachedFilePath} (Workspace: ${scanWorkspace})`),
              )
            }
          }
        }
      }
    }

    log.info("directory scan complete", {
      workspacePath: scanWorkspace,
      processedCount,
      skippedCount,
      totalBlockCount,
    })

    return {
      stats: {
        processed: processedCount,
        skipped: skippedCount,
      },
      totalBlockCount,
    }
  }

  private async processBatch(
    run: ScanRun,
    batchBlocks: CodeBlock[],
    batchTexts: string[],
    batchFileInfos: FileInfo[],
  ): Promise<void> {
    const scanWorkspace = run.workspace
    const mode = run.mode
    // Respect cooperative cancellation
    if (this._cancelled || batchBlocks.length === 0) return

    // The provider already refused a minimal request; sending more only repeats the same answer.
    if (run.rejectsAll) return

    log.debug(`Starting to process batch of ${batchBlocks.length} blocks in workspace ${scanWorkspace}`)

    let attempts = 0
    let success = false
    let lastError: Error | null = null
    let rejected = false

    while (attempts < this.maxBatchRetries && !success) {
      attempts++

      if (this._cancelled) return

      log.debug(`Processing batch attempt ${attempts}/${this.maxBatchRetries} for ${batchBlocks.length} blocks`)

      try {
        // --- Deletion Step ---
        log.debug("Starting deletion step for modified files")
        const uniqueFilePaths = [
          ...new Set(
            batchFileInfos
              .filter((info) => !info.isNew) // Only modified files (not new)
              .map((info) => info.filePath),
          ),
        ]
        log.debug(`Identified ${uniqueFilePaths.length} modified files to delete points for`)

        if (uniqueFilePaths.length > 0) {
          try {
            await this.vectorStore.deletePointsByMultipleFilePaths(uniqueFilePaths)
            log.debug(`Successfully deleted points for ${uniqueFilePaths.length} files`)
          } catch (deleteError: any) {
            const errorStatus = deleteError?.status || deleteError?.response?.status || deleteError?.statusCode
            const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError)

            log.error(
              `Failed to delete points for ${uniqueFilePaths.length} files before upsert in workspace ${scanWorkspace}`,
              {
                error: sanitizeErrorMessage(errorMessage),
                stack: deleteError instanceof Error ? sanitizeErrorMessage(deleteError.stack || "") : undefined,
                location: "processBatch:deletePointsByMultipleFilePaths",
                fileCount: uniqueFilePaths.length,
                errorStatus,
              },
            )

            // Re-throw with workspace context
            throw new Error(
              `Failed to delete points for ${uniqueFilePaths.length} files. Workspace: ${scanWorkspace}. ${errorMessage}`,
              { cause: deleteError },
            )
          }
        }
        // --- End Deletion Step ---

        // Create embeddings for batch
        if (this._cancelled) return

        log.debug(`Creating embeddings for ${batchTexts.length} texts`)

        let embeddings: number[][]
        try {
          ;({ embeddings } = await this.embedder.createEmbeddings(batchTexts))
        } catch (embedError) {
          // The provider refused this exact input (e.g. over the model's max input tokens).
          // Retrying cannot succeed, so stop and let the caller split the batch.
          if (REJECTED_STATUSES.has(extractStatusCode(embedError) ?? 0)) rejected = true
          throw embedError
        }
        log.debug(`Successfully created ${embeddings.length} embeddings`)

        // Prepare points for Qdrant
        log.debug("Preparing points for Qdrant upsert")
        const points = batchBlocks.map((block, index) => {
          const vector = embeddings[index]
          if (!vector) {
            throw new Error(`Missing embedding for block at index ${index}`)
          }

          const normalizedAbsolutePath = generateNormalizedAbsolutePath(block.file_path, scanWorkspace)

          // Use segmentHash for unique ID generation to handle multiple segments from same line
          const pointId = uuidv5(block.segmentHash, QDRANT_CODE_BLOCK_NAMESPACE)

          return {
            id: pointId,
            vector,
            payload: {
              filePath: generateRelativeFilePath(normalizedAbsolutePath, scanWorkspace),
              fileHash: block.fileHash,
              codeChunk: block.content,
              startLine: block.start_line,
              endLine: block.end_line,
              segmentHash: block.segmentHash,
            },
          }
        })
        log.debug(`Prepared ${points.length} points for Qdrant`)

        // Upsert points to Qdrant
        if (this._cancelled) return

        log.debug("Starting Qdrant upsert")

        await this.vectorStore.upsertPoints(points)
        log.debug("Completed Qdrant upsert")
        this.countIndexed(run, batchBlocks)

        success = true
        log.debug(`Successfully processed batch of ${batchBlocks.length} blocks after ${attempts} attempt(s)`)
      } catch (error) {
        lastError = error as Error
        log.error(`Error processing batch (attempt ${attempts}) in workspace ${scanWorkspace}`, {
          error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
          stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
          location: "processBatch:retry",
          attemptNumber: attempts,
          batchSize: batchBlocks.length,
        })

        if (rejected) break

        if (attempts < this.maxBatchRetries) {
          this.emitRetry(mode, attempts, batchBlocks.length, error)
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempts - 1)
          log.debug(`Retrying batch in ${delay}ms`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    if (!success && lastError && rejected) {
      if (await this.rejectsEverything(run, lastError)) return

      if (batchBlocks.length > 1) {
        log.warn("embedding provider rejected batch, splitting", { size: batchBlocks.length })
        // The first request already deleted these files' old points, so the halves carry no file infos.
        const mid = Math.ceil(batchBlocks.length / 2)
        await this.processBatch(run, batchBlocks.slice(0, mid), batchTexts.slice(0, mid), [])
        await this.processBatch(run, batchBlocks.slice(mid), batchTexts.slice(mid), [])
        return
      }

      // A single chunk the provider refuses: skip it, but report which file and lines were dropped.
      const block = batchBlocks[0]
      const reason = sanitizeErrorMessage(lastError.message || "Unknown error")
      log.error("skipping chunk rejected by embedding provider", {
        location: "processBatch:rejected",
        error: reason,
        lines: `${block.start_line}-${block.end_line}`,
      })
      this.emitError(mode, "scanner:processBatch", lastError, attempts)
      run.partial.add(block.file_path)
      run.onError?.(
        new RejectedChunkError(
          `Skipped ${block.file_path} lines ${block.start_line}-${block.end_line}: the embedding provider rejected the chunk. ${lastError.message || "Unknown error"}`,
        ),
      )
      return
    }

    if (!success && lastError) {
      log.error(`Failed to process batch after ${this.maxBatchRetries} attempts`)
      this.emitError(mode, "scanner:processBatch", lastError, this.maxBatchRetries)
      run.failed = true
      if (run.onError) {
        // Preserve the original error message from embedders which now have detailed messages
        const errorMessage = lastError.message || "Unknown error"

        run.onError(new Error(`Failed to process batch after ${this.maxBatchRetries} retries: ${errorMessage}`))
      }
    }
  }

  /** Reports each file once, the first time any of its chunks is written. */
  private countIndexed(run: ScanRun, blocks: CodeBlock[]): void {
    let added = 0
    for (const file of new Set(blocks.map((block) => block.file_path))) {
      if (run.indexed.has(file)) continue
      run.indexed.add(file)
      added++
    }
    if (added > 0) run.onFilesIndexed?.(added)
  }

  /**
   * A 400/422 can mean the model or endpoint is misconfigured rather than the input being too large.
   * The first time a batch is rejected, send one minimal request: if that is refused too, nothing can
   * be indexed, so report once and let every other batch stop instead of splitting down to single chunks.
   */
  private async rejectsEverything(run: ScanRun, cause: Error): Promise<boolean> {
    run.probe ??= this.embedder.createEmbeddings([PROBE_TEXT]).then(
      () => false,
      (probeError: unknown) => REJECTED_STATUSES.has(extractStatusCode(probeError) ?? 0),
    )
    if (!(await run.probe)) return false
    if (run.rejectsAll) return true

    run.rejectsAll = true
    run.failed = true
    log.error("embedding provider rejects every request", { location: "processBatch:rejectsAll" })
    this.emitError(run.mode, "scanner:processBatch", cause, 1)
    run.onError?.(
      new Error(
        `The embedding provider rejected every request, including a minimal one, so no batch was indexed. Check the embedding model and endpoint settings. ${cause.message || "Unknown error"}`,
      ),
    )
    return true
  }
}

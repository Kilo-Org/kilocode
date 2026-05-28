import type { Ignore } from "ignore"
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
import { sanitizeErrorMessage } from "../shared/validation-helpers"
import type { IndexingTelemetryMeta, IndexingTelemetryMode, IndexingTelemetryReporter } from "../interfaces/telemetry"

const log = Log.create({ service: "indexing-scanner" })

export class DirectoryScanner implements IDirectoryScanner {
  private _cancelled = false
  private batchSegmentThreshold: number
  private maxBatchRetries: number

  constructor(
    private readonly embedder: IEmbedder,
    private readonly vectorStore: IVectorStore,
    private readonly codeParser: ICodeParser,
    private readonly cacheManager: CacheManager,
    private readonly ignoreInstance: Ignore,
    batchSegmentThreshold?: number,
    maxBatchRetries?: number,
    private readonly onTelemetry?: IndexingTelemetryReporter,
    private readonly telemetryMeta?: IndexingTelemetryMeta,
  ) {
    this.batchSegmentThreshold = batchSegmentThreshold ?? BATCH_SEGMENT_THRESHOLD
    this.maxBatchRetries = maxBatchRetries ?? MAX_BATCH_RETRIES
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
      ignore: FileIgnore.PATTERNS,
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

      return scannerExtensions.includes(ext) && !this.ignoreInstance.ignores(relativeFilePath)
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
    let currentBatchFileInfos: { filePath: string; fileHash: string; isNew: boolean }[] = []
    const batched = new Map<string, string>()
    let failed = false
    const activeBatchPromises = new Set<Promise<void>>()
    let pendingBatchCount = 0

    // Initialize block counter
    let totalBlockCount = 0

    const queueBatch = async (
      batchBlocks: CodeBlock[],
      batchTexts: string[],
      batchFileInfos: { filePath: string; fileHash: string; isNew: boolean }[],
    ): Promise<void> => {
      while (!this._cancelled) {
        const release = await mutex.acquire()
        let wait: Promise<void> | null = null

        try {
          if (pendingBatchCount < MAX_PENDING_BATCHES) {
            pendingBatchCount++

            const batchPromise = batchLimiter(() =>
              this.processBatch(
                batchBlocks,
                batchTexts,
                batchFileInfos,
                scanWorkspace,
                mode,
                onError,
                onFilesIndexed,
                () => {
                  failed = true
                },
              ),
            )
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
          const content = await readFile(filePath, "utf-8")

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

          // Process embeddings if configured
          if (this.embedder && this.vectorStore && blocks.length > 0) {
            // Add to batch accumulators
            let addedBlocksFromFile = false
            let queued = false
            const info = {
              filePath,
              fileHash: currentFileHash,
              isNew: isNewFile,
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

    if (!failed) {
      for (const [filePath, fileHash] of batched.entries()) {
        this.cacheManager.updateHash(filePath, fileHash)
      }
    }

    if (failed && batched.size > 0) {
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
    batchBlocks: CodeBlock[],
    batchTexts: string[],
    batchFileInfos: { filePath: string; fileHash: string; isNew: boolean }[],
    scanWorkspace: string,
    mode: IndexingTelemetryMode,
    onError?: (error: Error) => void,
    onFilesIndexed?: (indexedCount: number) => void,
    onBatchFailed?: () => void,
  ): Promise<void> {
    // Respect cooperative cancellation
    if (this._cancelled || batchBlocks.length === 0) return

    if (batchBlocks.length === 0) {
      log.debug("Skipping empty batch processing")
      return
    }

    log.debug(`Starting to process batch of ${batchBlocks.length} blocks in workspace ${scanWorkspace}`)

    let attempts = 0
    let success = false
    let lastError: Error | null = null

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

        const { embeddings } = await this.embedder.createEmbeddings(batchTexts)
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
        onFilesIndexed?.(batchFileInfos.length)

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

        if (attempts < this.maxBatchRetries) {
          this.emitRetry(mode, attempts, batchBlocks.length, error)
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempts - 1)
          log.debug(`Retrying batch in ${delay}ms`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    if (!success && lastError) {
      log.error(`Failed to process batch after ${this.maxBatchRetries} attempts`)
      this.emitError(mode, "scanner:processBatch", lastError, this.maxBatchRetries)
      onBatchFailed?.()
      if (onError) {
        // Preserve the original error message from embedders which now have detailed messages
        const errorMessage = lastError.message || "Unknown error"

        onError(new Error(`Failed to process batch after ${this.maxBatchRetries} retries: ${errorMessage}`))
      }
    }
  }
}

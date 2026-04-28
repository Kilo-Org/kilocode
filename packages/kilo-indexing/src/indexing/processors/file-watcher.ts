import { watch as chokidarWatch, type FSWatcher as ChokidarFSWatcher } from "chokidar"
import { stat, readFile } from "fs/promises"
import { createHash } from "crypto"
import path from "path"
import { v5 as uuidv5 } from "uuid"
import type { Ignore } from "ignore"
import { Emitter, type Disposable } from "../runtime"
import {
  QDRANT_CODE_BLOCK_NAMESPACE,
  MAX_FILE_SIZE_BYTES,
  BATCH_SEGMENT_THRESHOLD,
  MAX_BATCH_RETRIES,
  INITIAL_RETRY_DELAY_MS,
} from "../constants"
import { scannerExtensions } from "../shared/supported-extensions"
import {
  type IFileWatcher,
  type FileProcessingResult,
  type IEmbedder,
  type IVectorStore,
  type PointStruct,
  type BatchProcessingSummary,
} from "../interfaces"
import type { IndexingTelemetryMeta, IndexingTelemetryReporter } from "../interfaces/telemetry"
import { codeParser } from "./parser"
import { CacheManager } from "../cache-manager"
import {
  generateNormalizedAbsolutePath,
  generateRelativeFilePath,
  generateRelativeIgnorePath,
} from "../shared/get-relative-path"
import { FileIgnore } from "../../file/ignore"
import { Log } from "../../util/log"
import { sanitizeErrorMessage } from "../shared/validation-helpers"

const log = Log.create({ service: "file-watcher" })

/**
 * Implementation of the file watcher interface.
 *
 * RATIONALE: Uses chokidar instead of vscode.workspace.createFileSystemWatcher
 * so the watcher works outside VS Code (CLI, tests, headless).
 */
export class FileWatcher implements IFileWatcher {
  private ignoreInstance?: Ignore
  private watcher?: ChokidarFSWatcher
  private accumulatedEvents: Map<string, { path: string; type: "create" | "change" | "delete" }> = new Map()
  private batchProcessDebounceTimer?: NodeJS.Timeout
  private readonly BATCH_DEBOUNCE_DELAY_MS = 500
  private readonly FILE_PROCESSING_CONCURRENCY_LIMIT = 10
  private batchSegmentThreshold: number
  private maxBatchRetries: number
  private collecting = true
  private draining = false
  private ready?: Promise<void>

  public readonly onDidStartBatchProcessing = new Emitter<string[]>()
  public readonly onBatchProgressUpdate = new Emitter<{
    processedInBatch: number
    totalInBatch: number
    currentFile?: string
  }>()
  public readonly onDidFinishBatchProcessing = new Emitter<BatchProcessingSummary>()

  constructor(
    private workspacePath: string,
    private readonly cacheManager: CacheManager,
    private embedder?: IEmbedder,
    private vectorStore?: IVectorStore,
    ignoreInstance?: Ignore,
    batchSegmentThreshold?: number,
    maxBatchRetries?: number,
    private readonly onTelemetry?: IndexingTelemetryReporter,
    private readonly telemetryMeta?: IndexingTelemetryMeta,
  ) {
    if (ignoreInstance) {
      this.ignoreInstance = ignoreInstance
    }
    this.batchSegmentThreshold = batchSegmentThreshold ?? BATCH_SEGMENT_THRESHOLD
    this.maxBatchRetries = maxBatchRetries ?? MAX_BATCH_RETRIES
  }

  private emitRetry(attempt: number, batchSize: number, err: unknown): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "batch_retry",
      source: "watcher",
      mode: "incremental",
      attempt,
      maxRetries: this.maxBatchRetries,
      batchSize,
      error: sanitizeErrorMessage(msg),
    })
  }

  private emitError(location: string, err: unknown, retryCount?: number): void {
    if (!this.onTelemetry || !this.telemetryMeta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this.onTelemetry({
      ...this.telemetryMeta,
      type: "error",
      source: "watcher",
      mode: "incremental",
      location,
      error: sanitizeErrorMessage(msg),
      retryCount,
      maxRetries: this.maxBatchRetries,
    })
  }

  /**
   * Initializes the file watcher using chokidar.
   *
   * RATIONALE: chokidar watches the filesystem directly using native OS events,
   * removing the dependency on VS Code's file system watcher API.
   */
  async initialize(): Promise<void> {
    if (this.ready) {
      await this.ready
      return
    }

    log.info("initializing file watcher", { workspacePath: this.workspacePath })

    this.watcher = chokidarWatch(this.workspacePath, {
      ignored: (filePath: string) => {
        const relativeFilePath = generateRelativeIgnorePath(filePath, this.workspacePath)
        if (!relativeFilePath) return false
        if (FileIgnore.match(relativeFilePath)) return true
        return this.ignoreInstance?.ignores(relativeFilePath) ?? false
      },
      persistent: true,
      ignoreInitial: true,
    })

    this.watcher.on("add", (filePath) => this.handleFileEvent(filePath, "create"))
    this.watcher.on("change", (filePath) => this.handleFileEvent(filePath, "change"))
    this.watcher.on("unlink", (filePath) => this.handleFileEvent(filePath, "delete"))
    this.ready = new Promise((resolve, reject) => {
      this.watcher?.once("ready", resolve)
      this.watcher?.once("error", reject)
    })
    await this.ready
    log.info("file watcher ready", { workspacePath: this.workspacePath })
  }

  setCollecting(collecting: boolean): void {
    this.collecting = collecting
    log.info("updated watcher collection mode", {
      workspacePath: this.workspacePath,
      collecting,
      pendingEvents: this.accumulatedEvents.size,
    })
    if (collecting) this.scheduleBatchProcessing()
  }

  /**
   * Updates the batch segment threshold.
   */
  updateBatchSegmentThreshold(newThreshold: number): void {
    this.batchSegmentThreshold = newThreshold
  }

  /**
   * Disposes the file watcher and cleans up resources.
   */
  dispose(): void {
    this.watcher?.close()
    if (this.batchProcessDebounceTimer) {
      clearTimeout(this.batchProcessDebounceTimer)
    }
    this.onDidStartBatchProcessing.dispose()
    this.onBatchProgressUpdate.dispose()
    this.onDidFinishBatchProcessing.dispose()
    this.accumulatedEvents.clear()
    this.ready = undefined
  }

  /**
   * Handles a file event from chokidar by accumulating it and scheduling batch processing.
   */
  private handleFileEvent(filePath: string, type: "create" | "change" | "delete"): void {
    if (!this.shouldIndex(filePath)) return
    this.accumulatedEvents.set(filePath, { path: filePath, type })
    if (!this.collecting) return
    this.scheduleBatchProcessing()
  }

  /**
   * Schedules batch processing with debounce.
   */
  private scheduleBatchProcessing(): void {
    if (!this.collecting) return
    if (this.batchProcessDebounceTimer) {
      clearTimeout(this.batchProcessDebounceTimer)
    }
    this.batchProcessDebounceTimer = setTimeout(() => this.triggerBatchProcessing(), this.BATCH_DEBOUNCE_DELAY_MS)
  }

  /**
   * Triggers processing of accumulated events.
   */
  private async triggerBatchProcessing(): Promise<void> {
    if (this.draining || this.accumulatedEvents.size === 0 || !this.collecting) {
      return
    }

    this.draining = true
    log.info("starting watcher event drain", {
      workspacePath: this.workspacePath,
      pendingEvents: this.accumulatedEvents.size,
    })

    while (this.collecting && this.accumulatedEvents.size > 0) {
      const eventsToProcess = new Map(this.accumulatedEvents)
      this.accumulatedEvents.clear()

      const filePathsInBatch = Array.from(eventsToProcess.keys())
      this.onDidStartBatchProcessing.fire(filePathsInBatch)
      await this.processBatch(eventsToProcess)
    }

    this.draining = false
    log.info("completed watcher event drain", { workspacePath: this.workspacePath })
  }

  private shouldIndex(filePath: string) {
    const relativeFilePath = generateRelativeIgnorePath(filePath, this.workspacePath)
    if (!relativeFilePath) return false
    const ext = path.extname(filePath).toLowerCase()
    if (FileIgnore.match(relativeFilePath)) return false
    if (this.ignoreInstance?.ignores(relativeFilePath)) return false
    return scannerExtensions.includes(ext) || !path.extname(filePath)
  }

  /**
   * Handles deletion phase of batch processing.
   *
   * Deletes vector store points for explicitly deleted files and for files
   * that changed (old points are cleared before re-upserting new ones).
   */
  private async _handleBatchDeletions(
    batchResults: FileProcessingResult[],
    processedCountInBatch: number,
    totalFilesInBatch: number,
    pathsToExplicitlyDelete: string[],
    filesToUpsertDetails: Array<{ path: string; originalType: "create" | "change" }>,
  ): Promise<{ overallBatchError?: Error; clearedPaths: Set<string>; processedCount: number }> {
    let overallBatchError: Error | undefined
    const allPathsToClearFromDB = new Set<string>(pathsToExplicitlyDelete)

    for (const fileDetail of filesToUpsertDetails) {
      if (fileDetail.originalType === "change") {
        allPathsToClearFromDB.add(fileDetail.path)
      }
    }

    if (allPathsToClearFromDB.size > 0 && this.vectorStore) {
      try {
        await this.vectorStore.deletePointsByMultipleFilePaths(Array.from(allPathsToClearFromDB))

        for (const path of pathsToExplicitlyDelete) {
          this.cacheManager.deleteHash(path)
          batchResults.push({ path, status: "success" })
          processedCountInBatch++
          this.onBatchProgressUpdate.fire({
            processedInBatch: processedCountInBatch,
            totalInBatch: totalFilesInBatch,
            currentFile: path,
          })
        }
      } catch (error: any) {
        const errorStatus = error?.status || error?.response?.status || error?.statusCode
        const errorMessage = error instanceof Error ? error.message : String(error)

        log.error("batch deletion failed", {
          error: sanitizeErrorMessage(errorMessage),
          location: "deletePointsByMultipleFilePaths",
          errorType: "deletion_error",
          errorStatus,
        })
        this.emitError("file-watcher:deletePointsByMultipleFilePaths", error)

        overallBatchError = error as Error
        for (const path of pathsToExplicitlyDelete) {
          batchResults.push({ path, status: "error", error: error as Error })
          processedCountInBatch++
          this.onBatchProgressUpdate.fire({
            processedInBatch: processedCountInBatch,
            totalInBatch: totalFilesInBatch,
            currentFile: path,
          })
        }
      }
    }

    return { overallBatchError, clearedPaths: allPathsToClearFromDB, processedCount: processedCountInBatch }
  }

  /**
   * Processes individual files, parses them, creates embeddings, and collects
   * the resulting points for a later batch upsert.
   */
  private async _processFilesAndPrepareUpserts(
    filesToUpsertDetails: Array<{ path: string; originalType: "create" | "change" }>,
    batchResults: FileProcessingResult[],
    processedCountInBatch: number,
    totalFilesInBatch: number,
    pathsToExplicitlyDelete: string[],
  ): Promise<{
    pointsForBatchUpsert: PointStruct[]
    successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }>
    processedCount: number
  }> {
    const pointsForBatchUpsert: PointStruct[] = []
    const successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }> = []
    const filesToProcessConcurrently = [...filesToUpsertDetails]

    for (let i = 0; i < filesToProcessConcurrently.length; i += this.FILE_PROCESSING_CONCURRENCY_LIMIT) {
      const chunkToProcess = filesToProcessConcurrently.slice(i, i + this.FILE_PROCESSING_CONCURRENCY_LIMIT)

      const chunkProcessingPromises = chunkToProcess.map(async (fileDetail) => {
        this.onBatchProgressUpdate.fire({
          processedInBatch: processedCountInBatch,
          totalInBatch: totalFilesInBatch,
          currentFile: fileDetail.path,
        })
        try {
          const result = await this.processFile(fileDetail.path)
          return { path: fileDetail.path, result: result, error: undefined }
        } catch (e) {
          const error = e as Error
          log.error(`unhandled exception processing file ${fileDetail.path}`, { error })
          return { path: fileDetail.path, result: undefined, error: error }
        }
      })

      const settledChunkResults = await Promise.allSettled(chunkProcessingPromises)

      for (const settledResult of settledChunkResults) {
        let resultPath: string | undefined

        if (settledResult.status === "fulfilled") {
          const { path, result, error: directError } = settledResult.value
          resultPath = path

          if (directError) {
            batchResults.push({ path, status: "error", error: directError })
          } else if (result) {
            if (result.status === "skipped" || result.status === "local_error") {
              batchResults.push(result)
            } else if (result.status === "processed_for_batching" && result.pointsToUpsert) {
              pointsForBatchUpsert.push(...result.pointsToUpsert)
              if (result.path && result.newHash) {
                successfullyProcessedForUpsert.push({ path: result.path, newHash: result.newHash })
              } else if (result.path && !result.newHash) {
                successfullyProcessedForUpsert.push({ path: result.path })
              }
            } else {
              batchResults.push({
                path,
                status: "error",
                error: new Error(`Unexpected result status from processFile: ${result.status} for file ${path}`),
              })
            }
          } else {
            batchResults.push({
              path,
              status: "error",
              error: new Error(`Fulfilled promise with no result or error for file ${path}`),
            })
          }
        } else {
          const error = settledResult.reason as Error
          const rejectedPath = (settledResult.reason as any)?.path || "unknown"
          log.error("a file processing promise was rejected", { error })
          batchResults.push({
            path: rejectedPath,
            status: "error",
            error: error,
          })
        }

        if (!pathsToExplicitlyDelete.includes(resultPath || "")) {
          processedCountInBatch++
        }
        this.onBatchProgressUpdate.fire({
          processedInBatch: processedCountInBatch,
          totalInBatch: totalFilesInBatch,
          currentFile: resultPath,
        })
      }
    }

    return {
      pointsForBatchUpsert,
      successfullyProcessedForUpsert,
      processedCount: processedCountInBatch,
    }
  }

  /**
   * Executes batch upsert operations against the vector store with retry logic.
   */
  private async _executeBatchUpsertOperations(
    pointsForBatchUpsert: PointStruct[],
    successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }>,
    batchResults: FileProcessingResult[],
    overallBatchError?: Error,
  ): Promise<Error | undefined> {
    if (pointsForBatchUpsert.length > 0 && this.vectorStore && !overallBatchError) {
      try {
        for (let i = 0; i < pointsForBatchUpsert.length; i += this.batchSegmentThreshold) {
          const batch = pointsForBatchUpsert.slice(i, i + this.batchSegmentThreshold)
          let retryCount = 0
          let upsertError: Error | undefined

          while (retryCount < this.maxBatchRetries) {
            try {
              await this.vectorStore.upsertPoints(batch)
              break
            } catch (error) {
              upsertError = error as Error
              retryCount++
              if (retryCount === this.maxBatchRetries) {
                log.error("upsert retry exhausted", {
                  error: sanitizeErrorMessage(upsertError.message),
                  location: "upsertPoints",
                  errorType: "upsert_retry_exhausted",
                  retryCount: this.maxBatchRetries,
                })
                this.emitError("file-watcher:upsert_retry_exhausted", upsertError, this.maxBatchRetries)
                throw new Error(`Failed to upsert batch after ${this.maxBatchRetries} retries: ${upsertError.message}`)
              }
              this.emitRetry(retryCount, batch.length, upsertError)
              await new Promise((resolve) => setTimeout(resolve, INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1)))
            }
          }
        }

        for (const { path, newHash } of successfullyProcessedForUpsert) {
          if (newHash) {
            this.cacheManager.updateHash(path, newHash)
          }
          batchResults.push({ path, status: "success" })
        }
      } catch (error) {
        const err = error as Error
        overallBatchError = overallBatchError || err
        this.emitError("file-watcher:batch_upsert_error", err)
        log.error("batch upsert error", {
          error: sanitizeErrorMessage(err.message),
          location: "executeBatchUpsertOperations",
          errorType: "batch_upsert_error",
          affectedFiles: successfullyProcessedForUpsert.length,
        })
        for (const { path } of successfullyProcessedForUpsert) {
          batchResults.push({ path, status: "error", error: err })
        }
      }
    } else if (overallBatchError && pointsForBatchUpsert.length > 0) {
      for (const { path } of successfullyProcessedForUpsert) {
        batchResults.push({ path, status: "error", error: overallBatchError })
      }
    }

    return overallBatchError
  }

  /**
   * Processes a batch of accumulated events through three phases:
   * 1. Handle deletions (remove old points from vector store)
   * 2. Process files and prepare upserts (parse, embed)
   * 3. Execute batch upsert operations
   */
  private async processBatch(
    eventsToProcess: Map<string, { path: string; type: "create" | "change" | "delete" }>,
  ): Promise<void> {
    const batchResults: FileProcessingResult[] = []
    let processedCountInBatch = 0
    const totalFilesInBatch = eventsToProcess.size
    let overallBatchError: Error | undefined

    // Initial progress update
    this.onBatchProgressUpdate.fire({
      processedInBatch: 0,
      totalInBatch: totalFilesInBatch,
      currentFile: undefined,
    })

    // Categorize events
    const pathsToExplicitlyDelete: string[] = []
    const filesToUpsertDetails: Array<{ path: string; originalType: "create" | "change" }> = []

    for (const event of eventsToProcess.values()) {
      if (event.type === "delete") {
        pathsToExplicitlyDelete.push(event.path)
      } else {
        filesToUpsertDetails.push({
          path: event.path,
          originalType: event.type,
        })
      }
    }

    log.info("processing file watcher batch", {
      workspacePath: this.workspacePath,
      batchSize: totalFilesInBatch,
      deletes: pathsToExplicitlyDelete.length,
      upserts: filesToUpsertDetails.length,
    })

    // Phase 1: Handle deletions
    const { overallBatchError: deletionError, processedCount: deletionCount } = await this._handleBatchDeletions(
      batchResults,
      processedCountInBatch,
      totalFilesInBatch,
      pathsToExplicitlyDelete,
      filesToUpsertDetails,
    )
    overallBatchError = deletionError
    processedCountInBatch = deletionCount

    // Phase 2: Process files and prepare upserts
    const {
      pointsForBatchUpsert,
      successfullyProcessedForUpsert,
      processedCount: upsertCount,
    } = await this._processFilesAndPrepareUpserts(
      filesToUpsertDetails,
      batchResults,
      processedCountInBatch,
      totalFilesInBatch,
      pathsToExplicitlyDelete,
    )
    processedCountInBatch = upsertCount

    // Phase 3: Execute batch upsert
    overallBatchError = await this._executeBatchUpsertOperations(
      pointsForBatchUpsert,
      successfullyProcessedForUpsert,
      batchResults,
      overallBatchError,
    )

    // Finalize
    this.onDidFinishBatchProcessing.fire({
      processedFiles: batchResults,
      batchError: overallBatchError,
    })

    const successCount = batchResults.filter((item) => item.status === "success").length
    const skippedCount = batchResults.filter((item) => item.status === "skipped").length
    const errorCount = batchResults.filter((item) => item.status === "error" || item.status === "local_error").length

    log.info("completed file watcher batch", {
      workspacePath: this.workspacePath,
      batchSize: totalFilesInBatch,
      successCount,
      skippedCount,
      errorCount,
      hasBatchError: !!overallBatchError,
    })

    this.onBatchProgressUpdate.fire({
      processedInBatch: totalFilesInBatch,
      totalInBatch: totalFilesInBatch,
    })

    if (this.accumulatedEvents.size === 0) {
      this.onBatchProgressUpdate.fire({
        processedInBatch: 0,
        totalInBatch: 0,
        currentFile: undefined,
      })
    }
  }

  /**
   * Processes a single file: checks ignore rules, reads content, computes hash,
   * parses code blocks, creates embeddings, and returns points for batch upsert.
   */
  async processFile(filePath: string): Promise<FileProcessingResult> {
    try {
      // Check if file is in an ignored directory
      const relativeFilePath = generateRelativeIgnorePath(filePath, this.workspacePath)
      if (!relativeFilePath) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File path is outside workspace",
        }
      }

      if (FileIgnore.match(relativeFilePath)) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File is in an ignored directory",
        }
      }

      // Check if file should be ignored by root .gitignore / .kilocodeignore rules.
      if (this.ignoreInstance && this.ignoreInstance.ignores(relativeFilePath)) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File is ignored by .gitignore or .kilocodeignore",
        }
      }

      // Check file size
      const fileStat = await stat(filePath)
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File is too large",
        }
      }

      // Read file content
      const content = await readFile(filePath, "utf-8")

      // Calculate hash
      const newHash = createHash("sha256").update(content).digest("hex")

      // Check if file has changed
      if (this.cacheManager.getHash(filePath) === newHash) {
        return {
          path: filePath,
          status: "skipped" as const,
          reason: "File has not changed",
        }
      }

      // Parse file
      const blocks = await codeParser.parseFile(filePath, { content, fileHash: newHash })

      // Prepare points for batch processing
      let pointsToUpsert: PointStruct[] = []
      if (this.embedder && blocks.length > 0) {
        const texts = blocks.map((block) => block.content)
        const { embeddings } = await this.embedder.createEmbeddings(texts)
        if (embeddings.length !== blocks.length) {
          return {
            path: filePath,
            status: "local_error" as const,
            error: new Error(
              `Embedding count mismatch for ${filePath}: expected ${blocks.length}, got ${embeddings.length}`,
            ),
          }
        }

        pointsToUpsert = blocks.map((block, index) => {
          const vector = embeddings[index]!
          const normalizedAbsolutePath = generateNormalizedAbsolutePath(block.file_path, this.workspacePath)
          const pointId = uuidv5(block.segmentHash, QDRANT_CODE_BLOCK_NAMESPACE)

          return {
            id: pointId,
            vector,
            payload: {
              filePath: generateRelativeFilePath(normalizedAbsolutePath, this.workspacePath),
              codeChunk: block.content,
              startLine: block.start_line,
              endLine: block.end_line,
              segmentHash: block.segmentHash,
            },
          }
        })
      }

      return {
        path: filePath,
        status: "processed_for_batching" as const,
        newHash,
        pointsToUpsert,
      }
    } catch (error) {
      return {
        path: filePath,
        status: "local_error" as const,
        error: error as Error,
      }
    }
  }
}

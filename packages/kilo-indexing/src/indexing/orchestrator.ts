import path from "path"
import type { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager, type IndexingState } from "./state-manager"
import type { IFileWatcher, BatchProcessingSummary } from "./interfaces"
import type {
  IndexingTelemetryEvent,
  IndexingTelemetryMeta,
  IndexingTelemetryMode,
  IndexingTelemetryReporter,
  IndexingTelemetrySource,
  IndexingTelemetryTrigger,
} from "./interfaces/telemetry"
import type { IVectorStore } from "./interfaces/vector-store"
import { DirectoryScanner } from "./processors"
import type { CacheManager } from "./cache-manager"
import type { Disposable } from "./runtime"
import { Log } from "../util/log"
import { sanitizeErrorMessage } from "./shared/validation-helpers"

const log = Log.create({ service: "indexing-orchestrator" })

export class CodeIndexOrchestrator {
  private _fileWatcherSubscriptions: Disposable[] = []
  private _isProcessing = false
  private _cancelRequested = false

  constructor(
    private readonly configManager: CodeIndexConfigManager,
    private readonly stateManager: CodeIndexStateManager,
    private readonly workspacePath: string,
    private readonly cacheManager: CacheManager,
    private readonly vectorStore: IVectorStore,
    private readonly scanner: DirectoryScanner,
    private readonly fileWatcher: IFileWatcher,
    private readonly onTelemetry?: IndexingTelemetryReporter,
  ) {}

  private getTelemetryMeta(): IndexingTelemetryMeta {
    const cfg = this.configManager.getConfig()
    return {
      provider: cfg.embedderProvider,
      vectorStore: cfg.vectorStoreProvider ?? "qdrant",
      modelId: cfg.modelId,
    }
  }

  private emitTelemetry(event: IndexingTelemetryEvent): void {
    this.onTelemetry?.(event)
  }

  private emitError(
    location: string,
    err: unknown,
    source: IndexingTelemetrySource,
    trigger?: IndexingTelemetryTrigger,
    mode?: IndexingTelemetryMode,
  ): void {
    const msg = err instanceof Error ? err.message : String(err)
    this.emitTelemetry({
      ...this.getTelemetryMeta(),
      type: "error",
      source,
      location,
      trigger,
      mode,
      error: sanitizeErrorMessage(msg),
    })
  }

  public updateBatchSegmentThreshold(newThreshold: number): void {
    this.scanner.updateBatchSegmentThreshold(newThreshold)
    this.fileWatcher.updateBatchSegmentThreshold(newThreshold)
  }

  private async _startWatcher(): Promise<void> {
    if (!this.configManager.isFeatureConfigured) {
      throw new Error("Cannot start watcher: Service not configured.")
    }

    log.info("starting file watcher", { workspacePath: this.workspacePath })
    this.stateManager.setSystemState("Indexing", "Initializing file watcher...")

    try {
      await this.fileWatcher.initialize()
      log.info("file watcher initialized", { workspacePath: this.workspacePath })

      this._fileWatcherSubscriptions = [
        this.fileWatcher.onDidStartBatchProcessing.on((paths) => {
          log.info("file watcher batch started", {
            workspacePath: this.workspacePath,
            filesInBatch: paths.length,
          })
          if (this.stateManager.state !== "Indexing") {
            this.stateManager.setSystemState("Indexing", "Processing file changes...")
          }
        }),
        this.fileWatcher.onBatchProgressUpdate.on(({ processedInBatch, totalInBatch, currentFile }) => {
          this.stateManager.reportFileQueueProgress(
            processedInBatch,
            totalInBatch,
            currentFile ? path.basename(currentFile) : undefined,
          )
          if (processedInBatch === totalInBatch) {
            log.info("file watcher batch completed", {
              workspacePath: this.workspacePath,
              totalInBatch,
            })
            if (totalInBatch > 0) {
              this.stateManager.setSystemState("Indexed", "File changes processed. Index up-to-date.")
            } else if (this.stateManager.state === "Indexing") {
              this.stateManager.setSystemState("Indexed", "Index up-to-date. File queue empty.")
            }
          }
        }),
        this.fileWatcher.onDidFinishBatchProcessing.on((summary: BatchProcessingSummary) => {
          if (summary.batchError) {
            log.error("batch processing failed", { err: summary.batchError })
          }
        }),
      ]
      this.fileWatcher.setCollecting(false)
      log.info("file watcher is initialized in drain-only mode", { workspacePath: this.workspacePath })
    } catch (err) {
      log.error("failed to start file watcher", { err })
      throw err
    }
  }

  public async startIndexing(trigger: IndexingTelemetryTrigger = "background"): Promise<void> {
    log.info("indexing start requested", {
      workspacePath: this.workspacePath,
      state: this.stateManager.state,
      featureConfigured: this.configManager.isFeatureConfigured,
      trigger,
    })

    if (!this.workspacePath) {
      this.stateManager.setSystemState("Error", "Indexing requires a workspace folder.")
      log.warn("start rejected: no workspace path")
      return
    }

    if (!this.configManager.isFeatureConfigured) {
      this.stateManager.setSystemState("Standby", "Missing configuration. Save your settings to start indexing.")
      log.warn("start rejected: missing configuration")
      return
    }

    if (
      this._isProcessing ||
      (this.stateManager.state !== "Standby" &&
        this.stateManager.state !== "Error" &&
        this.stateManager.state !== "Indexed")
    ) {
      log.warn("start rejected", { state: this.stateManager.state })
      return
    }

    this._cancelRequested = false
    this._isProcessing = true
    this.stateManager.setSystemState("Indexing", "Initializing services...")

    let started = false
    let source: IndexingTelemetrySource = "watcher"
    let mode: IndexingTelemetryMode | undefined

    try {
      await this._startWatcher()

      if (this._cancelRequested) {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
        return
      }

      source = "scan"
      const collectionCreated = await this.vectorStore.initialize()
      log.info("vector store initialized", { workspacePath: this.workspacePath, collectionCreated })
      started = true

      if (this._cancelRequested) {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
        return
      }

      if (collectionCreated) {
        await this.cacheManager.clearCacheFile()
        log.info("cleared indexing cache after new collection creation", { workspacePath: this.workspacePath })
      }

      const hasExistingData = await this.vectorStore.hasIndexedData()
      log.info("checked vector store indexed data", {
        workspacePath: this.workspacePath,
        hasExistingData,
        collectionCreated,
      })

      if (this._cancelRequested) {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
        return
      }

      mode = hasExistingData && !collectionCreated ? "incremental" : "full"

      if (mode === "incremental") {
        log.info("collection has existing data, running incremental scan")

        this.stateManager.setSystemState("Indexing", "Checking for new or modified files...")
        await this.vectorStore.markIndexingIncomplete()
        await this._runScan(mode, trigger)
      } else {
        log.info("running full scan", {
          workspacePath: this.workspacePath,
          hasExistingData,
          collectionCreated,
        })
        this.stateManager.setSystemState("Indexing", "Services ready. Starting workspace scan...")
        await this.vectorStore.markIndexingIncomplete()
        await this._runScan(mode, trigger)
      }
    } catch (err) {
      log.error("error during indexing", { err })
      this.emitError("orchestrator:startIndexing", err, source, trigger, mode)

      if (started) {
        log.info("indexing failed after starting; preserving cache for retry")
      } else {
        log.info("failed to connect to vector store; preserving cache for future incremental scan")
      }

      const msg = err instanceof Error ? err.message : "Unknown error"
      this.stateManager.setSystemState("Error", `Failed during initial scan: ${msg}`)
      this.stopWatcher()
    } finally {
      this._isProcessing = false
      log.info("indexing start flow finished", {
        workspacePath: this.workspacePath,
        state: this.stateManager.state,
      })
    }
  }

  private async _runScan(mode: IndexingTelemetryMode, trigger: IndexingTelemetryTrigger): Promise<void> {
    if (this._cancelRequested) {
      log.info("scan skipped: cancellation was requested", { workspacePath: this.workspacePath, mode })
      return
    }

    log.info("starting workspace scan", { workspacePath: this.workspacePath, mode })
    let cumulativeFilesIndexed = 0
    let cumulativeFilesFound = 0
    const batchErrors: Error[] = []

    const handleFileParsed = () => {
      cumulativeFilesFound += 1
      this.stateManager.reportFileProgress(cumulativeFilesIndexed, cumulativeFilesFound)
    }

    const handleFilesIndexed = (indexedCount: number) => {
      cumulativeFilesIndexed += indexedCount
      this.stateManager.reportFileProgress(cumulativeFilesIndexed, cumulativeFilesFound)
    }

    const result = await this.scanner.scanDirectory(
      this.workspacePath,
      (batchError: Error) => {
        log.error(`error during ${mode} scan batch`, { err: batchError })
        batchErrors.push(batchError)
      },
      handleFilesIndexed,
      handleFileParsed,
      mode,
    )

    log.info("workspace scan completed", {
      workspacePath: this.workspacePath,
      mode,
      filesDiscovered: cumulativeFilesFound,
      filesIndexed: cumulativeFilesIndexed,
      scanProcessed: result.stats.processed,
      scanSkipped: result.stats.skipped,
      totalBlocks: result.totalBlockCount,
      batchErrorCount: batchErrors.length,
    })

    if (this._cancelRequested || this.scanner.isCancelled) {
      this._isProcessing = false
      if (this.stateManager.state !== "Error") {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
      }
      log.info("workspace scan cancelled", { workspacePath: this.workspacePath, mode })
      return
    }

    if (mode === "full") {
      // Validate full scan results
      if (cumulativeFilesIndexed === 0 && cumulativeFilesFound > 0) {
        const first = batchErrors.at(0)
        const msg = first ? first.message : "No blocks were indexed"
        throw new Error(`Indexing failed: ${msg}`)
      }

      if (batchErrors.length > 0) {
        const failureRate = (cumulativeFilesFound - cumulativeFilesIndexed) / cumulativeFilesFound
        if (failureRate > 0.1) {
          const first = batchErrors.at(0)
          const msg = first ? first.message : "Unknown batch error"
          throw new Error(
            `Indexing partially failed: Only ${cumulativeFilesIndexed} of ${cumulativeFilesFound} files were indexed. ${msg}`,
          )
        }
      }
    }

    this.fileWatcher.setCollecting(true)
    await this.vectorStore.markIndexingComplete()
    this.stateManager.setSystemState("Indexed", "File watcher started. Index up-to-date.")
    log.info("workspace scan finalized", {
      workspacePath: this.workspacePath,
      mode,
      filesIndexed: cumulativeFilesIndexed,
      filesDiscovered: cumulativeFilesFound,
    })

    this.emitTelemetry({
      ...this.getTelemetryMeta(),
      type: "completed",
      source: "scan",
      trigger,
      mode,
      filesIndexed: cumulativeFilesIndexed,
      filesDiscovered: cumulativeFilesFound,
      totalBlocks: result.totalBlockCount,
      batchErrors: batchErrors.length,
    })
  }

  public stopWatcher(): void {
    log.info("stopping file watcher", { workspacePath: this.workspacePath })
    this.fileWatcher.dispose()
    this.scanner.cancel()
    for (const sub of this._fileWatcherSubscriptions) sub.dispose()
    this._fileWatcherSubscriptions = []

    if (this.stateManager.state !== "Error") {
      this.stateManager.setSystemState("Standby", "File watcher stopped.")
    }
    this._isProcessing = false
    log.info("file watcher stopped", { workspacePath: this.workspacePath, state: this.stateManager.state })
  }

  public cancelIndexing(): void {
    log.info("cancelling indexing", { workspacePath: this.workspacePath })
    this._cancelRequested = true
    this.scanner.cancel()
    this.stopWatcher()
    this.stateManager.setSystemState("Standby", "Indexing cancelled.")
    this._isProcessing = false
    log.info("indexing cancelled", { workspacePath: this.workspacePath })
  }

  public async clearIndexData(): Promise<void> {
    this._isProcessing = true
    log.info("clearing index data", { workspacePath: this.workspacePath })

    try {
      this.stopWatcher()

      try {
        if (this.configManager.isFeatureConfigured) {
          await this.vectorStore.deleteCollection()
        } else {
          log.warn("service not configured, skipping vector collection clear")
        }
      } catch (err: any) {
        log.error("failed to clear vector collection", { err })
        this.stateManager.setSystemState("Error", `Failed to clear vector collection: ${err.message}`)
      }

      await this.cacheManager.clearCacheFile()

      if (this.stateManager.state !== "Error") {
        this.stateManager.setSystemState("Standby", "Index data cleared successfully.")
      }
    } finally {
      this._isProcessing = false
      log.info("finished clearing index data", {
        workspacePath: this.workspacePath,
        state: this.stateManager.state,
      })
    }
  }

  public get state(): IndexingState {
    return this.stateManager.state
  }
}

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
import type { StoreState } from "./interfaces"
import { DirectoryScanner } from "./processors"
import type { CacheManager } from "./cache-manager"
import type { Disposable } from "./runtime"
import { Log } from "../util/log"
import { sanitizeErrorMessage } from "./shared/validation-helpers"
import { DEFAULT_VECTOR_STORE } from "./constants"
import type { WorktreeOverlay } from "./worktree-overlay"
import { acquire, type Writer } from "./writer-lock"

const log = Log.create({ service: "indexing-orchestrator" })

const EMPTY: StoreState = { status: "empty" }

export class CodeIndexOrchestrator {
  private _fileWatcherSubscriptions: Disposable[] = []
  private _isProcessing = false
  private _cancelRequested = false
  private _active?: Promise<void>
  // The session's writer lock, held from the first successful run until
  // shutdown (or release on error/clear). The file watcher keeps writing the
  // store after every scan, so releasing per-run would let a second session
  // acquire the lock and scan concurrently — the corruption the lock targets.
  private _writer?: Writer

  constructor(
    private readonly configManager: CodeIndexConfigManager,
    private readonly stateManager: CodeIndexStateManager,
    private readonly workspacePath: string,
    private readonly cacheManager: CacheManager,
    private readonly vectorStore: IVectorStore,
    private readonly scanner: DirectoryScanner,
    private readonly fileWatcher: IFileWatcher,
    private readonly onTelemetry?: IndexingTelemetryReporter,
    private readonly overlay?: WorktreeOverlay,
  ) {}

  private getTelemetryMeta(): IndexingTelemetryMeta {
    const cfg = this.configManager.getConfig()
    return {
      provider: cfg.embedderProvider,
      vectorStore: cfg.vectorStoreProvider ?? DEFAULT_VECTOR_STORE,
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
      this.fileWatcher.setCollecting(false)
      for (const sub of this._fileWatcherSubscriptions) sub.dispose()
      this._fileWatcherSubscriptions = []
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
            if (this.stateManager.state === "Error") return
            if (totalInBatch > 0) {
              this.stateManager.setSystemState("Indexed", "File changes processed. Index up-to-date.")
            } else if (this.stateManager.state === "Indexing") {
              this.stateManager.setSystemState("Indexed", "Index up-to-date. File queue empty.")
            }
          }
        }),
        this.fileWatcher.onDidFinishBatchProcessing.on((summary: BatchProcessingSummary) => {
          if (!summary.batchError) return
          log.error("batch processing failed", { err: summary.batchError })
          this.overlay?.prepare()
          this.stateManager.setSystemState("Error", `Failed to process file changes: ${summary.batchError.message}`)
          this.emitError("orchestrator:watcher", summary.batchError, "watcher")
        }),
      ]
      this.fileWatcher.setCollecting(false)
      log.info("file watcher is initialized in drain-only mode", { workspacePath: this.workspacePath })
    } catch (err) {
      log.error("failed to start file watcher", { err })
      throw err
    }
  }

  public startIndexing(trigger: IndexingTelemetryTrigger = "background"): Promise<void> {
    if (this._active) return this._active
    const task = this.runIndexing(trigger).finally(() => {
      if (this._active === task) this._active = undefined
    })
    this._active = task
    return task
  }

  /**
   * Only one session may write a workspace's index. Without this, a second
   * session starts a scan against a store the first one is still filling,
   * clears it as unusable, and leaves both sessions committing to the same
   * table. The lock is session-held (see _writer): once acquired, later runs
   * reuse it instead of contending with themselves.
   */
  private async _acquire(): Promise<Writer | undefined> {
    if (this._writer) {
      // The session caches its writer across runs. Verify ownership before
      // reusing it: a heartbeat that saw another session's token stops beating,
      // but only a fresh check here stops this orchestrator from writing the
      // store after it has lost the lock.
      if (await this._writer.owned()) return this._writer
      log.warn("lost the writer lock since the last run; reacquiring", {
        workspacePath: this.workspacePath,
      })
      this._writer = undefined
    }
    const dir = this.cacheManager.dir
    if (!dir) {
      log.warn("no cache directory for the writer lock, proceeding unlocked", {
        workspacePath: this.workspacePath,
      })
      return { release: async () => {}, owned: async () => true }
    }
    const writer = await acquire(dir, this.workspacePath)
    if (writer) {
      this._writer = writer
      return writer
    }
    log.info("writer lock is held elsewhere", { workspacePath: this.workspacePath })
    return undefined
  }

  private async _releaseWriter(): Promise<void> {
    const writer = this._writer
    this._writer = undefined
    await writer?.release()
  }

  private async runIndexing(trigger: IndexingTelemetryTrigger): Promise<void> {
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
      // Acquired inside the try and session-held (see _writer): a throw between
      // acquire and the body (e.g. from state setup below) releases below and
      // must not leave the lock fresh for STALE_MS, blocking other sessions.
      // The lock is NOT released on success: the file watcher keeps writing the
      // store after the scan, so it stays held until shutdown or clearIndexData.
      const writer = await this._acquire()
      if (!writer) {
        // Contention is worth observing, not a silent park: the manager
        // surfaces start events as activity, so emit an error event the manager
        // can retry or display rather than leaving the session in Standby with
        // no record of the missed run.
        this.emitError(
          "orchestrator:startIndexing",
          new Error("Another session is indexing this workspace."),
          "scan",
          trigger,
        )
        this.stateManager.setSystemState("Standby", "Another session is indexing this workspace.")
        return
      }

      this.overlay?.prepare()
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

      if (this.overlay) {
        if (!collectionCreated) await this.vectorStore.clearCollection()
        await this.cacheManager.clearCacheFile()
        this.cacheManager.seedHashes(this.overlay.seed())
        await this.cacheManager.flush?.()
        log.info("seeded worktree index from shared baseline", {
          workspacePath: this.workspacePath,
          baselinePath: this.overlay.baselinePath,
          files: this.overlay.baseline.size,
        })
      }

      const index = this.overlay ? EMPTY : await this.vectorStore.state()
      // Only an empty store is safe to clear. A partial one belongs to a run
      // that died or is still going, and clearing it throws away every point
      // it managed to embed.
      if (!this.overlay && index.status === "empty") {
        if (!collectionCreated) await this.vectorStore.clearCollection()
        await this.cacheManager.clearCacheFile()
        log.info("cleared indexing cache before full scan", {
          workspacePath: this.workspacePath,
          collectionCreated,
        })
      }
      log.info("checked vector store indexed data", {
        workspacePath: this.workspacePath,
        status: index.status,
        collectionCreated,
      })

      if (this._cancelRequested) {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
        return
      }

      mode = index.status === "complete" && !collectionCreated ? "incremental" : "full"

      if (mode === "incremental") {
        log.info("collection has existing data, running incremental scan")

        this.stateManager.setSystemState("Indexing", "Checking for new or modified files...")
        await this.vectorStore.markIndexingIncomplete()
        await this._runScan(mode, trigger)
      } else {
        log.info("running full scan", {
          workspacePath: this.workspacePath,
          status: index.status,
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
      // The watcher is stopped, so this session no longer writes the store:
      // hand the lock back instead of holding it while wedged in Error.
      await this._releaseWriter()
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
      if (mode === "incremental") await this.vectorStore.markIndexingComplete()
      this.stateManager.setSystemState("Standby", "Indexing cancelled.")
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
      if (mode === "incremental" && result.stats.processed === 0 && batchErrors.length === 0) {
        await this.vectorStore.markIndexingComplete()
        log.info("preserved unchanged index after cancelled scan", { workspacePath: this.workspacePath })
      }
      this._isProcessing = false
      if (this.stateManager.state !== "Error") {
        this.stateManager.setSystemState("Standby", "Indexing cancelled.")
      }
      log.info("workspace scan cancelled", { workspacePath: this.workspacePath, mode })
      return
    }

    if (this.overlay && batchErrors.length > 0) {
      throw batchErrors[0]
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

    this.overlay?.reconcile(this.cacheManager.getAllHashes())
    await this.cacheManager.flush?.()
    await this.vectorStore.markIndexingComplete()
    // The scan finished, but this session's file watcher keeps writing the
    // store for every file change, so the session-held writer lock stays
    // acquired until shutdown or clearIndexData (see _writer). Releasing here
    // would let a second session acquire it and scan concurrently.
    this.fileWatcher.setCollecting(true)
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

  public async shutdown(): Promise<void> {
    this._cancelRequested = true
    this.scanner.cancel()
    // Stop the session's own watcher writes before releasing the writer lock:
    // the lock releases below, so the store must be quiet by then rather than
    // still receiving file-watcher batches.
    if (this.fileWatcher.shutdown) await this.fileWatcher.shutdown()
    else this.fileWatcher.dispose()
    this.fileWatcher.setCollecting(false)
    // Wait out the in-flight scan before closing the store: a scan that is
    // still running would lazily reconnect on its next getDb()/getTable() call,
    // reopening a connection close() just tore down and leaking it. Closing
    // after _active settles keeps the guarantee without racing the scan. The
    // next session cannot interleave here: it can only acquire the writer lock
    // once _releaseWriter runs below.
    await this._active
    await this.vectorStore.close?.()
    await this._releaseWriter()
    for (const sub of this._fileWatcherSubscriptions) sub.dispose()
    this._fileWatcherSubscriptions = []
    this._isProcessing = false
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
    // Keep the file watcher alive: cancel only aborts the scan, and the
    // session still holds the writer lock, so watcher batches continue to own
    // the store. Disposing here (via stopWatcher) would strand _active's
    // finally with a disposed watcher while file changes keep arriving.
    this.stateManager.setSystemState("Standby", "Indexing cancelled.")
    this._isProcessing = false
    log.info("indexing cancelled", { workspacePath: this.workspacePath })
  }

  public async clearIndexData(): Promise<void> {
    // Reuse the session-held lock when this session owns it: acquiring again
    // would contend with ourselves. Whatever the source, the watcher is
    // stopped below, so no writes remain and the lock is released afterwards.
    const writer = await this._acquire()
    if (!writer) {
      // A user-requested clear must not vanish silently when another session
      // holds the lock: surface contention as an error event with a
      // clear-specific location. The manager only auto-retries startIndexing
      // locations, so this stays terminal: the user sees the failure and can
      // retry the clear once the other session finishes.
      this.emitError(
        "orchestrator:clearIndexData",
        new Error("Another session is indexing this workspace; index data was not cleared."),
        "scan",
      )
      this.stateManager.setSystemState("Error", "Another session is indexing this workspace; index data was not cleared.")
      return
    }

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
      // stopWatcher() above means this session no longer writes the store, so
      // a session-held lock must be handed back rather than kept until exit.
      await this._releaseWriter()
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

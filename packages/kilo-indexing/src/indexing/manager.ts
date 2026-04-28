import type { VectorStoreSearchResult } from "./interfaces"
import type { IndexingState } from "./interfaces/manager"
import type { IndexingTelemetryEvent, IndexingTelemetryMeta, IndexingTelemetryTrigger } from "./interfaces/telemetry"
import { CodeIndexConfigManager, type IndexingConfigInput } from "./config-manager"
import { INITIAL_MANAGER_RECOVERY_DELAY_MS, MAX_MANAGER_RECOVERY_ATTEMPTS } from "./constants"
import { CodeIndexStateManager } from "./state-manager"
import { CodeIndexServiceFactory } from "./service-factory"
import { CodeIndexSearchService } from "./search-service"
import { CodeIndexOrchestrator } from "./orchestrator"
import { CacheManager } from "./cache-manager"
import { Emitter } from "./runtime"
import { Log } from "../util/log"
import { loadIgnore } from "./shared/load-ignore"
import { sanitizeErrorMessage } from "./shared/validation-helpers"

const log = Log.create({ service: "indexing-manager" })

/**
 * RATIONALE: Removed the static singleton Map and vscode.ExtensionContext.
 * The manager is now constructed directly with a workspace path and cache
 * directory. The host (CLI, extension) is responsible for managing instances
 * per workspace.
 */
export class CodeIndexManager {
  private _configManager: CodeIndexConfigManager | undefined
  private readonly _stateManager: CodeIndexStateManager
  private readonly _telemetry = new Emitter<IndexingTelemetryEvent>()
  private _serviceFactory: CodeIndexServiceFactory | undefined
  private _orchestrator: CodeIndexOrchestrator | undefined
  private _searchService: CodeIndexSearchService | undefined
  private _cacheManager: CacheManager | undefined
  private _isRecoveringFromError = false
  private _retryTimer: ReturnType<typeof setTimeout> | undefined
  private _retryResolve: (() => void) | undefined
  private _retryTask: Promise<void> | undefined
  private _retryAttempt = 0
  private _retryMaxAttempts = MAX_MANAGER_RECOVERY_ATTEMPTS
  private _retryInitialDelayMs = INITIAL_MANAGER_RECOVERY_DELAY_MS
  private _disposed = false

  constructor(
    public readonly workspacePath: string,
    private readonly cacheDirectory: string,
  ) {
    this._stateManager = new CodeIndexStateManager()
  }

  public get onProgressUpdate() {
    return this._stateManager.onProgressUpdate
  }

  public get onTelemetry() {
    return this._telemetry
  }

  private getTelemetryMeta(): IndexingTelemetryMeta | undefined {
    if (!this._configManager) {
      return undefined
    }
    const cfg = this._configManager.getConfig()
    return {
      provider: cfg.embedderProvider,
      vectorStore: cfg.vectorStoreProvider ?? "qdrant",
      modelId: cfg.modelId,
    }
  }

  private emitStart(trigger: IndexingTelemetryTrigger): void {
    const meta = this.getTelemetryMeta()
    if (!meta) {
      return
    }
    this._telemetry.fire({
      ...meta,
      type: "started",
      source: "scan",
      trigger,
    })
  }

  private emitError(location: string, err: unknown, trigger?: IndexingTelemetryTrigger): void {
    const meta = this.getTelemetryMeta()
    if (!meta) {
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    this._telemetry.fire({
      ...meta,
      type: "error",
      source: "scan",
      location,
      trigger,
      error: sanitizeErrorMessage(msg),
    })
  }

  private clearRetryTimer(): void {
    if (!this._retryTimer) {
      this._retryResolve = undefined
      return
    }
    clearTimeout(this._retryTimer)
    this._retryTimer = undefined
    this._retryResolve?.()
    this._retryResolve = undefined
  }

  private resetRetryState(): void {
    this._retryAttempt = 0
    this.clearRetryTimer()
  }

  private async waitForRetry(delay: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this._retryResolve = resolve
      this._retryTimer = setTimeout(() => {
        this._retryTimer = undefined
        this._retryResolve = undefined
        resolve()
      }, delay)
    })
  }

  private handleTelemetry(event: IndexingTelemetryEvent): void {
    this._telemetry.fire(event)

    if (event.type === "completed") {
      this.resetRetryState()
      return
    }

    if (event.type !== "error") return
    if (event.location !== "orchestrator:startIndexing") return
    if (!this.isFeatureEnabled || !this.isFeatureConfigured) return
    if (this._retryTask || this._isRecoveringFromError) return

    if (this._retryAttempt >= this._retryMaxAttempts) {
      log.warn("indexing recovery retries exhausted", {
        workspacePath: this.workspacePath,
        attempts: this._retryAttempt,
        maxAttempts: this._retryMaxAttempts,
      })
      return
    }

    void this.recoverFromError(event.trigger ?? "background")
  }

  private async runRecovery(trigger: IndexingTelemetryTrigger, attempt: number): Promise<void> {
    if (this._disposed) return

    this._isRecoveringFromError = true
    this._retryAttempt = attempt

    log.info("starting indexing error recovery attempt", {
      workspacePath: this.workspacePath,
      attempt,
      maxAttempts: this._retryMaxAttempts,
      trigger,
    })

    if (!this._configManager || !this._cacheManager) {
      log.warn("indexing recovery skipped: manager not initialized", {
        workspacePath: this.workspacePath,
      })
      this._isRecoveringFromError = false
      return
    }

    this._stateManager.setSystemState("Standby", "")

    try {
      await this._recreateServices()
      if (this._disposed) return
      this.emitStart(trigger)
      await this._orchestrator!.startIndexing(trigger)
      if (this._disposed) return
    } catch (err) {
      if (this._disposed) return
      log.error("indexing recovery attempt failed", {
        err,
        attempt,
      })
      this.emitError("manager:recoverFromError", err, trigger)
      this._stateManager.setSystemState(
        "Error",
        `Failed during recovery: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    const failed = this._orchestrator?.state === "Error" || this.getCurrentStatus().systemStatus === "Error"
    if (!failed) {
      this.resetRetryState()
      this._isRecoveringFromError = false
      log.info("completed indexing error recovery", {
        workspacePath: this.workspacePath,
        attempt,
      })
      return
    }

    if (attempt >= this._retryMaxAttempts) {
      this._isRecoveringFromError = false
      log.warn("indexing recovery reached max attempts", {
        workspacePath: this.workspacePath,
        attempts: attempt,
        maxAttempts: this._retryMaxAttempts,
      })
      return
    }

    const delay = this._retryInitialDelayMs * Math.pow(2, attempt - 1)
    await this.waitForRetry(delay)
    if (this._disposed) return
    this._isRecoveringFromError = false
    return this.runRecovery(trigger, attempt + 1)
  }

  private assertInitialized() {
    if (!this._configManager || !this._orchestrator || !this._searchService || !this._cacheManager) {
      throw new Error("CodeIndexManager not initialized. Call initialize() first.")
    }
  }

  public get state(): IndexingState {
    if (!this.isFeatureEnabled) return "Standby"
    return this._orchestrator?.state ?? this._stateManager.state
  }

  public get isFeatureEnabled(): boolean {
    return this._configManager?.isFeatureEnabled ?? false
  }

  public get isFeatureConfigured(): boolean {
    return this._configManager?.isFeatureConfigured ?? false
  }

  public get isInitialized(): boolean {
    try {
      this.assertInitialized()
      return true
    } catch (e) {
      log.warn(`CodeIndexManager not initialized: ${e}`)
      return false
    }
  }

  public async initialize(input: IndexingConfigInput): Promise<{ requiresRestart: boolean }> {
    if (this._disposed) return { requiresRestart: false }

    if (!this._configManager) {
      this._configManager = new CodeIndexConfigManager(input)
      log.info("created indexing config manager", { workspacePath: this.workspacePath })
    }

    const { requiresRestart } = this._configManager.loadConfiguration(input)
    log.info("loaded indexing configuration", {
      workspacePath: this.workspacePath,
      featureEnabled: this.isFeatureEnabled,
      featureConfigured: this.isFeatureConfigured,
      requiresRestart,
      provider: this._configManager.currentEmbedderProvider,
      vectorStore: this._configManager.getConfig().vectorStoreProvider,
    })

    if (!this.isFeatureEnabled) {
      log.info("indexing disabled by configuration", { workspacePath: this.workspacePath })
      this._orchestrator?.stopWatcher()
      return { requiresRestart }
    }

    if (!this.workspacePath) {
      log.info("indexing unavailable: no workspace path")
      this._stateManager.setSystemState("Standby", "No workspace folder open")
      return { requiresRestart }
    }

    if (!this.isFeatureConfigured) {
      log.info("indexing enabled but not configured", {
        workspacePath: this.workspacePath,
        provider: this._configManager.currentEmbedderProvider,
      })
      this._orchestrator?.cancelIndexing()
      this._stateManager.setSystemState(
        "Standby",
        "Code indexing is not configured. Save your settings to start indexing.",
      )
      return { requiresRestart }
    }

    if (!this._cacheManager) {
      log.info("initializing indexing cache", { cacheDirectory: this.cacheDirectory })
      this._cacheManager = new CacheManager(this.cacheDirectory, this.workspacePath)
      await this._cacheManager.initialize()
      if (this._disposed) return { requiresRestart }
      log.info("indexing cache initialized", { cacheDirectory: this.cacheDirectory })
    }

    const needsServiceRecreation = !this._serviceFactory || requiresRestart
    log.info("evaluated indexing service lifecycle", {
      needsServiceRecreation,
      requiresRestart,
      hasServiceFactory: !!this._serviceFactory,
    })

    if (needsServiceRecreation) {
      try {
        log.info("recreating indexing services", { workspacePath: this.workspacePath })
        await this._recreateServices()
        if (this._disposed) {
          this._orchestrator?.cancelIndexing()
          this._orchestrator = undefined
          this._searchService = undefined
          return { requiresRestart }
        }
        log.info("indexing services recreated", { workspacePath: this.workspacePath })
      } catch (err) {
        log.error("failed to recreate services", { err })
        this.emitError("manager:initialize", err, "background")
        this._stateManager.setSystemState(
          "Error",
          `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        )
        throw err
      }
    }

    const shouldStartOrRestart =
      requiresRestart || (needsServiceRecreation && (!this._orchestrator || this._orchestrator.state !== "Indexing"))

    if (shouldStartOrRestart && !this._disposed) {
      log.info("starting background indexing", {
        workspacePath: this.workspacePath,
        requiresRestart,
        orchestratorState: this._orchestrator?.state,
      })
      this.emitStart("background")
      // Fire and forget — indexing is a long-running background process
      this._orchestrator?.startIndexing("background")
    }

    return { requiresRestart }
  }

  public async startIndexing(): Promise<void> {
    if (this._disposed) return
    if (!this.isFeatureEnabled) return

    log.info("manual indexing start requested", { workspacePath: this.workspacePath })

    const currentStatus = this.getCurrentStatus()
    if (currentStatus.systemStatus === "Error") {
      log.info("recovering from indexing error state before restart", {
        workspacePath: this.workspacePath,
        message: currentStatus.message,
      })
      this.resetRetryState()
      await this.recoverFromError("manual")
      return
    }

    this.assertInitialized()
    this.emitStart("manual")
    log.info("delegating manual indexing start to orchestrator", { workspacePath: this.workspacePath })
    await this._orchestrator!.startIndexing("manual")
  }

  public stopWatcher(): void {
    if (!this.isFeatureEnabled) return
    this._orchestrator?.stopWatcher()
  }

  public cancelIndexing(): void {
    if (!this.isFeatureEnabled) return
    this._orchestrator?.cancelIndexing()
  }

  public updateBatchSegmentThreshold(newThreshold: number): void {
    this._orchestrator?.updateBatchSegmentThreshold(newThreshold)
  }

  public async recoverFromError(trigger: IndexingTelemetryTrigger = "background"): Promise<void> {
    if (this._disposed) return
    if (this._retryTask) {
      await this._retryTask
      return
    }

    const attempt = this._retryAttempt + 1
    if (attempt > this._retryMaxAttempts) {
      log.warn("indexing recovery skipped: retry budget exhausted", {
        workspacePath: this.workspacePath,
        attempts: this._retryAttempt,
        maxAttempts: this._retryMaxAttempts,
      })
      return
    }

    const task = this.runRecovery(trigger, attempt).finally(() => {
      this._retryTask = undefined
      this._isRecoveringFromError = false
      this.clearRetryTimer()
    })
    this._retryTask = task
    await task
  }

  public dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.clearRetryTimer()
    this._retryTask = undefined
    // RATIONALE: cancelIndexing() sets _cancelRequested and calls stopWatcher() +
    // scanner.cancel(), which cooperatively aborts any in-flight scan. Using only
    // stopWatcher() left the orchestrator's _runScan() unaware it should exit.
    this._orchestrator?.cancelIndexing()
    this._stateManager.dispose()
    this._telemetry.dispose()
  }

  public async clearIndexData(): Promise<void> {
    if (!this.isFeatureEnabled) return
    this.assertInitialized()
    await this._orchestrator!.clearIndexData()
    await this._cacheManager!.clearCacheFile()
  }

  public clearErrorState(): void {
    this._stateManager.setSystemState("Standby", "")
  }

  public getCurrentStatus() {
    const status = this._stateManager.getCurrentStatus()
    return { ...status, workspacePath: this.workspacePath }
  }

  public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
    if (!this.isFeatureEnabled) return []
    this.assertInitialized()
    return this._searchService!.searchIndex(query, directoryPrefix)
  }

  private async _recreateServices(): Promise<void> {
    log.info("starting indexing service recreation", { workspacePath: this.workspacePath })
    this._orchestrator?.stopWatcher()
    this._orchestrator = undefined
    this._searchService = undefined

    this._serviceFactory = new CodeIndexServiceFactory(
      this._configManager!,
      this.workspacePath,
      this._cacheManager!,
      this.cacheDirectory,
      (event) => this.handleTelemetry(event),
    )

    const ignoreInstance = await loadIgnore(this.workspacePath)

    const config = this._configManager!.getConfig()
    const { embedder, vectorStore, scanner, fileWatcher } = this._serviceFactory.createServices(
      this._cacheManager!,
      ignoreInstance,
    )
    log.info("created indexing services", {
      workspacePath: this.workspacePath,
      provider: embedder.embedderInfo.name,
      vectorStore: config.vectorStoreProvider,
      model: config.modelId ?? "default",
    })

    const shouldValidate = embedder && embedder.embedderInfo.name === config.embedderProvider

    if (shouldValidate) {
      log.info("validating embedder configuration", {
        workspacePath: this.workspacePath,
        provider: embedder.embedderInfo.name,
      })
      const validationResult = await this._serviceFactory.validateEmbedder(embedder)
      if (!validationResult.valid) {
        const errorMessage = validationResult.error || "Embedder configuration validation failed"
        this._stateManager.setSystemState("Error", errorMessage)
        throw new Error(errorMessage)
      }
      log.info("embedder configuration validated", {
        workspacePath: this.workspacePath,
        provider: embedder.embedderInfo.name,
      })
    }

    this._orchestrator = new CodeIndexOrchestrator(
      this._configManager!,
      this._stateManager,
      this.workspacePath,
      this._cacheManager!,
      vectorStore,
      scanner,
      fileWatcher,
      (event) => this.handleTelemetry(event),
    )

    this._searchService = new CodeIndexSearchService(this._configManager!, this._stateManager, embedder, vectorStore)

    this._stateManager.setSystemState("Standby", "")
    log.info("indexing services are ready", { workspacePath: this.workspacePath })
  }

  public async handleSettingsChange(input: IndexingConfigInput): Promise<void> {
    if (!this._configManager) return

    const { requiresRestart } = this._configManager.loadConfiguration(input)
    log.info("processed indexing settings change", {
      workspacePath: this.workspacePath,
      featureEnabled: this.isFeatureEnabled,
      featureConfigured: this.isFeatureConfigured,
      requiresRestart,
    })

    if (!this.isFeatureEnabled) {
      this._orchestrator?.stopWatcher()
      this._stateManager.setSystemState("Standby", "Code indexing is disabled")
      return
    }

    if (requiresRestart && this.isFeatureEnabled && this.isFeatureConfigured) {
      try {
        if (!this._cacheManager) {
          this._cacheManager = new CacheManager(this.cacheDirectory, this.workspacePath)
          await this._cacheManager.initialize()
        }
        await this._recreateServices()
      } catch (err) {
        log.error("failed to recreate services on settings change", { err })
        throw err
      }
    }
  }
}

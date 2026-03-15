// kilocode_change - new file

import type { VectorStoreSearchResult } from "./interfaces"
import type { IndexingState } from "./interfaces/manager"
import { CodeIndexConfigManager, type IndexingConfigInput } from "./config-manager"
import { CodeIndexStateManager } from "./state-manager"
import { CodeIndexServiceFactory } from "./service-factory"
import { CodeIndexSearchService } from "./search-service"
import { CodeIndexOrchestrator } from "./orchestrator"
import { CacheManager } from "./cache-manager"
import fs from "fs/promises"
import ignore from "ignore"
import path from "path"
import { Log } from "../util/log"

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
  private _serviceFactory: CodeIndexServiceFactory | undefined
  private _orchestrator: CodeIndexOrchestrator | undefined
  private _searchService: CodeIndexSearchService | undefined
  private _cacheManager: CacheManager | undefined
  private _isRecoveringFromError = false

  constructor(
    public readonly workspacePath: string,
    private readonly cacheDirectory: string,
  ) {
    this._stateManager = new CodeIndexStateManager()
  }

  public get onProgressUpdate() {
    return this._stateManager.onProgressUpdate
  }

  private assertInitialized() {
    if (!this._configManager || !this._orchestrator || !this._searchService || !this._cacheManager) {
      throw new Error("CodeIndexManager not initialized. Call initialize() first.")
    }
  }

  public get state(): IndexingState {
    if (!this.isFeatureEnabled) return "Standby"
    this.assertInitialized()
    return this._orchestrator!.state
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
    } catch {
      return false
    }
  }

  public async initialize(input: IndexingConfigInput): Promise<{ requiresRestart: boolean }> {
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

    if (!this._cacheManager) {
      log.info("initializing indexing cache", { cacheDirectory: this.cacheDirectory })
      this._cacheManager = new CacheManager(this.cacheDirectory, this.workspacePath)
      await this._cacheManager.initialize()
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
        log.info("indexing services recreated", { workspacePath: this.workspacePath })
      } catch (err) {
        log.error("failed to recreate services", { err })
        this._stateManager.setSystemState(
          "Error",
          `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        )
        throw err
      }
    }

    const shouldStartOrRestart =
      requiresRestart || (needsServiceRecreation && (!this._orchestrator || this._orchestrator.state !== "Indexing"))

    if (shouldStartOrRestart) {
      log.info("starting background indexing", {
        workspacePath: this.workspacePath,
        requiresRestart,
        orchestratorState: this._orchestrator?.state,
      })
      // Fire and forget — indexing is a long-running background process
      this._orchestrator?.startIndexing()
    }

    return { requiresRestart }
  }

  public async startIndexing(): Promise<void> {
    if (!this.isFeatureEnabled) return

    log.info("manual indexing start requested", { workspacePath: this.workspacePath })

    const currentStatus = this.getCurrentStatus()
    if (currentStatus.systemStatus === "Error") {
      log.info("recovering from indexing error state before restart", {
        workspacePath: this.workspacePath,
        message: currentStatus.message,
      })
      await this.recoverFromError()
      return
    }

    this.assertInitialized()
    log.info("delegating manual indexing start to orchestrator", { workspacePath: this.workspacePath })
    await this._orchestrator!.startIndexing()
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

  public async recoverFromError(): Promise<void> {
    if (this._isRecoveringFromError) return

    this._isRecoveringFromError = true
    log.info("starting indexing error recovery", { workspacePath: this.workspacePath })
    try {
      this._stateManager.setSystemState("Standby", "")
    } catch (err) {
      log.error("failed to clear error state during recovery", { err })
    } finally {
      this._configManager = undefined
      this._serviceFactory = undefined
      this._orchestrator = undefined
      this._searchService = undefined
      this._isRecoveringFromError = false
      log.info("completed indexing error recovery", { workspacePath: this.workspacePath })
    }
  }

  public dispose(): void {
    this._orchestrator?.stopWatcher()
    this._stateManager.dispose()
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

    this._serviceFactory = new CodeIndexServiceFactory(this._configManager!, this.workspacePath, this._cacheManager!)

    const ignoreInstance = ignore()

    const ignorePath = path.join(this.workspacePath, ".gitignore")
    try {
      const content = await fs.readFile(ignorePath, "utf8")
      ignoreInstance.add(content)
      ignoreInstance.add(".gitignore")
    } catch {
      // .gitignore may not exist
    }

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

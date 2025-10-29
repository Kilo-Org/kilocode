import * as vscode from "vscode"
import { ContextProxy } from "../../core/config/ContextProxy"
import { VectorStoreSearchResult } from "./interfaces"
import { IndexingState } from "./interfaces/manager"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager } from "./state-manager"
import { CodeIndexServiceFactory } from "./service-factory"
import { CodeIndexSearchService } from "./search-service"
import { CodeIndexOrchestrator } from "./orchestrator"
import { CacheManager } from "./cache-manager"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import { DirectoryScanner } from "./processors"
import fs from "fs/promises"
import ignore from "ignore"
import path from "path"
import { t } from "../../i18n"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import {
	startIndexing as startManagedIndexing,
	search as searchManaged,
	createManagedIndexingConfig,
	getIndexerState as getManagedIndexerState,
} from "./managed"
import type { IndexerState as ManagedIndexerState } from "./managed"

export class CodeIndexManager {
	// --- Singleton Implementation ---
	private static instances = new Map<string, CodeIndexManager>() // Map workspace path to instance

	// Specialized class instances
	private _configManager: CodeIndexConfigManager | undefined
	private readonly _stateManager: CodeIndexStateManager
	private _serviceFactory: CodeIndexServiceFactory | undefined
	private _orchestrator: CodeIndexOrchestrator | undefined
	private _searchService: CodeIndexSearchService | undefined
	private _cacheManager: CacheManager | undefined

	// Managed indexing (new standalone system)
	private _managedIndexerDisposable: vscode.Disposable | undefined
	private _managedIndexerState: ManagedIndexerState | undefined

	// Flag to prevent race conditions during error recovery
	private _isRecoveringFromError = false

	public static getInstance(context: vscode.ExtensionContext, workspacePath?: string): CodeIndexManager | undefined {
		// If workspacePath is not provided, try to get it from the active editor or first workspace folder
		if (!workspacePath) {
			const activeEditor = vscode.window.activeTextEditor
			if (activeEditor) {
				const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
				workspacePath = workspaceFolder?.uri.fsPath
			}

			if (!workspacePath) {
				const workspaceFolders = vscode.workspace.workspaceFolders
				if (!workspaceFolders || workspaceFolders.length === 0) {
					return undefined
				}
				// Use the first workspace folder as fallback
				workspacePath = workspaceFolders[0].uri.fsPath
			}
		}

		if (!CodeIndexManager.instances.has(workspacePath)) {
			CodeIndexManager.instances.set(workspacePath, new CodeIndexManager(workspacePath, context))
		}
		return CodeIndexManager.instances.get(workspacePath)!
	}

	public static disposeAll(): void {
		for (const instance of CodeIndexManager.instances.values()) {
			instance.dispose()
		}
		CodeIndexManager.instances.clear()
	}

	public readonly workspacePath: string
	private readonly context: vscode.ExtensionContext

	// Private constructor for singleton pattern
	private constructor(workspacePath: string, context: vscode.ExtensionContext) {
		this.workspacePath = workspacePath
		this.context = context
		this._stateManager = new CodeIndexStateManager()
	}

	// --- Public API ---

	public get onProgressUpdate() {
		return this._stateManager.onProgressUpdate
	}

	private assertInitialized() {
		if (!this._configManager || !this._orchestrator || !this._searchService || !this._cacheManager) {
			throw new Error("CodeIndexManager not initialized. Call initialize() first.")
		}
	}

	public get state(): IndexingState {
		if (!this.isFeatureEnabled) {
			return "Standby"
		}
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
		} catch (error) {
			return false
		}
	}

	/**
	 * Initializes the manager with configuration and dependent services.
	 * Must be called before using any other methods.
	 * @returns Object indicating if a restart is needed
	 */
	public async initialize(contextProxy: ContextProxy): Promise<{ requiresRestart: boolean }> {
		// 1. ConfigManager Initialization and Configuration Loading
		if (!this._configManager) {
			this._configManager = new CodeIndexConfigManager(contextProxy)
		}

		// Pass Kilo org props to config manager if available
		if (this._kiloOrgCodeIndexProps) {
			this._configManager.setKiloOrgProps(this._kiloOrgCodeIndexProps)
		}

		// Load configuration once to get current state and restart requirements
		const { requiresRestart } = await this._configManager.loadConfiguration()

		// 2. Check if feature is enabled
		if (!this.isFeatureEnabled) {
			if (this._orchestrator) {
				this._orchestrator.stopWatcher()
			}
			return { requiresRestart }
		}

		// 3. Check if workspace is available
		const workspacePath = this.workspacePath
		if (!workspacePath) {
			this._stateManager.setSystemState("Standby", "No workspace folder open")
			return { requiresRestart }
		}

		// 4. CacheManager Initialization
		if (!this._cacheManager) {
			this._cacheManager = new CacheManager(this.context, this.workspacePath)
			await this._cacheManager.initialize()
		}

		// 4. Determine if Core Services Need Recreation
		const needsServiceRecreation = !this._serviceFactory || requiresRestart

		if (needsServiceRecreation) {
			try {
				await this._recreateServices()
			} catch (error) {
				// Log the error and set error state
				console.error("[CodeIndexManager] Failed to recreate services:", error)
				this._stateManager.setSystemState(
					"Error",
					`Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
				)
				// Re-throw to prevent further initialization
				throw error
			}
		}

		// 5. Handle Indexing Start/Restart
		// The enhanced vectorStore.initialize() in startIndexing() now handles dimension changes automatically
		// by detecting incompatible collections and recreating them, so we rely on that for dimension changes
		const shouldStartOrRestartIndexing =
			requiresRestart ||
			(needsServiceRecreation && (!this._orchestrator || this._orchestrator.state !== "Indexing"))

		if (shouldStartOrRestartIndexing) {
			this._orchestrator?.startIndexing() // This method is async, but we don't await it here
		}

		return { requiresRestart }
	}

	/**
	 * Initiates the indexing process (initial scan and starts watcher).
	 * Automatically recovers from error state if needed before starting.
	 *
	 * @important This method should NEVER be awaited as it starts a long-running background process.
	 * The indexing will continue asynchronously and progress will be reported through events.
	 */
	public async startIndexing(): Promise<void> {
		if (!this.isFeatureEnabled) {
			return
		}

		// Check if we're in error state and recover if needed
		const currentStatus = this.getCurrentStatus()
		if (currentStatus.systemStatus === "Error") {
			await this.recoverFromError()

			// After recovery, we need to reinitialize since recoverFromError clears all services
			// This will be handled by the caller (webviewMessageHandler) checking isInitialized
			return
		}

		this.assertInitialized()
		await this._orchestrator!.startIndexing()
	}

	/**
	 * Stops the file watcher and potentially cleans up resources.
	 */
	public stopWatcher(): void {
		if (!this.isFeatureEnabled) {
			return
		}
		if (this._orchestrator) {
			this._orchestrator.stopWatcher()
		}
	}

	// kilocode_change start
	/**
	 * Cancel any active indexing activity immediately.
	 */
	public cancelIndexing(): void {
		if (!this.isFeatureEnabled) {
			return
		}
		if (this._orchestrator) {
			this._orchestrator.cancelIndexing()
		}
	}
	// kilocode_change end

	/**
	 * Recovers from error state by clearing the error and resetting internal state.
	 * This allows the manager to be re-initialized after a recoverable error.
	 *
	 * This method clears all service instances (configManager, serviceFactory, orchestrator, searchService)
	 * to force a complete re-initialization on the next operation. This ensures a clean slate
	 * after recovering from errors such as network failures or configuration issues.
	 *
	 * @remarks
	 * - Safe to call even when not in error state (idempotent)
	 * - Does not restart indexing automatically - call initialize() after recovery
	 * - Service instances will be recreated on next initialize() call
	 * - Prevents race conditions from multiple concurrent recovery attempts
	 */
	public async recoverFromError(): Promise<void> {
		// Prevent race conditions from multiple rapid recovery attempts
		if (this._isRecoveringFromError) {
			return
		}

		this._isRecoveringFromError = true
		try {
			// Clear error state
			this._stateManager.setSystemState("Standby", "")
		} catch (error) {
			// Log error but continue with recovery - clearing service instances is more important
			console.error("Failed to clear error state during recovery:", error)
		} finally {
			// Force re-initialization by clearing service instances
			// This ensures a clean slate even if state update failed
			this._configManager = undefined
			this._serviceFactory = undefined
			this._orchestrator = undefined
			this._searchService = undefined

			// Reset the flag after recovery is complete
			this._isRecoveringFromError = false
		}
	}

	/**
	 * Cleans up the manager instance.
	 */
	public dispose(): void {
		if (this._orchestrator) {
			this.stopWatcher()
		}
		if (this._managedIndexerDisposable) {
			this._managedIndexerDisposable.dispose()
			this._managedIndexerDisposable = undefined
		}
		this._stateManager.dispose()
	}

	/**
	 * Clears all index data by stopping the watcher, clearing the Qdrant collection,
	 * and deleting the cache file.
	 */
	public async clearIndexData(): Promise<void> {
		if (!this.isFeatureEnabled) {
			return
		}
		this.assertInitialized()
		await this._orchestrator!.clearIndexData()
		await this._cacheManager!.clearCacheFile()
	}

	// --- Private Helpers ---

	public getCurrentStatus() {
		const status = this._stateManager.getCurrentStatus()
		return {
			...status,
			workspacePath: this.workspacePath,
		}
	}

	public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
		// Route to managed indexing if available
		if (this.isManagedIndexingAvailable) {
			return this.searchManagedIndex(query, directoryPrefix)
		}

		// Fall back to local indexing
		if (!this.isFeatureEnabled) {
			return []
		}
		this.assertInitialized()
		return this._searchService!.searchIndex(query, directoryPrefix)
	}

	/**
	 * Private helper method to recreate services with current configuration.
	 * Used by both initialize() and handleSettingsChange().
	 */
	private async _recreateServices(): Promise<void> {
		// Stop watcher if it exists
		if (this._orchestrator) {
			this.stopWatcher()
		}
		// Clear existing services to ensure clean state
		this._orchestrator = undefined
		this._searchService = undefined

		// (Re)Initialize service factory
		this._serviceFactory = new CodeIndexServiceFactory(
			this._configManager!,
			this.workspacePath,
			this._cacheManager!,
		)

		const ignoreInstance = ignore()
		const workspacePath = this.workspacePath

		if (!workspacePath) {
			this._stateManager.setSystemState("Standby", "")
			return
		}

		// Create .gitignore instance
		const ignorePath = path.join(workspacePath, ".gitignore")
		try {
			const content = await fs.readFile(ignorePath, "utf8")
			ignoreInstance.add(content)
			ignoreInstance.add(".gitignore")
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			console.error("Unexpected error loading .gitignore:", error)
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "_recreateServices",
			})
		}

		// Create RooIgnoreController instance
		const rooIgnoreController = new RooIgnoreController(workspacePath)
		await rooIgnoreController.initialize()

		// (Re)Create shared service instances
		const { embedder, vectorStore, scanner, fileWatcher } = this._serviceFactory.createServices(
			this.context,
			this._cacheManager!,
			ignoreInstance,
			rooIgnoreController,
		)

		// kilocode_change start: Handle Kilo org mode (no embedder/vector store validation needed)
		const isKiloOrgMode = this._configManager!.isKiloOrgMode

		if (!isKiloOrgMode) {
			// Only validate the embedder if it matches the currently configured provider
			const config = this._configManager!.getConfig()
			const shouldValidate = embedder && embedder.embedderInfo.name === config.embedderProvider

			if (shouldValidate) {
				const validationResult = await this._serviceFactory.validateEmbedder(embedder)
				if (!validationResult.valid) {
					const errorMessage = validationResult.error || "Embedder configuration validation failed"
					this._stateManager.setSystemState("Error", errorMessage)
					throw new Error(errorMessage)
				}
			}
		}
		// kilocode_change end

		// (Re)Initialize orchestrator
		this._orchestrator = new CodeIndexOrchestrator(
			this._configManager!,
			this._stateManager,
			this.workspacePath,
			this._cacheManager!,
			vectorStore!,
			scanner,
			fileWatcher!,
		)

		// kilocode_change start: Always create search service (it handles both local and Kilo org mode)
		// In Kilo org mode, embedder and vectorStore will be null, but search service handles this
		this._searchService = new CodeIndexSearchService(
			this._configManager!,
			this._stateManager,
			embedder!,
			vectorStore!,
		)
		// kilocode_change end

		// Clear any error state after successful recreation
		this._stateManager.setSystemState("Standby", "")

		// Update scanner with Kilo org props if they exist
		this._updateScannerWithKiloProps()
	}

	/**
	 * Handle code index settings changes.
	 * This method should be called when code index settings are updated
	 * to ensure the CodeIndexConfigManager picks up the new configuration.
	 * If the configuration changes require a restart, the service will be restarted.
	 */
	public async handleSettingsChange(): Promise<void> {
		if (this._configManager) {
			const { requiresRestart } = await this._configManager.loadConfiguration()

			const isFeatureEnabled = this.isFeatureEnabled
			const isFeatureConfigured = this.isFeatureConfigured

			// If feature is disabled, stop the service
			if (!isFeatureEnabled) {
				// Stop the orchestrator if it exists
				if (this._orchestrator) {
					this._orchestrator.stopWatcher()
				}
				// Set state to indicate service is disabled
				this._stateManager.setSystemState("Standby", "Code indexing is disabled")
				return
			}

			if (requiresRestart && isFeatureEnabled && isFeatureConfigured) {
				try {
					// Ensure cacheManager is initialized before recreating services
					if (!this._cacheManager) {
						this._cacheManager = new CacheManager(this.context, this.workspacePath)
						await this._cacheManager.initialize()
					}

					// Recreate services with new configuration
					await this._recreateServices()
				} catch (error) {
					// Error state already set in _recreateServices
					console.error("Failed to recreate services:", error)
					TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
						error: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
						location: "handleSettingsChange",
					})
					// Re-throw the error so the caller knows validation failed
					throw error
				}
			}
		}
	}

	// kilocode_change start Add ability to set kilo specific props
	private _kiloOrgCodeIndexProps: {
		organizationId: string
		kilocodeToken: string
		projectId: string
	} | null = null

	public setKiloOrgCodeIndexProps(props: NonNullable<typeof this._kiloOrgCodeIndexProps>) {
		this._kiloOrgCodeIndexProps = props

		// Pass props to config manager if it exists
		if (this._configManager) {
			this._configManager.setKiloOrgProps(props)
		}

		// Start managed indexing automatically
		this.startManagedIndexing().catch((error) => {
			const err = error instanceof Error ? error : new Error(String(error))
			console.error("[CodeIndexManager] Failed to start managed indexing:", err.message)
			if (err.stack) {
				console.error("[CodeIndexManager] Stack trace:", err.stack)
			}
			// Don't throw - allow the manager to continue functioning
			// Set error state so UI can show the issue
			this._stateManager.setSystemState("Error", `Failed to start indexing: ${err.message}`)
		})

		// Pass the props to the scanner through the service factory
		// The scanner will be updated when services are recreated
		this._updateScannerWithKiloProps()
	}

	public getKiloOrgCodeIndexProps() {
		return this._kiloOrgCodeIndexProps
	}

	/**
	 * Updates the scanner with Kilo org props if available
	 * This is called after services are created or when props are set
	 */
	private _updateScannerWithKiloProps(): void {
		if (this._kiloOrgCodeIndexProps && this._orchestrator) {
			const scanner = (this._orchestrator as any).scanner
			if (scanner && typeof scanner.setKiloOrgCodeIndexProps === "function") {
				scanner.setKiloOrgCodeIndexProps(this._kiloOrgCodeIndexProps)
			}
		}
	}
	// kilocode_change end

	// --- Managed Indexing Methods ---

	/**
	 * Starts the managed indexer (for organization users)
	 * This is the new standalone indexing system that uses delta-based indexing
	 */
	public async startManagedIndexing(): Promise<void> {
		if (!this._kiloOrgCodeIndexProps) {
			throw new Error("Managed indexing requires organization credentials")
		}

		try {
			// Stop any existing managed indexer
			if (this._managedIndexerDisposable) {
				this._managedIndexerDisposable.dispose()
				this._managedIndexerDisposable = undefined
			}

			// Create configuration
			const config = createManagedIndexingConfig(
				this._kiloOrgCodeIndexProps.organizationId,
				this._kiloOrgCodeIndexProps.projectId,
				this._kiloOrgCodeIndexProps.kilocodeToken,
				this.workspacePath,
			)

			// Start indexing
			this._managedIndexerDisposable = await startManagedIndexing(config, this.context, (state) => {
				this._managedIndexerState = state
				// Emit state change event through state manager
				// Map managed indexer states to system states:
				// - "error" → "Error"
				// - "scanning" → "Indexing"
				// - "watching" → "Indexed" (has data and watching for changes)
				// - "idle" → "Standby" (no data or needs re-scan)
				let systemState: "Standby" | "Indexing" | "Indexed" | "Error"
				if (state.status === "error") {
					systemState = "Error"
				} else if (state.status === "scanning") {
					systemState = "Indexing"
				} else if (state.status === "watching") {
					systemState = "Indexed"
				} else {
					// "idle" or any other status
					systemState = "Standby"
				}

				this._stateManager.setSystemState(systemState, state.message)
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error("[CodeIndexManager] Failed to start managed indexing:", error)
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
				location: "startManagedIndexing",
			})
			throw error
		}
	}

	/**
	 * Stops the managed indexer
	 */
	public stopManagedIndexing(): void {
		if (this._managedIndexerDisposable) {
			this._managedIndexerDisposable.dispose()
			this._managedIndexerDisposable = undefined
			this._managedIndexerState = undefined
		}
	}

	/**
	 * Searches using the managed indexer
	 */
	public async searchManagedIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
		if (!this._kiloOrgCodeIndexProps) {
			return []
		}

		try {
			const config = createManagedIndexingConfig(
				this._kiloOrgCodeIndexProps.organizationId,
				this._kiloOrgCodeIndexProps.projectId,
				this._kiloOrgCodeIndexProps.kilocodeToken,
				this.workspacePath,
			)

			const results = await searchManaged(query, config, directoryPrefix)

			// Convert to VectorStoreSearchResult format
			return results.map((result) => ({
				id: result.id,
				score: result.score,
				payload: {
					filePath: result.filePath,
					codeChunk: "", // Managed indexing doesn't return code chunks
					startLine: result.startLine,
					endLine: result.endLine,
				},
			}))
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error("[CodeIndexManager] Managed search failed:", error)
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
				location: "searchManagedIndex",
			})
			return []
		}
	}

	/**
	 * Gets the managed indexer state
	 */
	public getManagedIndexerState(): ManagedIndexerState | undefined {
		return this._managedIndexerState
	}

	/**
	 * Checks if managed indexing is available (has org credentials)
	 */
	public get isManagedIndexingAvailable(): boolean {
		return !!this._kiloOrgCodeIndexProps
	}
}

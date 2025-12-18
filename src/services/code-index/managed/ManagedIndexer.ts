// kilocode_change new file

import * as vscode from "vscode"
import * as path from "path"
import { promises as fs } from "fs"
import pMap from "p-map"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { KiloOrganization } from "../../../shared/kilocode/organization"
import { OrganizationService } from "../../kilocode/OrganizationService"
import { GitWatcher, GitWatcherEvent } from "../../../shared/GitWatcher"
import { getCurrentBranch, isGitRepository, getCurrentCommitSha, getBaseBranch } from "./git-utils"
import { getKilocodeConfig } from "../../../utils/kilo-config-file"
import { getGitRepositoryInfo } from "../../../utils/git"
import { getServerManifest, searchCode, upsertFile, deleteFiles, isEnabled } from "./api-client"
import { ServerManifest } from "./types"
import { scannerExtensions } from "../shared/supported-extensions"
import { VectorStoreSearchResult } from "../interfaces/vector-store"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import { shouldIgnoreFile } from "./ignore-list"

interface ManagedIndexerConfig {
	kilocodeToken: string | null
	kilocodeOrganizationId: string | null
	kilocodeTesterWarningsDisabledUntil: number | null
}

/**
 * Serializable error information for managed indexing operations
 */
interface ManagedIndexerError {
	/** Error type for categorization */
	type: "setup" | "scan" | "file-upsert" | "git" | "manifest" | "config"
	/** Human-readable error message */
	message: string
	/** ISO timestamp when error occurred */
	timestamp: string
	/** Optional context about what was being attempted */
	context?: {
		filePath?: string
		branch?: string
		operation?: string
	}
	/** Original error details if available */
	details?: string
}

interface ManagedIndexerWorkspaceFolderState {
	workspaceFolder: vscode.WorkspaceFolder
	gitBranch: string | null
	projectId: string | null
	manifest: ServerManifest | null
	isIndexing: boolean
	watcher: GitWatcher | null
	repositoryUrl?: string
	error?: ManagedIndexerError
	/** In-flight manifest fetch promise - reused if already fetching */
	manifestFetchPromise: Promise<ServerManifest> | null
	/** AbortController for the current indexing operation */
	currentAbortController?: AbortController
	ignoreController: RooIgnoreController | null
}

function logGitEvent(event: GitWatcherEvent) {
	// Handle different event types
	switch (event.type) {
		case "branch-changed": {
			console.info(`[ManagedIndexer] Branch changed from ${event.previousBranch} to ${event.newBranch}`)
			break
		}

		case "commit": {
			console.info(`[ManagedIndexer] Commit detected from ${event.previousCommit} to ${event.newCommit}`)
			break
		}

		case "start": {
			console.info(
				`[ManagedIndexer] Watcher started on branch ${event.branch} ${event.isBaseBranch ? `(base)` : `(feature)`} - doing initial indexing`,
			)
			break
		}
	}
}

/**
 * Serialize workspace folder state to a plain object for communication
 * @param state The workspace folder state to serialize
 * @returns A serializable object representation of the state
 */
function serializeWorkspaceFolderState(state: ManagedIndexerWorkspaceFolderState) {
	return {
		workspaceFolderPath: state.workspaceFolder.uri.fsPath,
		workspaceFolderName: state.workspaceFolder.name,
		gitBranch: state.gitBranch,
		projectId: state.projectId,
		repositoryUrl: state.repositoryUrl,
		isIndexing: state.isIndexing,
		hasManifest: !!state.manifest,
		manifestFileCount: state.manifest ? Object.keys(state.manifest.files).length : 0,
		hasWatcher: !!state.watcher,
		error: state.error
			? {
					type: state.error.type,
					message: state.error.message,
					timestamp: state.error.timestamp,
					context: state.error.context,
				}
			: undefined,
	}
}

export class ManagedIndexer implements vscode.Disposable {
	private static prevInstance: ManagedIndexer | null = null
	private disabledViaConfig: boolean = false
	private enabledViaApi: boolean = false

	static getInstance(): ManagedIndexer {
		if (!ManagedIndexer.prevInstance) {
			// NOTE: (brianc) - This _should_ never happen. The ManagedIndexer is instantiated on extension startup
			// and a reference stays around forever, however, we've seen weird hard to reproduce issue where on occassion
			// it IS null here. To mitigate that, we'll just create a new instance if needed. This dummy instance will
			// be disabled and not respond as 'start' will never be called on it, but it wont blow up the extension.
			console.warn("[ManagedIndexer] Warning: Previous ManagedIndexer instance was null, creating new instance")
			let proxy = null
			try {
				proxy = ContextProxy.instance
				TelemetryService.instance.captureEvent(TelemetryEventName.MISSING_MANAGED_INDEXER, {
					contextProxyMissing: "false",
				})
			} catch {
				TelemetryService.instance.captureEvent(TelemetryEventName.MISSING_MANAGED_INDEXER, {
					contextProxyMissing: "true",
				})
			}
			ManagedIndexer.prevInstance = new ManagedIndexer(proxy)
		}

		return ManagedIndexer.prevInstance
	}

	// Handle changes to vscode workspace folder changes
	workspaceFoldersListener: vscode.Disposable | null = null
	// kilocode_change: Listen to configuration changes from ContextProxy
	configChangeListener: vscode.Disposable | undefined | null = null
	config: ManagedIndexerConfig | null = null
	organization: KiloOrganization | null = null
	isActive = false

	/**
	 * Tracks state that depends on workspace folders
	 */
	workspaceFolderState: ManagedIndexerWorkspaceFolderState[] = []

	constructor(public contextProxy?: ContextProxy | null) {
		ManagedIndexer.prevInstance = this
	}

	private async onConfigurationChange(config: ManagedIndexerConfig): Promise<void> {
		console.info("[ManagedIndexer] Configuration changed, restarting...", {
			hasToken: !!config.kilocodeToken,
			hasOrgId: !!config.kilocodeOrganizationId,
			testerWarningsDisabled: config.kilocodeTesterWarningsDisabledUntil,
		})
		this.config = config
		this.dispose()
		await this.start()
		// Send updated state after restart
		this.sendStateToWebview()
	}

	// TODO: The fetchConfig, fetchOrganization, and isEnabled functions are sort of spaghetti
	// code right now. We need to clean this up to be more stateless or better rely
	// on proper memoization/invalidation techniques

	fetchConfig(): ManagedIndexerConfig {
		// kilocode_change: Read directly from ContextProxy instead of ClineProvider
		const kilocodeToken = this.contextProxy?.getSecret("kilocodeToken")
		const kilocodeOrganizationId = this.contextProxy?.getValue("kilocodeOrganizationId")
		const kilocodeTesterWarningsDisabledUntil = this.contextProxy?.getValue("kilocodeTesterWarningsDisabledUntil")

		this.config = {
			kilocodeToken: kilocodeToken ?? null,
			kilocodeOrganizationId: kilocodeOrganizationId ?? null,
			kilocodeTesterWarningsDisabledUntil: kilocodeTesterWarningsDisabledUntil ?? null,
		}

		return this.config
	}

	isEnabled(): boolean {
		if (this.disabledViaConfig) {
			return false
		}

		if (this.enabledViaApi) {
			return true
		}

		return false
	}

	/**
	 * Send the complete managed indexer state to the webview
	 */
	sendStateToWebview(stateOverride?: ManagedIndexerWorkspaceFolderState, fileCount?: number) {
		const state = {
			isEnabled: this.isEnabled(),
			isActive: this.isActive,
			workspaceFolders: this.workspaceFolderState.map(serializeWorkspaceFolderState),
		}
		if (stateOverride && fileCount) {
			const index = this.workspaceFolderState.indexOf(stateOverride)
			if (index > -1) {
				const folderState = state.workspaceFolders[index]
				if (folderState) {
					folderState.manifestFileCount = fileCount
				}
			}
		}
		const provider = ClineProvider.getVisibleInstance()
		if (provider) {
			provider.postMessageToWebview({
				type: "managedIndexerState",
				managedIndexerEnabled: state.isEnabled,
				managedIndexerState: state.workspaceFolders,
			})
		}
	}

	async start() {
		console.log("[ManagedIndexer] Starting ManagedIndexer")

		this.fetchConfig()
		const { kilocodeOrganizationId, kilocodeToken } = this.config ?? {}

		if (!kilocodeToken) {
			console.log("[ManagedIndexer] No Kilocode token found, skipping managed indexing")
			return
		}

		// do not use managed indexing if local codebase indexing is already enabled
		const localIndexingConfig = this.contextProxy?.getGlobalState("codebaseIndexConfig")
		if (localIndexingConfig?.codebaseIndexEnabled) {
			console.log("[ManagedIndexer] Local codebase indexing is enabled, skipping managed indexing")
			return
		}

		this.configChangeListener = this.contextProxy?.onManagedIndexerConfigChange(
			this.onConfigurationChange.bind(this),
		)

		vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders.bind(this))

		const workspaceFolderCount = vscode.workspace.workspaceFolders?.length ?? 0

		if (!workspaceFolderCount) {
			return
		}

		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const config = await getKilocodeConfig(folder.uri.fsPath)
			if (config?.project?.managedIndexingEnabled === false) {
				this.disabledViaConfig = true
			}
		}

		this.enabledViaApi = await isEnabled(kilocodeToken, kilocodeOrganizationId ?? null)
		console.debug(
			`[ManagedIndexer] Starting indexer. config disabled: ${this.disabledViaConfig}, API: ${this.enabledViaApi}`,
		)

		this.sendStateToWebview()

		if (!this.isEnabled()) {
			return
		}

		this.isActive = true

		if (!vscode.workspace.workspaceFolders) {
			return
		}

		// Build workspaceFolderState for each workspace folder
		const states = await Promise.all(
			vscode.workspace.workspaceFolders.map(async (workspaceFolder) => {
				const cwd = workspaceFolder.uri.fsPath

				// Initialize state with workspace folder
				const state: ManagedIndexerWorkspaceFolderState = {
					workspaceFolder,
					gitBranch: null,
					projectId: null,
					manifest: null,
					isIndexing: false,
					watcher: null,
					repositoryUrl: undefined,
					manifestFetchPromise: null,
					ignoreController: null,
				}

				// Check if it's a git repository
				if (!(await isGitRepository(cwd))) {
					return null
				}

				// Step 1: Get git information
				try {
					const [{ repositoryUrl }, gitBranch] = await Promise.all([
						getGitRepositoryInfo(cwd),
						getCurrentBranch(cwd),
					])
					state.gitBranch = gitBranch
					state.repositoryUrl = repositoryUrl

					// Step 2: Get project configuration
					const config = await getKilocodeConfig(cwd, repositoryUrl)
					const projectId = config?.project?.id

					// if managed indexing is specifically disabled in the config, skip this folder
					if (config?.project?.managedIndexingEnabled === false) {
						return null
					}

					if (!projectId) {
						console.log("[ManagedIndexer] No project ID found for workspace folder", cwd)
						return null
					}
					state.projectId = projectId

					// Step 3: Fetch server manifest
					try {
						state.manifest = await getServerManifest(
							kilocodeOrganizationId ?? null,
							projectId,
							gitBranch,
							kilocodeToken,
							state.currentAbortController?.signal,
						)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						console.error(`[ManagedIndexer] Failed to fetch manifest for ${cwd}: ${errorMessage}`)
						state.error = {
							type: "manifest",
							message: `Failed to fetch server manifest: ${errorMessage}`,
							timestamp: new Date().toISOString(),
							context: {
								operation: "fetch-manifest",
								branch: gitBranch,
							},
							details: error instanceof Error ? error.stack : undefined,
						}
						return state
					}

					// Step 4: Create git watcher
					try {
						const watcher = new GitWatcher({ cwd, defaultBranchOverride: config.project?.baseBranch })
						state.watcher = watcher
						const ignoreController = new RooIgnoreController(cwd)
						await ignoreController.initialize()
						state.ignoreController = ignoreController

						// Register event handler
						watcher.onEvent(this.onEvent.bind(this))
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						console.error(`[ManagedIndexer] Failed to start watcher for ${cwd}: ${errorMessage}`)
						state.error = {
							type: "scan",
							message: `Failed to start file watcher: ${errorMessage}`,
							timestamp: new Date().toISOString(),
							context: {
								operation: "start-watcher",
								branch: gitBranch,
							},
							details: error instanceof Error ? error.stack : undefined,
						}
						return state
					}

					return state
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					console.error(`[ManagedIndexer] Failed to get git info for ${cwd}: ${errorMessage}`)
					state.error = {
						type: "git",
						message: `Failed to get git information: ${errorMessage}`,
						timestamp: new Date().toISOString(),
						context: {
							operation: "get-git-info",
						},
						details: error instanceof Error ? error.stack : undefined,
					}
					return state
				}
			}),
		)

		this.workspaceFolderState = states.filter((s) => s !== null)

		// Start watchers
		await Promise.all(
			this.workspaceFolderState.map(async (state) => {
				await state.watcher?.start()
			}),
		)

		// Send initial state after setup
		this.sendStateToWebview()
	}

	dispose() {
		// kilocode_change: Dispose configuration change listener
		this.configChangeListener?.dispose()
		this.configChangeListener = null

		this.workspaceFoldersListener?.dispose()
		this.workspaceFoldersListener = null

		// Dispose all watchers from workspaceFolderState
		this.workspaceFolderState.forEach((state) => {
			state.watcher?.dispose()
			state.ignoreController?.dispose()
		})
		this.workspaceFolderState = []

		this.isActive = false
	}

	/**
	 * Get or fetch the manifest for a workspace state.
	 * If a fetch is already in progress, returns the same promise.
	 * This prevents duplicate fetches and ensures all callers wait for the same result.
	 */
	private async getManifest(
		state: ManagedIndexerWorkspaceFolderState,
		branch: string,
		force = false,
	): Promise<ServerManifest> {
		// If we're already fetching for this branch, return the existing promise
		if (state.manifestFetchPromise && state.gitBranch === branch && !force) {
			console.info(`[ManagedIndexer] Reusing in-flight manifest fetch for branch ${branch}`)
			return state.manifestFetchPromise
		}

		// Update branch BEFORE starting fetch so concurrent calls know we're fetching for this branch
		state.gitBranch = branch

		// Start a new fetch and cache the promise
		state.manifestFetchPromise = (async () => {
			try {
				// Recalculate projectId as it might have changed with the branch
				const config = await getKilocodeConfig(state.workspaceFolder.uri.fsPath, state.repositoryUrl)
				const projectId = config?.project?.id

				if (!projectId) {
					throw new Error(`No project ID found for workspace folder ${state.workspaceFolder.uri.fsPath}`)
				}
				state.projectId = projectId

				// Ensure we have the necessary configuration
				if (!this.config?.kilocodeToken) {
					throw new Error("Missing required configuration for manifest fetch")
				}

				const manifest = await getServerManifest(
					this.config.kilocodeOrganizationId,
					state.projectId,
					branch,
					this.config.kilocodeToken,
				)

				state.manifest = manifest
				console.info(
					`[ManagedIndexer] Successfully fetched manifest for branch ${branch} (${Object.keys(manifest.files).length} files)`,
				)

				// Clear any previous manifest errors
				if (state.error?.type === "manifest") {
					state.error = undefined
				}

				// Send state update after successful manifest fetch
				this.sendStateToWebview()

				return manifest
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				console.error(`[ManagedIndexer] Failed to fetch manifest for branch ${branch}: ${errorMessage}`)

				state.error = {
					type: "manifest",
					message: `Failed to fetch manifest: ${errorMessage}`,
					timestamp: new Date().toISOString(),
					context: {
						operation: "fetch-manifest",
						branch,
					},
					details: error instanceof Error ? error.stack : undefined,
				}

				// Send state update after error
				this.sendStateToWebview()

				throw error
			} finally {
				// Clear the promise cache after completion (success or failure)
				state.manifestFetchPromise = null
			}
		})()

		return state.manifestFetchPromise
	}

	async onEvent(event: GitWatcherEvent): Promise<void> {
		if (!this.isActive) {
			return
		}

		const state = this.workspaceFolderState.find((s) => s.watcher === event.watcher)

		if (!state || !state.watcher) {
			console.warn("[ManagedIndexer] Received event for unknown watcher")
			return
		}

		// Skip processing if state is not fully initialized
		if (!state.projectId || !state.gitBranch) {
			console.warn("[ManagedIndexer] Received event for incompletely initialized workspace folder")
			return
		}

		// Cancel any previous indexing operation
		if (state.currentAbortController) {
			console.info("[ManagedIndexer] Aborting previous indexing operation")
			state.currentAbortController.abort()
		}

		// Create new AbortController for this operation
		const controller = new AbortController()
		state.currentAbortController = controller

		logGitEvent(event)

		try {
			await this.processFiles(state, event, controller.signal)
		} catch (error) {
			// Check if this was an abort
			if (error instanceof Error && (error.name === "AbortError" || error.message === "AbortError")) {
				console.info("[ManagedIndexer] Indexing operation was aborted")
				return
			}
			// Re-throw other errors
			throw error
		}
	}

	/**
	 * Process files from an event's async iterable
	 */
	private async processFiles(
		state: ManagedIndexerWorkspaceFolderState,
		event: GitWatcherEvent,
		signal: AbortSignal,
	): Promise<void> {
		// Set indexing state
		state.isIndexing = true
		state.error = undefined
		this.sendStateToWebview()

		try {
			// Ensure we have the manifest (wait if it's being fetched)
			let manifest: ServerManifest
			try {
				manifest = await this.getManifest(state, event.branch)
			} catch (error) {
				console.warn(`[ManagedIndexer] Cannot process files without manifest, skipping`)
				state.isIndexing = false
				return
			}

			if (!this.config?.kilocodeToken || !state.projectId) {
				console.warn("[ManagedIndexer] Missing token, organization ID, or project ID, skipping file upsert")
				return
			}

			// Start with all files from manifest - we'll remove entries as we encounter them in git
			const manifestFilesToCheck = new Set<string>(Object.values(manifest.files))
			const filesToDelete: string[] = []
			let upsertCount = manifestFilesToCheck.size
			let errorCount = 0

			await pMap(
				event.files,
				async (file) => {
					// Check if operation was aborted
					if (signal.aborted) {
						throw new Error("AbortError")
					}

					if (this.isEnabled() === false) {
						throw new Error("ManagedIndexing is not enabled")
					}

					if (!this.isActive) {
						return
					}

					const { filePath } = file

					if (file.type === "file-deleted") {
						// Track deleted files for removal from backend
						filesToDelete.push(filePath)
						// Also remove from manifest check set if present
						manifestFilesToCheck.delete(filePath)
						return
					}

					const { fileHash } = file

					// Remove this file from the manifest check set since we encountered it in git
					manifestFilesToCheck.delete(filePath)

					// Check if file extension is supported
					const ext = path.extname(filePath).toLowerCase()
					if (!scannerExtensions.includes(ext)) {
						return
					}

					// Already indexed - check if fileHash exists in the map and matches the filePath
					if (manifest.files[fileHash] === filePath) {
						return
					}

					// Check if operation was aborted before processing
					if (signal.aborted) {
						throw new Error("AbortError")
					}

					try {
						// Ensure we have the necessary configuration
						// check again inside loop as this can change mid-flight
						if (!this.config?.kilocodeToken || !state.projectId) {
							return
						}
						const projectId = state.projectId

						const absoluteFilePath = path.isAbsolute(filePath)
							? filePath
							: path.join(event.watcher.config.cwd, filePath)

						// if file is larger than 1 megabyte, skip it
						const stats = await fs.stat(absoluteFilePath)
						if (stats.size > 1 * 1024 * 1024) {
							return
						}

						const fileBuffer = await fs.readFile(absoluteFilePath)
						const relativeFilePath = path.relative(event.watcher.config.cwd, absoluteFilePath)

						// Check RooIgnoreController
						const ignore = state.ignoreController
						if (ignore && !ignore.validateAccess(relativeFilePath)) {
							return
						}

						// Check hardcoded ignore list
						if (shouldIgnoreFile(relativeFilePath)) {
							return
						}

						// Call the upsertFile API with abort signal
						await upsertFile(
							{
								fileBuffer,
								fileHash,
								filePath: relativeFilePath,
								gitBranch: event.branch,
								isBaseBranch: event.isBaseBranch,
								organizationId: this.config.kilocodeOrganizationId,
								projectId,
								kilocodeToken: this.config.kilocodeToken,
							},
							signal,
						)

						upsertCount++
						this.sendStateToWebview(state, upsertCount)

						// Clear any previous file-upsert errors on success
						if (state.error?.type === "file-upsert") {
							state.error = undefined
							this.sendStateToWebview()
						}
					} catch (error) {
						// Don't log abort errors as failures
						if (error instanceof Error && error.message === "AbortError") {
							throw error
						}

						errorCount++
						// if we have 3 indexing errors, something is wrong....stop trying
						if (errorCount > 2) {
							this.dispose()
						}

						const errorMessage = error instanceof Error ? error.message : String(error)
						console.error(`[ManagedIndexer] Failed to upsert file ${filePath}: ${errorMessage}`)

						// Store the error in state
						state.error = {
							type: "file-upsert",
							message: `Failed to upsert file: ${errorMessage}`,
							timestamp: new Date().toISOString(),
							context: {
								filePath,
								branch: event.branch,
								operation: "file-upsert",
							},
							details: error instanceof Error ? error.stack : undefined,
						}
						this.sendStateToWebview()
					}
				},
				{ concurrency: 2 },
			)

			// Any files remaining in manifestFilesToCheck were not encountered in git
			// and should be deleted from the backend
			for (const manifestFile of manifestFilesToCheck) {
				filesToDelete.push(manifestFile)
			}

			// Delete files that are no longer in git or were explicitly deleted
			if (filesToDelete.length > 0) {
				console.info(`[ManagedIndexer] Deleting ${filesToDelete.length} files from manifest`)
				try {
					await deleteFiles(
						{
							organizationId: this.config.kilocodeOrganizationId,
							projectId: state.projectId,
							gitBranch: event.branch,
							filePaths: filesToDelete,
							kilocodeToken: this.config.kilocodeToken,
						},
						signal,
					)
					console.info(`[ManagedIndexer] Successfully deleted ${filesToDelete.length} files`)
				} catch (error) {
					// Don't log abort errors as failures
					if (error instanceof Error && error.message === "AbortError") {
						throw error
					}

					const errorMessage = error instanceof Error ? error.message : String(error)
					console.error(`[ManagedIndexer] Failed to delete files: ${errorMessage}`)

					// Store the error in state
					state.error = {
						type: "file-upsert",
						message: `Failed to delete files: ${errorMessage}`,
						timestamp: new Date().toISOString(),
						context: {
							branch: event.branch,
							operation: "file-delete",
						},
						details: error instanceof Error ? error.stack : undefined,
					}
					this.sendStateToWebview()
				}
			}

			// Force a re-fetch of the manifest
			await this.getManifest(state, event.branch, true)
		} finally {
			// Always clear indexing state when done
			state.isIndexing = false
			console.log("[ManagedIndexer] Indexing complete")
			this.sendStateToWebview()
		}
	}

	async onDidChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent) {
		// TODO we could more intelligently handle this instead of going scorched earth
		this.dispose()
		await this.start()
		this.sendStateToWebview()
	}

	public async search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
		const { kilocodeOrganizationId, kilocodeToken } = this.config ?? {}

		if (!kilocodeToken) {
			throw new Error("Kilocode token is required for managed index search")
		}

		const results = await Promise.all(
			this.workspaceFolderState.map(async (state) => {
				if (!state.projectId || !state.gitBranch) {
					return []
				}

				return await searchCode(
					{
						query,
						organizationId: kilocodeOrganizationId ?? null,
						projectId: state.projectId,
						preferBranch: state.gitBranch,
						fallbackBranch: "main",
						// TODO: Exclude deleted files for the branch
						excludeFiles: [],
						path: directoryPrefix,
					},
					kilocodeToken,
				)
			}),
		)

		return results
			.flat()
			.map((result) => ({
				id: result.id,
				score: result.score,
				payload: {
					filePath: result.filePath,
					codeChunk: "", // Managed indexing doesn't return code chunks
					startLine: result.startLine,
					endLine: result.endLine,
				},
			}))
			.sort((a, b) => b.score - a.score)
	}
}

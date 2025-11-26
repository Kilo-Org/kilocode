// kilocode_change new file

import * as vscode from "vscode"
import * as path from "path"
import { promises as fs } from "fs"
import pMap from "p-map"
import pLimit from "p-limit"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { KiloOrganization } from "../../../shared/kilocode/organization"
import { OrganizationService } from "../../kilocode/OrganizationService"
import { GitWatcher, GitWatcherEvent } from "../../../shared/GitWatcher"
import { getCurrentBranch, isGitRepository, getCurrentCommitSha, getBaseBranch } from "./git-utils"
import { getKilocodeConfig } from "../../../utils/kilo-config-file"
import { getGitRepositoryInfo } from "../../../utils/git"
import { getServerManifest, searchCode, upsertFile } from "./api-client"
import { MANAGED_MAX_CONCURRENT_FILES } from "../constants"
import { ServerManifest } from "./types"
import { scannerExtensions } from "../shared/supported-extensions"
import { VectorStoreSearchResult } from "../interfaces/vector-store"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"

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

export class ManagedIndexer implements vscode.Disposable {
	static prevInstance: ManagedIndexer | null = null
	static getInstance(): ManagedIndexer {
		if (!ManagedIndexer.prevInstance) {
			throw new Error("[ManagedIndexer.getInstance()] no available instance")
		}

		return ManagedIndexer.prevInstance
	}

	// Handle changes to vscode workspace folder changes
	workspaceFoldersListener: vscode.Disposable | null = null
	// kilocode_change: Listen to configuration changes from ContextProxy
	configChangeListener: vscode.Disposable | null = null
	config: ManagedIndexerConfig | null = null
	organization: KiloOrganization | null = null
	isActive = false

	/**
	 * Tracks state that depends on workspace folders
	 */
	workspaceFolderState: ManagedIndexerWorkspaceFolderState[] = []

	// Concurrency limiter for file upserts
	private readonly fileUpsertLimit = pLimit(MANAGED_MAX_CONCURRENT_FILES)

	constructor(public contextProxy: ContextProxy) {
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
	}

	// TODO: The fetchConfig, fetchOrganization, and isEnabled functions are sort of spaghetti
	// code right now. We need to clean this up to be more stateless or better rely
	// on proper memoization/invalidation techniques

	async fetchConfig(): Promise<ManagedIndexerConfig> {
		// kilocode_change: Read directly from ContextProxy instead of ClineProvider
		const kilocodeToken = this.contextProxy.getSecret("kilocodeToken")
		const kilocodeOrganizationId = this.contextProxy.getValue("kilocodeOrganizationId")
		const kilocodeTesterWarningsDisabledUntil = this.contextProxy.getValue("kilocodeTesterWarningsDisabledUntil")

		this.config = {
			kilocodeToken: kilocodeToken ?? null,
			kilocodeOrganizationId: kilocodeOrganizationId ?? null,
			kilocodeTesterWarningsDisabledUntil: kilocodeTesterWarningsDisabledUntil ?? null,
		}

		return this.config
	}

	async fetchOrganization(): Promise<KiloOrganization | null> {
		const config = await this.fetchConfig()

		if (config.kilocodeToken && config.kilocodeOrganizationId) {
			this.organization = await OrganizationService.fetchOrganization(
				config.kilocodeToken,
				config.kilocodeOrganizationId,
				config.kilocodeTesterWarningsDisabledUntil ?? undefined,
			)

			return this.organization
		}

		this.organization = null

		return this.organization
	}

	isEnabled(): boolean {
		const organization = this.organization

		if (!organization) {
			return false
		}

		const isEnabled = OrganizationService.isCodeIndexingEnabled(organization)

		if (!isEnabled) {
			return false
		}

		return true
	}

	sendEnabledStateToWebview() {
		const isEnabled = this.isEnabled()
		ClineProvider.getInstance().then((provider) => {
			if (provider) {
				provider.postMessageToWebview({
					type: "managedIndexerEnabled",
					managedIndexerEnabled: isEnabled,
				})
			}
		})
	}

	async start() {
		console.log("[ManagedIndexer] Starting ManagedIndexer")

		this.configChangeListener = this.contextProxy.onManagedIndexerConfigChange(
			this.onConfigurationChange.bind(this),
		)

		vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders.bind(this))

		const workspaceFolderCount = vscode.workspace.workspaceFolders?.length ?? 0

		if (!workspaceFolderCount) {
			return
		}

		this.organization = await this.fetchOrganization()

		const isEnabled = this.isEnabled()
		this.sendEnabledStateToWebview()
		if (!isEnabled) {
			return
		}

		// TODO: Plumb kilocodeTesterWarningsDisabledUntil through
		const { kilocodeOrganizationId, kilocodeToken } = this.config ?? {}

		if (!kilocodeOrganizationId || !kilocodeToken) {
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

					if (!projectId) {
						console.log("[ManagedIndexer] No project ID found for workspace folder", cwd)
						return null
					}
					state.projectId = projectId

					// Step 3: Fetch server manifest
					try {
						state.manifest = await getServerManifest(
							kilocodeOrganizationId,
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
						const watcher = new GitWatcher({ cwd })
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
		this.organization = null
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

		// If manifest is already cached for this branch, return it
		if (state.manifest && state.gitBranch === branch && !force) {
			return state.manifest
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
				if (!this.config?.kilocodeToken || !this.config?.kilocodeOrganizationId) {
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

		try {
			// Handle different event types
			switch (event.type) {
				case "branch-changed": {
					console.info(`[ManagedIndexer] Branch changed from ${event.previousBranch} to ${event.newBranch}`)

					try {
						// Fetch manifest for the new branch (will reuse if already fetching)
						await this.getManifest(state, event.newBranch)
					} catch (error) {
						// Error already logged and stored in getManifest
						console.warn(`[ManagedIndexer] Continuing despite manifest fetch error`)
					}

					// Process files from the async iterable
					await this.processFiles(state, event, controller.signal)
					break
				}

				case "commit": {
					console.info(`[ManagedIndexer] Commit detected from ${event.previousCommit} to ${event.newCommit}`)

					// Process files from the async iterable
					await this.processFiles(state, event, controller.signal)
					break
				}

				case "start": {
					console.info(
						`[ManagedIndexer] Watcher started on branch ${event.branch} ${event.isBaseBranch ? `(base)` : `(feature)`} - doing initial indexing`,
					)

					// Process files from the async iterable
					await this.processFiles(state, event, controller.signal)
					break
				}
			}
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

			if (!this.config?.kilocodeToken || !this.config?.kilocodeOrganizationId || !state.projectId) {
				console.warn("[ManagedIndexer] Missing token, organization ID, or project ID, skipping file upsert")
				return
			}

			await pMap(
				event.files,
				async (file) => {
					// Check if operation was aborted
					if (signal.aborted) {
						throw new Error("AbortError")
					}

					if (file.type === "file-deleted") {
						// TODO: Implement file deletion handling if needed
						return
					}

					const { filePath, fileHash } = file

					// Check if file extension is supported
					const ext = path.extname(filePath).toLowerCase()
					if (!scannerExtensions.includes(ext)) {
						return
					}

					// Already indexed - check if fileHash exists in the map and matches the filePath
					if (manifest.files[fileHash] === filePath) {
						return
					}

					{
						// Check if operation was aborted before processing
						if (signal.aborted) {
							throw new Error("AbortError")
						}

						try {
							// Ensure we have the necessary configuration
							// check again inside loop as this can change mid-flight
							if (
								!this.config?.kilocodeToken ||
								!this.config?.kilocodeOrganizationId ||
								!state.projectId
							) {
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

							const ignore = state.ignoreController
							if (ignore && !ignore.validateAccess(relativeFilePath)) {
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

							// Clear any previous file-upsert errors on success
							if (state.error?.type === "file-upsert") {
								state.error = undefined
							}
						} catch (error) {
							// Don't log abort errors as failures
							if (error instanceof Error && error.message === "AbortError") {
								throw error
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
						}
					}
				},
				{ concurrency: 20 },
			)

			// Force a re-fetch of the manifest
			await this.getManifest(state, event.branch, true)
		} finally {
			// Always clear indexing state when done
			state.isIndexing = false
			console.log("[ManagedIndexer] Indexing complete")
		}
	}

	async onDidChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent) {
		// TODO we could more intelligently handle this instead of going scorched earth
		this.dispose()
		await this.start()
	}

	/**
	 * Get a serializable representation of the current workspace folder state
	 * for debugging and introspection purposes
	 */
	getWorkspaceFolderStateSnapshot() {
		return this.workspaceFolderState.map((state) => ({
			workspaceFolderPath: state.workspaceFolder.uri.fsPath,
			workspaceFolderName: state.workspaceFolder.name,
			gitBranch: state.gitBranch,
			projectId: state.projectId,
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
		}))
	}

	public async search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
		const { kilocodeOrganizationId, kilocodeToken } = this.config ?? {}

		if (!kilocodeOrganizationId || !kilocodeToken) {
			throw new Error("Kilocode organization ID and token are required for managed index search")
		}

		const results = await Promise.all(
			this.workspaceFolderState.map(async (state) => {
				if (!state.projectId || !state.gitBranch) {
					return []
				}

				return await searchCode(
					{
						query,
						organizationId: kilocodeOrganizationId,
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

	/**
	 * Manually trigger a scan for a specific workspace folder
	 * This is useful for forcing a rescan from the UI
	 *
	 * @param workspaceFolderPath The path of the workspace folder to scan
	 * @throws Error if the workspace folder is not found or not properly initialized
	 */
	async startScanForWorkspaceFolder(workspaceFolderPath: string): Promise<void> {
		console.log("[ManagedIndexer] Manual scan requested for workspace folder", { workspaceFolderPath })

		if (!this.isActive) {
			throw new Error("ManagedIndexer is not active")
		}

		// Find the workspace folder state
		const state = this.workspaceFolderState.find((s) => s.workspaceFolder.uri.fsPath === workspaceFolderPath)

		if (!state) {
			throw new Error(`Workspace folder not found: ${workspaceFolderPath}`)
		}

		if (!state.watcher) {
			throw new Error(`Watcher not initialized for workspace folder: ${workspaceFolderPath}`)
		}

		if (!state.projectId || !state.gitBranch) {
			throw new Error(`Workspace folder not fully initialized: ${workspaceFolderPath}`)
		}

		// Cancel any previous indexing operation
		if (state.currentAbortController) {
			console.info("[ManagedIndexer] Aborting previous indexing operation for manual scan")
			state.currentAbortController.abort()
		}

		// Create new AbortController for this operation
		const controller = new AbortController()
		state.currentAbortController = controller

		try {
			console.info(
				`[ManagedIndexer] Starting manual scan for ${workspaceFolderPath} on branch ${state.gitBranch}`,
			)

			// Determine if this is the base branch
			const defaultBranch = await getBaseBranch(state.workspaceFolder.uri.fsPath)
			const isBaseBranch = state.gitBranch.toLowerCase() === defaultBranch.toLowerCase()

			// Create a synthetic event to trigger file processing using GitWatcher's getFiles method
			const syntheticEvent: GitWatcherEvent = {
				type: "commit",
				previousCommit: "",
				newCommit: await getCurrentCommitSha(state.workspaceFolder.uri.fsPath),
				branch: state.gitBranch,
				isBaseBranch,
				watcher: state.watcher,
				files: state.watcher.getFiles(state.gitBranch, isBaseBranch),
			}

			// Refresh the manifest before scanning
			try {
				await this.getManifest(state, state.gitBranch)
			} catch (error) {
				console.warn(`[ManagedIndexer] Failed to refresh manifest, continuing with cached version`)
			}

			// Process files using the existing logic
			await this.processFiles(state, syntheticEvent, controller.signal)

			console.info(`[ManagedIndexer] Manual scan completed for ${workspaceFolderPath}`)
		} catch (error) {
			// Check if this was an abort
			if (error instanceof Error && (error.name === "AbortError" || error.message === "AbortError")) {
				console.info("[ManagedIndexer] Manual scan was aborted")
				return
			}

			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error(`[ManagedIndexer] Manual scan failed for ${workspaceFolderPath}: ${errorMessage}`)

			state.error = {
				type: "scan",
				message: `Manual scan failed: ${errorMessage}`,
				timestamp: new Date().toISOString(),
				context: {
					operation: "manual-scan",
					branch: state.gitBranch,
				},
				details: error instanceof Error ? error.stack : undefined,
			}

			throw error
		}
	}
}

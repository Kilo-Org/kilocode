
import * as vscode from "vscode"
import * as path from "path"
import { promises as fs } from "fs"
import pMap from "p-map"
import { EventEmitter } from "events"
import { GitWatcher, GitWatcherEvent } from "../../../shared/GitWatcher"
import { getCurrentBranch, isGitRepository, getCurrentCommitSha, getBaseBranch } from "./git-utils"
import { normalizeProjectId } from "../../../utils/kilo-config-file"
import { getGitRepositoryInfo } from "../../../utils/git"
import { getServerManifest, searchCode, upsertChunks } from "./api-client"
import {
	MAX_FILE_SIZE_BYTES,
} from "../constants"
import { ServerManifest } from "./types"
import { scannerExtensions } from "../shared/supported-extensions"
import { VectorStoreSearchResult } from "../interfaces/vector-store"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { ICodeParser } from "../interfaces"
import { CodeParser } from "../processors"

interface ManagedIndexerConfig {
	gptChatByApiKey: string | null
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

export class ManagedGptByIndexer implements vscode.Disposable {
	static prevInstance: ManagedGptByIndexer | null = null
	static getInstance(): ManagedGptByIndexer {
		if (!ManagedGptByIndexer.prevInstance) {
			throw new Error("[ManagedGptByIndexer.getInstance()] no available instance")
		}

		return ManagedGptByIndexer.prevInstance
	}

	// Handle changes to vscode workspace folder changes
	workspaceFoldersListener: vscode.Disposable | null = null
	configChangeListener: vscode.Disposable | null = null
	config: ManagedIndexerConfig | null = null
	isActive = false

	/**
	 * Tracks state that depends on workspace folders
	 */
	workspaceFolderState: ManagedIndexerWorkspaceFolderState[] = []

	private readonly codeParser: ICodeParser
	private readonly configEmitter = new EventEmitter()

	constructor(public context: vscode.ExtensionContext) {
		this.codeParser = new CodeParser()
		ManagedGptByIndexer.prevInstance = this
	}

	private async onConfigurationChange(config: ManagedIndexerConfig): Promise<void> {
		console.info("[ManagedGptByIndexer] Configuration changed, restarting...", {
			hasToken: !!config.gptChatByApiKey,
		})
		this.config = config
		this.dispose()
		await this.start()
	}

	async fetchConfig(): Promise<ManagedIndexerConfig> {
		const token = await this.context.secrets.get("gptChatByApiKey")
		this.config = {
			gptChatByApiKey: token ?? null,
		}

		return this.config
	}

	isEnabled(): boolean {
		return !!this.config?.gptChatByApiKey
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

	public onManagedIndexerConfigChange(listener: (config: ManagedIndexerConfig) => void): vscode.Disposable {
		this.configEmitter.on("managed-indexer-config-changed", listener)
		return {
			dispose: () => this.configEmitter.off("managed-indexer-config-changed", listener),
		}
	}

	async start() {
		console.log("[ManagedGptByIndexer] Starting ManagedIndexer")

		this.configChangeListener = this.onManagedIndexerConfigChange(this.onConfigurationChange.bind(this))

		vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders.bind(this))

		const workspaceFolderCount = vscode.workspace.workspaceFolders?.length ?? 0

		if (!workspaceFolderCount) {
			return
		}

		await this.fetchConfig()

		const isEnabled = this.isEnabled()
		this.sendEnabledStateToWebview()
		if (!isEnabled) {
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
					const projectId = normalizeProjectId(repositoryUrl)

					if (!projectId) {
						console.log("[ManagedGptByIndexer] No project ID found for workspace folder", cwd)
						return null
					}
					state.projectId = projectId

					// Step 3: Fetch server manifest
					try {
						state.manifest = await getServerManifest(
							projectId,
							gitBranch,
							this.config?.gptChatByApiKey || '',
							state.currentAbortController?.signal,
						)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						console.error(`[ManagedGptByIndexer] Failed to fetch manifest for ${cwd}: ${errorMessage}`)
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
						console.error(`[ManagedGptByIndexer] Failed to start watcher for ${cwd}: ${errorMessage}`)
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
					console.error(`[ManagedGptByIndexer] Failed to get git info for ${cwd}: ${errorMessage}`)
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

		// @ts-ignore
		this.workspaceFolderState = states.filter((s) => s !== null)

		// Start watchers
		await Promise.all(
			this.workspaceFolderState.map(async (state) => {
				await state.watcher?.start()
			}),
		)
	}

	dispose() {
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
			console.info(`[ManagedGptByIndexer] Reusing in-flight manifest fetch for branch ${branch}`)
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
				const projectId = normalizeProjectId(state.repositoryUrl)

				if (!projectId) {
					throw new Error(`No project ID found for workspace folder ${state.workspaceFolder.uri.fsPath}`)
				}
				state.projectId = projectId

				// Ensure we have the necessary configuration
				if (!this.config?.gptChatByApiKey) {
					throw new Error("Missing required configuration for manifest fetch")
				}

				const manifest = await getServerManifest(
					state.projectId,
					branch,
					this.config?.gptChatByApiKey || '',
				)

				state.manifest = manifest
				console.info(
					`[ManagedGptByIndexer] Successfully fetched manifest for branch ${branch} (${Object.keys(manifest.files).length} files)`,
				)

				// Clear any previous manifest errors
				if (state.error?.type === "manifest") {
					state.error = undefined
				}

				return manifest
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				console.error(`[ManagedGptByIndexer] Failed to fetch manifest for branch ${branch}: ${errorMessage}`)

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
			console.warn("[ManagedGptByIndexer] Received event for unknown watcher")
			return
		}

		// Skip processing if state is not fully initialized
		if (!state.projectId || !state.gitBranch) {
			console.warn("[ManagedGptByIndexer] Received event for incompletely initialized workspace folder")
			return
		}

		// Cancel any previous indexing operation
		if (state.currentAbortController) {
			console.info("[ManagedGptByIndexer] Aborting previous indexing operation")
			state.currentAbortController.abort()
		}

		// Create new AbortController for this operation
		const controller = new AbortController()
		state.currentAbortController = controller

		try {
			// Handle different event types
			switch (event.type) {
				case "branch-changed": {
					console.info(`[ManagedGptByIndexer] Branch changed from ${event.previousBranch} to ${event.newBranch}`)

					try {
						// Fetch manifest for the new branch (will reuse if already fetching)
						await this.getManifest(state, event.newBranch)
					} catch (error) {
						// Error already logged and stored in getManifest
						console.warn(`[ManagedGptByIndexer] Continuing despite manifest fetch error`)
					}

					// Process files from the async iterable
					await this.processFiles(state, event, controller.signal)
					break
				}

				case "commit": {
					console.info(`[ManagedGptByIndexer] Commit detected from ${event.previousCommit} to ${event.newCommit}`)

					// Process files from the async iterable
					await this.processFiles(state, event, controller.signal)
					break
				}

				case "start": {
					console.info(
						`[ManagedGptByIndexer] Watcher started on branch ${event.branch} ${event.isBaseBranch ? `(base)` : `(feature)`} - doing initial indexing`,
					)

					// Process files from the async iterable
					await this.processFiles(state, event, controller.signal)
					break
				}
			}
		} catch (error) {
			// Check if this was an abort
			if (error instanceof Error && (error.name === "AbortError" || error.message === "AbortError")) {
				console.info("[ManagedGptByIndexer] Indexing operation was aborted")
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
				console.warn(`[ManagedGptByIndexer] Cannot process files without manifest, skipping`)
				state.isIndexing = false
				return
			}

			if (!this.config?.gptChatByApiKey || !state.projectId) {
				console.warn("[ManagedGptByIndexer] Missing token, project ID, skipping file upsert")
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
								!this.config?.gptChatByApiKey ||
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
							if (stats.size > MAX_FILE_SIZE_BYTES) {
								return
							}

							const content = await fs.readFile(absoluteFilePath)
								.then((buffer) => Buffer.from(buffer).toString("utf-8"))
							const relativeFilePath = path.relative(event.watcher.config.cwd, absoluteFilePath)

							const ignore = state.ignoreController
							if (ignore && !ignore.validateAccess(relativeFilePath)) {
								return
							}
							const blocks = await this.codeParser.parseFile(filePath, { content, fileHash: fileHash })

							upsertChunks(
								projectId,
								event.branch,
								event.isBaseBranch,
								blocks,
								this.config?.gptChatByApiKey || '',
								signal
							)

						} catch (error) {
							// Don't log abort errors as failures
							if (error instanceof Error && error.message === "AbortError") {
								throw error
							}

							const errorMessage = error instanceof Error ? error.message : String(error)
							console.error(`[ManagedGptByIndexer] Failed to upsert file ${filePath}: ${errorMessage}`)
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
			console.log("[ManagedGptByIndexer] Indexing complete")
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
		const { gptChatByApiKey } = this.config ?? {}

		if (!gptChatByApiKey) {
			throw new Error("Kilocode token are required for managed index search")
		}

		const results = await Promise.all(
			this.workspaceFolderState.map(async (state) => {
				if (!state.projectId || !state.gitBranch) {
					return []
				}

				return await searchCode(
					{
						query,
						projectId: state.projectId,
						preferBranch: state.gitBranch,
						fallbackBranch: "main",
						// TODO: Exclude deleted files for the branch
						excludeFiles: [],
						path: directoryPrefix,
					},
					gptChatByApiKey,
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
	async startScanForWorkspaceFolder(workspaceFolderPath?: string): Promise<void> {
		console.log("[ManagedGptByIndexer] Manual scan requested for workspace folder", { workspaceFolderPath })

		if (!workspaceFolderPath) {
			const activeEditor = vscode.window.activeTextEditor
			if (activeEditor) {
				const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
				workspaceFolderPath = workspaceFolder?.uri.fsPath
			}

			if (!workspaceFolderPath) {
				const workspaceFolders = vscode.workspace.workspaceFolders
				if (!workspaceFolders || workspaceFolders.length === 0) {
					return undefined
				}
				// Use the first workspace folder as fallback
				workspaceFolderPath = workspaceFolders[0].uri.fsPath
			}
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
			console.info("[ManagedGptByIndexer] Aborting previous indexing operation for manual scan")
			state.currentAbortController.abort()
		}

		// Create new AbortController for this operation
		const controller = new AbortController()
		state.currentAbortController = controller

		try {
			console.info(
				`[ManagedGptByIndexer] Starting manual scan for ${workspaceFolderPath} on branch ${state.gitBranch}`,
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
				console.warn(`[ManagedGptByIndexer] Failed to refresh manifest, continuing with cached version`)
			}

			// Process files using the existing logic
			await this.processFiles(state, syntheticEvent, controller.signal)

			console.info(`[ManagedGptByIndexer] Manual scan completed for ${workspaceFolderPath}`)
		} catch (error) {
			// Check if this was an abort
			if (error instanceof Error && (error.name === "AbortError" || error.message === "AbortError")) {
				console.info("[ManagedGptByIndexer] Manual scan was aborted")
				return
			}

			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error(`[ManagedGptByIndexer] Manual scan failed for ${workspaceFolderPath}: ${errorMessage}`)

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

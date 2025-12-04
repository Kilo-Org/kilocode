// kilocode_change - new file
/**
 * Main orchestration module for managed codebase indexing
 *
 * This module provides the high-level API for managed indexing operations:
 * - Starting/stopping indexing
 * - Searching the index
 * - Managing state
 */

import * as vscode from "vscode"
import { scanDirectory } from "./scanner"
import { createGitWatcher } from "./git-watcher"
import { searchCode as apiSearchCode, getServerManifest } from "./api-client"
import { getCurrentBranch, getGitDiff, isGitRepository, isDetachedHead } from "./git-utils"
import { ManagedIndexingConfig, IndexerState, SearchResult, ServerManifest } from "./types"
import { getDefaultChunkerConfig } from "./chunker"
import { logger } from "../../../utils/logging"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

/**
 * Starts the managed indexing process
 *
 * This function:
 * 1. Validates the workspace is a git repository
 * 2. Performs initial scan (full for main, delta for feature branches)
 * 3. Starts file watcher for incremental updates
 * 4. Reports progress via state callback
 *
 * @param config Managed indexing configuration
 * @param onStateChange State change callback
 * @returns Disposable that stops the indexer when disposed
 */
export async function startIndexing(
	config: ManagedIndexingConfig,
	onStateChange: (state: IndexerState) => void,
): Promise<vscode.Disposable> {
	try {
		// Validate git repository
		if (!(await isGitRepository(config.workspacePath))) {
			const error = new Error("Workspace is not a git repository")
			onStateChange({
				status: "error",
				message: "Not a git repository",
				error: error.message,
			})
			return vscode.Disposable.from({
				dispose: () => {
					logger.info("[Managed Indexing] Disposable called (not a git repository)")
				},
			})
		}

		// Check for detached HEAD state
		if (await isDetachedHead(config.workspacePath)) {
			const error = new Error("Repository is in detached HEAD state")
			onStateChange({
				status: "idle",
				message: "Detached HEAD state - indexing disabled",
			})
			logger.warn("[Managed Indexing] Detached HEAD state detected - indexing disabled")
			// Return a no-op disposable
			return vscode.Disposable.from({
				dispose: () => {
					logger.info("[Managed Indexing] Disposable called (detached HEAD)")
				},
			})
		}

		// Get current branch
		const gitBranch = await getCurrentBranch(config.workspacePath)

		// Fetch server manifest to determine what's already indexed
		let manifest: ServerManifest | undefined
		let serverHasNoData = false
		try {
			manifest = await getServerManifest(config.organizationId, config.projectId, gitBranch, config.kilocodeToken)
			logger.info(
				`[Managed Indexing] Server manifest: ${manifest.totalFiles} files, ${manifest.totalChunks} chunks`,
			)
		} catch (error) {
			// Check if this is a 404 (no data on server)
			const is404 =
				error && typeof error === "object" && "response" in error && (error as any).response?.status === 404

			if (is404) {
				logger.info("[Managed Indexing] No data on server (404), will perform full scan")
				serverHasNoData = true
			} else {
				// Safely extract error message to avoid circular reference issues
				const errorMsg = error instanceof Error ? error.message : String(error)
				logger.warn(`[Managed Indexing] Failed to fetch manifest, will perform full scan: ${errorMsg}`)
			}
			// Continue without manifest - scanner will index everything
		}

		// Update state: scanning
		onStateChange({
			status: "scanning",
			message: `Starting scan on branch ${gitBranch}...`,
			gitBranch,
		})

		// Perform initial scan with manifest for intelligent delta indexing
		const result = await scanDirectory(config, manifest, (progress) => {
			onStateChange({
				status: "scanning",
				message: `Scanning: ${progress.filesProcessed}/${progress.filesTotal} files (${progress.chunksIndexed} chunks)`,
				gitBranch,
			})
		})

		if (!result.success) {
			// Log all errors for debugging - safely extract error messages
			logger.error(`Scan failed with ${result.errors.length} errors:`)
			result.errors.forEach((err, index) => {
				// Safely extract error message and stack to avoid circular reference issues
				try {
					const message = err.message || String(err)
					logger.error(`  Error ${index + 1}: ${message}`)
					if (err.stack) {
						logger.error(`    Stack: ${err.stack}`)
					}
				} catch (e) {
					logger.error(`  Error ${index + 1}: [Unable to extract error message]`)
				}
			})

			// Create a detailed error message - safely extract error messages
			const errorMessages = result.errors.slice(0, 5).map((e) => {
				// Safely extract message, handling potential circular references
				try {
					return e.message || String(e)
				} catch {
					return "Unknown error"
				}
			})
			const errorSummary = errorMessages.join("; ")
			const remainingCount = result.errors.length > 5 ? ` and ${result.errors.length - 5} more` : ""
			throw new Error(`Scan failed with ${result.errors.length} errors: ${errorSummary}${remainingCount}`)
		}

		console.log(
			`[Managed Indexing] Initial scan complete: ${result.filesProcessed} files processed, ${result.filesSkipped} skipped, ${result.chunksIndexed} chunks indexed`,
		)
		logger.info(
			`Initial scan complete: ${result.filesProcessed} files processed, ${result.chunksIndexed} chunks indexed`,
		)

		// Fetch updated manifest after indexing to get accurate server state
		// This is important for feature branches where we might have skipped all files
		// but there's still data on the server from the base branch
		let updatedManifest: ServerManifest | undefined
		try {
			updatedManifest = await getServerManifest(
				config.organizationId,
				config.projectId,
				gitBranch,
				config.kilocodeToken,
			)
			console.log(
				`[Managed Indexing] Server manifest: ${updatedManifest.totalFiles} files, ${updatedManifest.totalChunks} chunks`,
			)
		} catch (error) {
			console.log("[Managed Indexing] No manifest found on server (404 or error)")
			// Safely extract error message to avoid circular reference issues
			const errorMsg = error instanceof Error ? error.message : String(error)
			logger.warn(`[Managed Indexing] Failed to fetch updated manifest after indexing: ${errorMsg}`)
		}

		// Check if we have indexed data - either from this scan OR from the server
		// For feature branches, we might skip all files but still have data from base branch
		const hasIndexedData =
			result.chunksIndexed > 0 ||
			result.filesProcessed > 0 ||
			(updatedManifest && updatedManifest.totalChunks > 0)

		console.log(`[Managed Indexing] Has indexed data: ${hasIndexedData}`)
		console.log(`  - Chunks indexed this scan: ${result.chunksIndexed}`)
		console.log(`  - Files processed this scan: ${result.filesProcessed}`)
		console.log(`  - Server manifest chunks: ${updatedManifest?.totalChunks ?? 0}`)

		// Start git-based watcher to monitor commits and branch changes
		console.log("[Managed Indexing] ========== STARTING GIT WATCHER ==========")
		let gitWatcher: vscode.Disposable | undefined
		try {
			console.log("[Managed Indexing] Calling createGitWatcher...")
			gitWatcher = await createGitWatcher(config, onStateChange)
			console.log("[Managed Indexing] ✓ Git watcher created successfully")
			logger.info("[Managed Indexing] Git watcher started successfully")
		} catch (error) {
			// Safely extract error message to avoid circular reference issues
			const errorMsg = error instanceof Error ? error.message : String(error)
			console.error(`[Managed Indexing] ✗ Failed to start git watcher: ${errorMsg}`)
			logger.error(`[Managed Indexing] Failed to start git watcher: ${errorMsg}`)
			// Continue without watcher - manual refresh will still work
		}

		// Update state based on whether we have data
		if (hasIndexedData) {
			onStateChange({
				status: "watching",
				message: "Index up-to-date. Watching for git commits and branch changes.",
				gitBranch,
				lastSyncTime: Date.now(),
				totalFiles: result.filesProcessed,
				totalChunks: result.chunksIndexed,
				manifest: updatedManifest
					? {
							totalFiles: updatedManifest.totalFiles,
							totalChunks: updatedManifest.totalChunks,
							lastUpdated: updatedManifest.lastUpdated,
						}
					: undefined,
			})
		} else {
			// No data indexed - set to idle state to indicate re-scan is needed
			onStateChange({
				status: "idle",
				message: "No files indexed. Click 'Start Indexing' to begin.",
				gitBranch,
			})
		}

		// Return disposable that cleans up watcher and state
		return vscode.Disposable.from({
			dispose: () => {
				if (gitWatcher) {
					gitWatcher.dispose()
				}
				onStateChange({
					status: "idle",
					message: "Indexing stopped",
					gitBranch,
				})
			},
		})
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))

		onStateChange({
			status: "error",
			message: `Failed to start indexing: ${err.message}`,
			error: err.message,
		})

		throw err
	}
}

/**
 * Searches the managed index with branch-aware preferences
 *
 * This function:
 * 1. Gets deleted files from git diff (for feature branches)
 * 2. Sends search request with branch preferences
 * 3. Returns results with feature branch files preferred over main
 *
 * @param query Search query
 * @param config Managed indexing configuration
 * @param path Optional directory path filter
 * @returns Array of search results sorted by relevance
 */
export async function search(query: string, config: ManagedIndexingConfig, path?: string): Promise<SearchResult[]> {
	try {
		const gitBranch = await getCurrentBranch(config.workspacePath)

		// Get deleted files for feature branches
		let excludeFiles: string[] = []
		if (gitBranch !== "main" && gitBranch !== "master" && gitBranch !== "develop") {
			try {
				const diff = await getGitDiff(gitBranch, "main", config.workspacePath)
				excludeFiles = diff.deleted
			} catch (error) {
				// If git diff fails, continue without exclusions
				logger.warn(`Failed to get git diff for search: ${error}`)
			}
		}

		// Perform search
		const results = await apiSearchCode(
			{
				query,
				organizationId: config.organizationId,
				projectId: config.projectId,
				preferBranch: gitBranch,
				fallbackBranch: "main",
				excludeFiles,
				path,
			},
			config.kilocodeToken,
		)

		logger.info(`Search for "${query}" returned ${results.length} results`)

		return results
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		logger.error(`Search failed: ${err.message}`)

		TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
			error: err.message,
			stack: err.stack,
			location: "search",
			query,
		})

		throw err
	}
}

/**
 * Gets the current indexer state
 *
 * @param config Managed indexing configuration
 * @returns Current indexer state
 */
export async function getIndexerState(config: ManagedIndexingConfig): Promise<IndexerState> {
	try {
		if (!(await isGitRepository(config.workspacePath))) {
			return {
				status: "error",
				message: "Not a git repository",
				error: "Workspace is not a git repository",
			}
		}

		const gitBranch = await getCurrentBranch(config.workspacePath)

		return {
			status: "idle",
			message: "Ready",
			gitBranch,
		}
	} catch (error) {
		return {
			status: "error",
			message: "Failed to get state",
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Creates a managed indexing configuration from organization credentials
 *
 * @param organizationId Organization ID
 * @param projectId Project ID
 * @param kilocodeToken Authentication token
 * @param workspacePath Workspace root path
 * @returns Managed indexing configuration with defaults
 */
export function createManagedIndexingConfig(
	organizationId: string,
	projectId: string,
	kilocodeToken: string,
	workspacePath: string,
): ManagedIndexingConfig {
	return {
		organizationId,
		projectId,
		kilocodeToken,
		workspacePath,
		chunker: getDefaultChunkerConfig(),
		batchSize: 60,
		autoSync: true,
	}
}

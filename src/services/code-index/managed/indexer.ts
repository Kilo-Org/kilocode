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
import { createFileWatcher } from "./watcher"
import { searchCode as apiSearchCode, getServerManifest } from "./api-client"
import { getCurrentBranch, getGitDiff, isGitRepository } from "./git-utils"
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
 * @param context VSCode extension context
 * @param onStateChange Optional state change callback
 * @returns Disposable that stops the indexer when disposed
 */
export async function startIndexing(
	config: ManagedIndexingConfig,
	context: vscode.ExtensionContext,
	onStateChange?: (state: IndexerState) => void,
): Promise<vscode.Disposable> {
	try {
		// Validate git repository
		if (!isGitRepository(config.workspacePath)) {
			const error = new Error("Workspace is not a git repository")
			onStateChange?.({
				status: "error",
				message: "Not a git repository",
				error: error.message,
			})
			throw error
		}

		// Get current branch
		const gitBranch = getCurrentBranch(config.workspacePath)

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
				logger.warn("[Managed Indexing] Failed to fetch manifest, will perform full scan:", error)
			}
			// Continue without manifest - scanner will index everything
		}

		// Update state: scanning
		onStateChange?.({
			status: "scanning",
			message: `Starting scan on branch ${gitBranch}...`,
			gitBranch,
		})

		// Perform initial scan with manifest for intelligent delta indexing
		const result = await scanDirectory(config, context, manifest, (progress) => {
			onStateChange?.({
				status: "scanning",
				message: `Scanning: ${progress.filesProcessed}/${progress.filesTotal} files (${progress.chunksIndexed} chunks)`,
				gitBranch,
			})
		})

		if (!result.success) {
			// Log all errors for debugging
			logger.error(`Scan failed with ${result.errors.length} errors:`)
			result.errors.forEach((err, index) => {
				logger.error(`  Error ${index + 1}: ${err.message}`)
				if (err.stack) {
					logger.error(`    Stack: ${err.stack}`)
				}
			})

			// Create a detailed error message
			const errorSummary = result.errors
				.slice(0, 5)
				.map((e) => e.message)
				.join("; ")
			const remainingCount = result.errors.length > 5 ? ` (and ${result.errors.length - 5} more)` : ""
			throw new Error(`Scan failed with ${result.errors.length} errors: ${errorSummary}${remainingCount}`)
		}

		logger.info(
			`Initial scan complete: ${result.filesProcessed} files processed, ${result.chunksIndexed} chunks indexed`,
		)

		// TODO: Re-enable file watcher once git-tracking issues are resolved
		// File watcher is temporarily disabled to prevent endless loops with .gitignored files
		// const watcher = createFileWatcher(config, context, (events) => {
		// 	logger.info(`File watcher processed ${events.length} changes`)
		// })

		// Check if we actually have indexed data
		// If no chunks were indexed and no files were processed, the index is empty
		const hasIndexedData = result.chunksIndexed > 0 || result.filesProcessed > 0

		// Fetch updated manifest after indexing to get accurate server state
		let updatedManifest: ServerManifest | undefined
		if (hasIndexedData) {
			try {
				updatedManifest = await getServerManifest(
					config.organizationId,
					config.projectId,
					gitBranch,
					config.kilocodeToken,
				)
			} catch (error) {
				logger.warn("[Managed Indexing] Failed to fetch updated manifest after indexing:", error)
			}
		}

		// Update state based on whether we have data
		if (hasIndexedData) {
			onStateChange?.({
				status: "watching",
				message: "Index up-to-date. File watching temporarily disabled.",
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
			onStateChange?.({
				status: "idle",
				message: "No files indexed. Click 'Start Indexing' to begin.",
				gitBranch,
			})
		}

		// Return disposable that cleans up state
		return vscode.Disposable.from({
			dispose: () => {
				onStateChange?.({
					status: "idle",
					message: "Indexing stopped",
					gitBranch,
				})
			},
		})
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		logger.error(`Failed to start indexing: ${err.message}`)

		TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
			error: err.message,
			stack: err.stack,
			location: "startIndexing",
		})

		onStateChange?.({
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
		const gitBranch = getCurrentBranch(config.workspacePath)

		// Get deleted files for feature branches
		let excludeFiles: string[] = []
		if (gitBranch !== "main" && gitBranch !== "master" && gitBranch !== "develop") {
			try {
				const diff = getGitDiff(gitBranch, "main", config.workspacePath)
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
 * @param context VSCode extension context
 * @returns Current indexer state
 */
export async function getIndexerState(
	config: ManagedIndexingConfig,
	context: vscode.ExtensionContext,
): Promise<IndexerState> {
	try {
		if (!isGitRepository(config.workspacePath)) {
			return {
				status: "error",
				message: "Not a git repository",
				error: "Workspace is not a git repository",
			}
		}

		const gitBranch = getCurrentBranch(config.workspacePath)

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

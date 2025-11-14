// kilocode_change - new file
/**
 * Git-based watcher for managed codebase indexing
 *
 * This module provides a watcher that monitors git state changes (commits and branch switches)
 * instead of file system changes. This avoids infinite loops with .gitignored files and
 * ensures we only index committed changes.
 *
 * The watcher monitors:
 * - Git commits (by watching .git/HEAD and branch refs)
 * - Branch switches (by watching .git/HEAD)
 * - Detached HEAD state (disables indexing)
 */

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { scanDirectory } from "./scanner"
import { ManagedIndexingConfig, IndexerState } from "./types"
import { getGitHeadPath, getGitState, isDetachedHead, getCurrentBranch } from "./git-utils"
import { getServerManifest } from "./api-client"
import { logger } from "../../../utils/logging"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

/**
 * Git state snapshot for change detection
 */
interface GitStateSnapshot {
	branch: string
	commit: string
	isDetached: boolean
}

/**
 * Creates a git-based watcher that monitors git state changes
 *
 * The watcher:
 * - Monitors .git/HEAD for branch switches and commits
 * - Triggers re-indexing after commits (files are naturally committed)
 * - Triggers manifest refresh after branch switches
 * - Disables indexing in detached HEAD state
 *
 * @param config Managed indexing configuration
 * @param onStateChange Callback when git state changes
 * @returns Disposable watcher instance
 */
export async function createGitWatcher(
	config: ManagedIndexingConfig,
	onStateChange: (state: IndexerState) => void,
): Promise<vscode.Disposable> {
	const disposables: vscode.Disposable[] = []
	let currentState: GitStateSnapshot | null = null
	let isProcessing = false

	// Get initial git state - use async initialization
	const initPromise = (async () => {
		try {
			const gitState = await getGitState(config.workspacePath)
			console.log("[GitWatcher] Git state:", gitState)

			if (gitState) {
				currentState = gitState
			} else {
				onStateChange({
					status: "idle",
					message: "Detached HEAD state - indexing disabled",
					gitBranch: undefined,
				})
			}
		} catch (error) {
			logger.error(`[GitWatcher] Failed to get initial git state:`, error)
		}
	})()

	/**
	 * Handles git state changes
	 */
	const handleGitChange = async () => {
		if (isProcessing) {
			return
		}

		try {
			isProcessing = true

			// Check for detached HEAD
			if (await isDetachedHead(config.workspacePath)) {
				currentState = null
				onStateChange({
					status: "idle",
					message: "Detached HEAD state - indexing disabled",
					gitBranch: undefined,
				})
				return
			}

			// Get new git state
			const newState = await getGitState(config.workspacePath)
			if (!newState) {
				logger.warn("[GitWatcher] Could not determine git state")
				return
			}

			// Check if state actually changed
			if (currentState) {
				const branchChanged = currentState.branch !== newState.branch
				const commitChanged = currentState.commit !== newState.commit

				if (!branchChanged && !commitChanged) {
					return
				}

				if (branchChanged) {
					await handleBranchChange(newState.branch, config, onStateChange)
				} else if (commitChanged) {
					await handleCommit(newState.branch, config, onStateChange)
				}
			} else {
				// First time seeing a valid state (recovered from detached HEAD)
				await handleBranchChange(newState.branch, config, onStateChange)
			}

			currentState = newState
		} catch (error) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "handleGitChange",
			})
		} finally {
			isProcessing = false
		}
	}

	/**
	 * Handles branch changes - fetches new manifest and re-indexes
	 */
	const handleBranchChange = async (
		newBranch: string,
		config: ManagedIndexingConfig,
		onStateChange: (state: IndexerState) => void,
	) => {
		try {
			onStateChange({
				status: "scanning",
				message: `Branch changed to ${newBranch}, fetching manifest...`,
				gitBranch: newBranch,
			})

			// Fetch manifest for new branch
			let manifest
			try {
				manifest = await getServerManifest(
					config.organizationId,
					config.projectId,
					newBranch,
					config.kilocodeToken,
				)
			} catch (error) {
				logger.warn(`[GitWatcher] No manifest found for ${newBranch}, will perform full scan`)
			}

			// Trigger re-scan with manifest
			onStateChange({
				status: "scanning",
				message: `Scanning branch ${newBranch}...`,
				gitBranch: newBranch,
			})

			const result = await scanDirectory(config, manifest, (progress) => {
				onStateChange({
					status: "scanning",
					message: `Scanning: ${progress.filesProcessed}/${progress.filesTotal} files (${progress.chunksIndexed} chunks)`,
					gitBranch: newBranch,
				})
			})

			if (result.success) {
				// Fetch updated manifest
				let updatedManifest
				try {
					updatedManifest = await getServerManifest(
						config.organizationId,
						config.projectId,
						newBranch,
						config.kilocodeToken,
					)
				} catch (error) {
					logger.warn("[GitWatcher] Failed to fetch updated manifest after scan")
				}

				onStateChange({
					status: "watching",
					message: `Branch ${newBranch} indexed successfully`,
					gitBranch: newBranch,
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
				throw new Error(`Scan failed with ${result.errors.length} errors`)
			}
		} catch (error) {
			logger.error(`[GitWatcher] Failed to handle branch change:`, error)
			onStateChange({
				status: "error",
				message: `Failed to index branch ${newBranch}: ${error instanceof Error ? error.message : String(error)}`,
				error: error instanceof Error ? error.message : String(error),
				gitBranch: newBranch,
			})
		}
	}

	/**
	 * Handles commits - re-indexes changed files
	 */
	const handleCommit = async (
		branch: string,
		config: ManagedIndexingConfig,
		onStateChange: (state: IndexerState) => void,
	) => {
		try {
			onStateChange({
				status: "scanning",
				message: `New commit detected, updating index...`,
				gitBranch: branch,
			})

			// Fetch current manifest
			let manifest
			try {
				manifest = await getServerManifest(
					config.organizationId,
					config.projectId,
					branch,
					config.kilocodeToken,
				)
			} catch (error) {
				logger.warn(`[GitWatcher] No manifest found for ${branch}`)
			}

			// Re-scan to pick up committed changes
			const result = await scanDirectory(config, manifest, (progress) => {
				onStateChange({
					status: "scanning",
					message: `Updating: ${progress.filesProcessed}/${progress.filesTotal} files (${progress.chunksIndexed} chunks)`,
					gitBranch: branch,
				})
			})

			if (result.success) {
				// Fetch updated manifest
				let updatedManifest
				try {
					updatedManifest = await getServerManifest(
						config.organizationId,
						config.projectId,
						branch,
						config.kilocodeToken,
					)
				} catch (error) {
					logger.warn("[GitWatcher] Failed to fetch updated manifest after commit")
				}

				onStateChange({
					status: "watching",
					message: `Index updated after commit`,
					gitBranch: branch,
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
				throw new Error(`Scan failed with ${result.errors.length} errors`)
			}
		} catch (error) {
			logger.error(`[GitWatcher] Failed to handle commit:`, error)
			onStateChange({
				status: "error",
				message: `Failed to update index after commit: ${error instanceof Error ? error.message : String(error)}`,
				error: error instanceof Error ? error.message : String(error),
				gitBranch: branch,
			})
		}
	}

	// Watch .git/HEAD file for changes (branch switches and commits)
	;(async () => {
		try {
			const gitHeadPath = await getGitHeadPath(config.workspacePath)
			const absoluteGitHeadPath = path.isAbsolute(gitHeadPath)
				? gitHeadPath
				: path.join(config.workspacePath, gitHeadPath)

			// Use VSCode's file watcher for .git/HEAD
			const headWatcher = vscode.workspace.createFileSystemWatcher(absoluteGitHeadPath)

			disposables.push(
				headWatcher.onDidChange(() => {
					console.log("[GitWatcher] ✓✓✓ .git/HEAD CHANGED - branch switch or commit detected")
					logger.info("[GitWatcher] ✓ .git/HEAD changed - branch switch or commit detected")
					handleGitChange()
				}),
			)

			disposables.push(headWatcher)

			// Watch all branch refs for commits (more reliable than watching individual branch)
			try {
				const gitDir = path.dirname(absoluteGitHeadPath)
				const refsHeadsPattern = path.join(gitDir, "refs", "heads", "**")
				const refsWatcher = vscode.workspace.createFileSystemWatcher(refsHeadsPattern)

				disposables.push(
					refsWatcher.onDidChange((uri) => {
						console.log(`[GitWatcher] ✓✓✓ BRANCH REF CHANGED: ${uri.fsPath}`)
						logger.info(`[GitWatcher] ✓ Branch ref changed: ${uri.fsPath}`)
						handleGitChange()
					}),
				)

				disposables.push(refsWatcher)
			} catch (error) {
				logger.warn(`[GitWatcher] Could not watch branch refs:`, error)
			}

			// Also watch packed-refs for repositories that use packed refs
			try {
				const gitDir = path.dirname(absoluteGitHeadPath)
				const packedRefsPath = path.join(gitDir, "packed-refs")

				if (fs.existsSync(packedRefsPath)) {
					const packedRefsWatcher = vscode.workspace.createFileSystemWatcher(packedRefsPath)

					disposables.push(
						packedRefsWatcher.onDidChange(() => {
							logger.info("[GitWatcher] ✓ packed-refs changed")
							handleGitChange()
						}),
					)

					disposables.push(packedRefsWatcher)
				}
			} catch (error) {
				logger.warn(`[GitWatcher] Could not watch packed-refs:`, error)
			}
		} catch (error) {
			logger.error(`[GitWatcher] Failed to create git watcher:`, error)
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "createGitWatcher",
			})
		}
	})()

	// Add polling as a fallback (VSCode file watchers may not work reliably with .git files)
	const pollingInterval = setInterval(() => {
		handleGitChange()
	}, 3000) // Poll every 3 seconds

	disposables.push({
		dispose: () => {
			clearInterval(pollingInterval)
		},
	})

	await initPromise

	// Return composite disposable
	return vscode.Disposable.from(...disposables)
}

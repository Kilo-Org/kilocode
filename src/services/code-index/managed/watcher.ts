/**
 * File watcher for managed codebase indexing
 *
 * This module provides functions for watching file changes and incrementally
 * updating the index. Changes are debounced and batched for efficiency.
 */

import * as vscode from "vscode"
import * as path from "path"
import { execSync } from "child_process"
import { indexFile, handleFileDeleted } from "./scanner"
import { ManagedIndexingConfig, FileChangeEvent, ClientCache } from "./types"
import { loadClientCache, saveClientCache } from "./cache"
import { scannerExtensions } from "../shared/supported-extensions"
import { MANAGED_FILE_WATCH_DEBOUNCE_MS } from "../constants"
import { logger } from "../../../utils/logging"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

/**
 * Creates and initializes a file watcher for managed indexing
 *
 * The watcher:
 * - Monitors file create, change, and delete events
 * - Debounces rapid changes (500ms default)
 * - Filters by supported file extensions
 * - Updates the index incrementally
 *
 * @param config Managed indexing configuration
 * @param context VSCode extension context
 * @param onFilesChanged Optional callback when files are processed
 * @returns Disposable watcher instance
 */
export function createFileWatcher(
	config: ManagedIndexingConfig,
	context: vscode.ExtensionContext,
	onFilesChanged?: (events: FileChangeEvent[]) => void,
): vscode.Disposable {
	// Create file system watcher for all files
	const watcher = vscode.workspace.createFileSystemWatcher("**/*")

	// Change queue for debouncing
	const changeQueue: FileChangeEvent[] = []
	let debounceTimer: NodeJS.Timeout | null = null

	/**
	 * Handles a file change event
	 */
	const handleChange = (uri: vscode.Uri, type: FileChangeEvent["type"]) => {
		// Filter by supported extensions
		const ext = path.extname(uri.fsPath).toLowerCase()
		if (!scannerExtensions.includes(ext)) {
			return
		}

		// Add to queue
		changeQueue.push({
			type,
			filePath: uri.fsPath,
			timestamp: Date.now(),
		})

		// Debounce processing
		if (debounceTimer) {
			clearTimeout(debounceTimer)
		}

		debounceTimer = setTimeout(async () => {
			await processChangeQueue([...changeQueue], config, context, onFilesChanged)
			changeQueue.length = 0
		}, MANAGED_FILE_WATCH_DEBOUNCE_MS)
	}

	// Register event handlers
	const createDisposable = watcher.onDidCreate((uri) => handleChange(uri, "created"))
	const changeDisposable = watcher.onDidChange((uri) => handleChange(uri, "changed"))
	const deleteDisposable = watcher.onDidDelete((uri) => handleChange(uri, "deleted"))

	// Return composite disposable
	return vscode.Disposable.from(watcher, createDisposable, changeDisposable, deleteDisposable)
}

/**
 * Processes a queue of file changes
 *
 * @param events Array of file change events
 * @param config Indexing configuration
 * @param context VSCode extension context
 * @param onFilesChanged Optional callback
 */
async function processChangeQueue(
	events: FileChangeEvent[],
	config: ManagedIndexingConfig,
	context: vscode.ExtensionContext,
	onFilesChanged?: (events: FileChangeEvent[]) => void,
): Promise<void> {
	if (events.length === 0) {
		return
	}

	logger.info(`Processing ${events.length} file changes`)

	try {
		// Load current cache
		let cache = await loadClientCache(context, config.workspacePath)

		// Group events by type
		const created = events.filter((e) => e.type === "created")
		const changed = events.filter((e) => e.type === "changed")
		const deleted = events.filter((e) => e.type === "deleted")

		// Process deletions first
		for (const event of deleted) {
			try {
				cache = await handleFileDeleted(event.filePath, config, context, cache)
			} catch (error) {
				logger.error(`Failed to handle deletion of ${event.filePath}:`, error)
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					location: "processChangeQueue:delete",
					filePath: event.filePath,
				})
			}
		}

		// Process created and changed files
		const toIndex = [...created, ...changed]
		for (const event of toIndex) {
			try {
				cache = await indexFile(event.filePath, config, context, cache)
			} catch (error) {
				logger.error(`Failed to index ${event.filePath}:`, error)
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					location: "processChangeQueue:index",
					filePath: event.filePath,
				})
			}
		}

		// Notify callback
		onFilesChanged?.(events)

		logger.info(
			`Processed ${events.length} file changes: ${created.length} created, ${changed.length} changed, ${deleted.length} deleted`,
		)
	} catch (error) {
		logger.error("Failed to process change queue:", error)
		TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			location: "processChangeQueue",
		})
	}
}

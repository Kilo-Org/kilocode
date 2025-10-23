/**
 * File scanner for managed codebase indexing
 *
 * This module provides functions for scanning directories and indexing files.
 * It implements delta-based indexing where feature branches only index changed files.
 */

import * as vscode from "vscode"
import * as path from "path"
import { stat } from "fs/promises"
import pLimit from "p-limit"
import { listFiles } from "../../glob/list-files"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { isPathInIgnoredDirectory } from "../../glob/ignore-utils"
import { scannerExtensions } from "../shared/supported-extensions"
import { generateRelativeFilePath } from "../shared/get-relative-path"
import { chunkFile, calculateFileHash } from "./chunker"
import { upsertChunks, deleteFiles } from "./api-client"
import { getCurrentBranch, getGitDiff, isBaseBranch as checkIsBaseBranch, isGitRepository } from "./git-utils"
import {
	loadClientCache,
	saveClientCache,
	shouldIndexFile,
	updateCacheEntry,
	addDeletedFile,
	createEmptyCache,
} from "./cache"
import { ManagedIndexingConfig, ScanProgress, ScanResult, ClientCache } from "./types"
import {
	MAX_FILE_SIZE_BYTES,
	MAX_LIST_FILES_LIMIT_CODE_INDEX,
	MANAGED_MAX_CONCURRENT_FILES,
	MANAGED_BATCH_SIZE,
} from "../constants"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import { logger } from "../../../utils/logging"

/**
 * Scans a directory and indexes files based on branch strategy
 *
 * - Main branch: Scans all files
 * - Feature branch: Only scans files changed from main (delta)
 *
 * @param config Managed indexing configuration
 * @param context VSCode extension context
 * @param onProgress Optional progress callback
 * @returns Scan result with statistics
 */
export async function scanDirectory(
	config: ManagedIndexingConfig,
	context: vscode.ExtensionContext,
	onProgress?: (progress: ScanProgress) => void,
): Promise<ScanResult> {
	const errors: Error[] = []

	try {
		// Check if workspace is a git repository
		if (!isGitRepository(config.workspacePath)) {
			throw new Error("Workspace is not a git repository")
		}

		// Get current branch
		const currentBranch = getCurrentBranch(config.workspacePath)
		const isBase = checkIsBaseBranch(currentBranch)

		// Load client cache
		let cache = await loadClientCache(context, config.workspacePath)

		// If cache is for a different branch, create new cache
		if (cache.gitBranch !== currentBranch) {
			cache = createEmptyCache(currentBranch)
		}

		// Determine which files to scan
		const filesToScan = await getFilesToScan(config.workspacePath, currentBranch, isBase)

		logger.info(`Scanning ${filesToScan.length} files on branch ${currentBranch} (isBase: ${isBase})`)

		// Process files
		const result = await processFiles(filesToScan, config, context, cache, currentBranch, isBase, onProgress)

		// Save updated cache
		await saveClientCache(context, config.workspacePath, result.cache)

		return {
			success: result.errors.length === 0,
			filesProcessed: result.filesProcessed,
			filesSkipped: result.filesSkipped,
			chunksIndexed: result.chunksIndexed,
			errors: result.errors,
		}
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		errors.push(err)
		logger.error(`Scan directory failed: ${err.message}`)
		TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
			error: err.message,
			stack: err.stack,
			location: "scanDirectory",
		})

		return {
			success: false,
			filesProcessed: 0,
			filesSkipped: 0,
			chunksIndexed: 0,
			errors,
		}
	}
}

/**
 * Determines which files to scan based on branch strategy
 *
 * @param workspacePath Workspace root path
 * @param currentBranch Current git branch
 * @param isBase Whether current branch is a base branch
 * @returns Array of file paths to scan
 */
async function getFilesToScan(workspacePath: string, currentBranch: string, isBase: boolean): Promise<string[]> {
	if (isBase) {
		// Base branch: scan all files
		return await getAllSupportedFiles(workspacePath)
	} else {
		// Feature branch: only scan changed files
		const diff = getGitDiff(currentBranch, "main", workspacePath)
		const changedFiles = [...diff.added, ...diff.modified]

		// Filter to only supported files
		return changedFiles.filter((file) => {
			const ext = path.extname(file).toLowerCase()
			return scannerExtensions.includes(ext)
		})
	}
}

/**
 * Gets all supported files in the workspace
 *
 * @param workspacePath Workspace root path
 * @returns Array of supported file paths
 */
async function getAllSupportedFiles(workspacePath: string): Promise<string[]> {
	// Get all files recursively
	const [allPaths] = await listFiles(workspacePath, true, MAX_LIST_FILES_LIMIT_CODE_INDEX)

	// Filter out directories
	const filePaths = allPaths.filter((p) => !p.endsWith("/"))

	// Initialize ignore controller
	const ignoreController = new RooIgnoreController(workspacePath)
	await ignoreController.initialize()

	// Filter by .rooignore
	const allowedPaths = ignoreController.filterPaths(filePaths)

	// Filter by supported extensions and ignored directories
	return allowedPaths.filter((filePath) => {
		const ext = path.extname(filePath).toLowerCase()
		const relativeFilePath = generateRelativeFilePath(filePath, workspacePath)

		// Check if file is in an ignored directory
		if (isPathInIgnoredDirectory(filePath)) {
			return false
		}

		return scannerExtensions.includes(ext)
	})
}

/**
 * Processes files in parallel with batching
 *
 * @param filePaths Files to process
 * @param config Indexing configuration
 * @param context VSCode extension context
 * @param cache Client cache
 * @param gitBranch Current git branch
 * @param isBase Whether this is a base branch
 * @param onProgress Progress callback
 * @returns Processing result with updated cache
 */
async function processFiles(
	filePaths: string[],
	config: ManagedIndexingConfig,
	context: vscode.ExtensionContext,
	cache: ClientCache,
	gitBranch: string,
	isBase: boolean,
	onProgress?: (progress: ScanProgress) => void,
): Promise<{
	filesProcessed: number
	filesSkipped: number
	chunksIndexed: number
	cache: ClientCache
	errors: Error[]
}> {
	const limit = pLimit(MANAGED_MAX_CONCURRENT_FILES)
	const errors: Error[] = []
	let filesProcessed = 0
	let filesSkipped = 0
	let chunksIndexed = 0
	let updatedCache = cache

	// Batch accumulator
	let currentBatch: any[] = []

	const processBatch = async () => {
		if (currentBatch.length === 0) return

		try {
			await upsertChunks(currentBatch, config.kilocodeToken)
			chunksIndexed += currentBatch.length
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)))
		}

		currentBatch = []
	}

	const promises = filePaths.map((filePath) =>
		limit(async () => {
			try {
				// Check file size
				const stats = await stat(filePath)
				if (stats.size > MAX_FILE_SIZE_BYTES) {
					filesSkipped++
					logger.warn(`Skipping large file: ${filePath} (${stats.size} bytes)`)
					return
				}

				// Read file content
				const content = await vscode.workspace.fs
					.readFile(vscode.Uri.file(filePath))
					.then((buffer) => Buffer.from(buffer).toString("utf-8"))

				// Calculate file hash
				const fileHash = calculateFileHash(content)

				// Check if file needs indexing
				if (!shouldIndexFile(updatedCache, filePath, fileHash)) {
					filesSkipped++
					return
				}

				// Chunk the file
				const relativeFilePath = generateRelativeFilePath(filePath, config.workspacePath)
				const chunks = chunkFile(
					relativeFilePath,
					content,
					fileHash,
					config.organizationId,
					config.projectId,
					gitBranch,
					isBase,
					config.chunker,
				)

				// Add to batch
				currentBatch.push(...chunks)

				// Process batch if threshold reached
				if (currentBatch.length >= MANAGED_BATCH_SIZE) {
					await processBatch()
				}

				// Update cache
				updatedCache = updateCacheEntry(updatedCache, relativeFilePath, fileHash, chunks.length)

				filesProcessed++

				// Report progress
				onProgress?.({
					filesProcessed,
					filesTotal: filePaths.length,
					chunksIndexed,
					currentFile: relativeFilePath,
				})
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error))
				// Create a more descriptive error with file context
				const contextualError = new Error(`Failed to process ${filePath}: ${err.message}`)
				contextualError.stack = err.stack
				errors.push(contextualError)
				logger.error(`Error processing file ${filePath}: ${err.message}`)
				if (err.stack) {
					logger.error(`Stack trace: ${err.stack}`)
				}
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: err.message,
					stack: err.stack,
					location: "processFiles",
					filePath,
				})
			}
		}),
	)

	// Wait for all files to be processed
	await Promise.all(promises)

	// Process remaining batch
	await processBatch()

	return {
		filesProcessed,
		filesSkipped,
		chunksIndexed,
		cache: updatedCache,
		errors,
	}
}

/**
 * Indexes a single file
 *
 * This is used by the file watcher for incremental updates.
 *
 * @param filePath Absolute file path
 * @param config Indexing configuration
 * @param context VSCode extension context
 * @param cache Client cache
 * @returns Updated cache
 */
export async function indexFile(
	filePath: string,
	config: ManagedIndexingConfig,
	context: vscode.ExtensionContext,
	cache: ClientCache,
): Promise<ClientCache> {
	try {
		// Get current branch
		const gitBranch = getCurrentBranch(config.workspacePath)
		const isBase = checkIsBaseBranch(gitBranch)

		// Check file size
		const stats = await stat(filePath)
		if (stats.size > MAX_FILE_SIZE_BYTES) {
			logger.warn(`Skipping large file: ${filePath} (${stats.size} bytes)`)
			return cache
		}

		// Read file content
		const content = await vscode.workspace.fs
			.readFile(vscode.Uri.file(filePath))
			.then((buffer) => Buffer.from(buffer).toString("utf-8"))

		// Calculate file hash
		const fileHash = calculateFileHash(content)

		// Get relative path
		const relativeFilePath = generateRelativeFilePath(filePath, config.workspacePath)

		// Delete old chunks for this file on this branch
		await deleteFiles([relativeFilePath], gitBranch, config.organizationId, config.projectId, config.kilocodeToken)

		// Chunk the file
		const chunks = chunkFile(
			relativeFilePath,
			content,
			fileHash,
			config.organizationId,
			config.projectId,
			gitBranch,
			isBase,
			config.chunker,
		)

		// Upsert new chunks
		await upsertChunks(chunks, config.kilocodeToken)

		// Update cache
		const updatedCache = updateCacheEntry(cache, relativeFilePath, fileHash, chunks.length)

		// Save cache
		await saveClientCache(context, config.workspacePath, updatedCache)

		logger.info(`Indexed file: ${relativeFilePath} (${chunks.length} chunks)`)

		return updatedCache
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		logger.error(`Failed to index file ${filePath}: ${err.message}`)
		TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
			error: err.message,
			stack: err.stack,
			location: "indexFile",
			filePath,
		})
		throw err
	}
}

/**
 * Handles file deletion
 *
 * @param filePath Absolute file path
 * @param config Indexing configuration
 * @param context VSCode extension context
 * @param cache Client cache
 * @returns Updated cache
 */
export async function handleFileDeleted(
	filePath: string,
	config: ManagedIndexingConfig,
	context: vscode.ExtensionContext,
	cache: ClientCache,
): Promise<ClientCache> {
	try {
		const gitBranch = getCurrentBranch(config.workspacePath)
		const relativeFilePath = generateRelativeFilePath(filePath, config.workspacePath)

		// Delete chunks from server
		await deleteFiles([relativeFilePath], gitBranch, config.organizationId, config.projectId, config.kilocodeToken)

		// Update cache
		let updatedCache = { ...cache }

		// Remove from files
		const { [relativeFilePath]: removed, ...remainingFiles } = updatedCache.files
		updatedCache.files = remainingFiles

		// Add to deleted files if on feature branch
		if (!checkIsBaseBranch(gitBranch)) {
			updatedCache = addDeletedFile(updatedCache, relativeFilePath)
		}

		// Save cache
		await saveClientCache(context, config.workspacePath, updatedCache)

		logger.info(`Deleted file from index: ${relativeFilePath}`)

		return updatedCache
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		logger.error(`Failed to handle file deletion ${filePath}: ${err.message}`)
		TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
			error: err.message,
			stack: err.stack,
			location: "handleFileDeleted",
			filePath,
		})
		throw err
	}
}

// kilocode_change - new file
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
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { isPathInIgnoredDirectory } from "../../glob/ignore-utils"
import { scannerExtensions } from "../shared/supported-extensions"
import { generateRelativeFilePath } from "../shared/get-relative-path"
import { chunkFile, calculateFileHash } from "./chunker"
import { upsertChunks, deleteFiles } from "./api-client"
import {
	getCurrentBranch,
	getGitDiff,
	isBaseBranch as checkIsBaseBranch,
	isGitRepository,
	getGitTrackedFiles,
	getBaseBranch,
} from "./git-utils"
import { ManagedIndexingConfig, ScanProgress, ScanResult, ServerManifest } from "./types"
import { MAX_FILE_SIZE_BYTES, MANAGED_MAX_CONCURRENT_FILES, MANAGED_BATCH_SIZE } from "../constants"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import { logger } from "../../../utils/logging"

/**
 * Helper function to compare two arrays for equality
 */
function arraysEqual<T>(a: T[], b: T[]): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}

/**
 * Scans a directory and indexes files based on branch strategy
 *
 * - Main branch: Scans all files
 * - Feature branch: Only scans files changed from main (delta)
 *
 * @param config Managed indexing configuration
 * @param manifest Optional server manifest for intelligent delta indexing
 * @param onProgress Optional progress callback
 * @param forceFullScan Force a full scan even on feature branches (used when server has no data)
 * @returns Scan result with statistics
 */
export async function scanDirectory(
	config: ManagedIndexingConfig,
	manifest?: ServerManifest,
	onProgress?: (progress: ScanProgress) => void,
	forceFullScan: boolean = false,
): Promise<ScanResult> {
	const errors: Error[] = []

	try {
		// Check if workspace is a git repository
		if (!(await isGitRepository(config.workspacePath))) {
			throw new Error("Workspace is not a git repository")
		}

		// Get current branch
		const currentBranch = await getCurrentBranch(config.workspacePath)
		const isBase = await checkIsBaseBranch(currentBranch, config.workspacePath)

		// Determine which files to scan
		const filesToScan = await getFilesToScan(config.workspacePath, currentBranch, isBase)

		console.info(`Scanning ${filesToScan.length} files on branch ${currentBranch} (isBase: ${isBase})`)

		// Process files with manifest for intelligent skipping
		const result = await processFiles(filesToScan, config, currentBranch, isBase, manifest, onProgress)

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
		console.error(`Scan directory failed: ${err.message}`)
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
		const baseBranch = await getBaseBranch(workspacePath)
		const diff = await getGitDiff(currentBranch, baseBranch, workspacePath)
		const changedFiles = [...diff.added, ...diff.modified]

		// Convert relative paths from git to absolute paths and filter to only supported files
		return changedFiles
			.filter((file) => {
				const ext = path.extname(file).toLowerCase()
				return scannerExtensions.includes(ext)
			})
			.map((file) => path.join(workspacePath, file))
	}
}

/**
 * Gets all supported files in the workspace that are tracked by git
 *
 * @param workspacePath Workspace root path
 * @returns Array of supported file paths (absolute paths)
 */
async function getAllSupportedFiles(workspacePath: string): Promise<string[]> {
	// Get all git-tracked files (relative paths) using async generator
	const gitTrackedFiles: string[] = []
	for await (const file of getGitTrackedFiles(workspacePath)) {
		gitTrackedFiles.push(file)
	}

	logger.info(`Found ${gitTrackedFiles.length} git-tracked files`)

	// Initialize ignore controller for .rooignore
	const ignoreController = new RooIgnoreController(workspacePath)
	await ignoreController.initialize()

	// Filter by .rooignore
	const allowedPaths = ignoreController.filterPaths(gitTrackedFiles)

	logger.info(`After .rooignore filter: ${allowedPaths.length} files`)

	// Filter by supported extensions and convert to absolute paths
	const supportedFiles = allowedPaths
		.filter((filePath) => {
			const ext = path.extname(filePath).toLowerCase()

			// Check if file is in an ignored directory
			if (isPathInIgnoredDirectory(filePath)) {
				return false
			}

			return scannerExtensions.includes(ext)
		})
		.map((filePath) => path.join(workspacePath, filePath))

	logger.info(`After extension filter: ${supportedFiles.length} files`)

	return supportedFiles
}

/**
 * Processes files in parallel with batching
 *
 * @param filePaths Files to process
 * @param config Indexing configuration
 * @param gitBranch Current git branch
 * @param isBase Whether this is a base branch
 * @param manifest Optional server manifest for intelligent skipping
 * @param onProgress Progress callback
 * @returns Processing result
 */
async function processFiles(
	filePaths: string[],
	config: ManagedIndexingConfig,
	gitBranch: string,
	isBase: boolean,
	manifest?: ServerManifest,
	onProgress?: (progress: ScanProgress) => void,
): Promise<{
	filesProcessed: number
	filesSkipped: number
	chunksIndexed: number
	errors: Error[]
}> {
	const limit = pLimit(MANAGED_MAX_CONCURRENT_FILES)
	const errors: Error[] = []
	let filesProcessed = 0
	let filesSkipped = 0
	let chunksIndexed = 0

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
					console.warn(`Skipping large file: ${filePath} (${stats.size} bytes)`)
					return
				}

				// Read file content
				const content = await vscode.workspace.fs
					.readFile(vscode.Uri.file(filePath))
					.then((buffer) => Buffer.from(buffer).toString("utf-8"))

				// Calculate file hash
				const fileHash = calculateFileHash(content)

				// Get relative path for manifest comparison
				const relativeFilePath = generateRelativeFilePath(filePath, config.workspacePath)

				// Chunk the file
				const chunks = chunkFile({
					filePath: relativeFilePath,
					content,
					fileHash,
					organizationId: config.organizationId,
					projectId: config.projectId,
					gitBranch,
					isBaseBranch: isBase,
					config: config.chunker,
				})

				// Extract chunk hashes for comparison
				const currentChunkHashes = chunks.map((c) => c.chunkHash)

				// Check if file is already indexed on server with matching chunk hashes
				if (manifest) {
					const manifestEntry = manifest.files.find((f) => f.filePath === relativeFilePath)
					if (manifestEntry && arraysEqual(currentChunkHashes, manifestEntry.chunkHashes)) {
						// File already indexed on server with same chunks - skip
						filesSkipped++
						logger.info(`[Scanner] Skipping ${relativeFilePath} - already indexed on server`)
						return
					}
				}

				// Add to batch
				currentBatch.push(...chunks)

				// Process batch if threshold reached
				if (currentBatch.length >= MANAGED_BATCH_SIZE) {
					await processBatch()
				}

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
				console.error(`Error processing file ${filePath}: ${err.message}`)
				if (err.stack) {
					console.error(`Stack trace: ${err.stack}`)
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
		errors,
	}
}

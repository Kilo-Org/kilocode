/**
 * Client-side cache management for managed codebase indexing
 *
 * This module provides functions for managing the local cache that tracks
 * which files have been indexed and their current state. The cache is stored
 * per workspace and per branch to handle branch switches efficiently.
 */

import * as vscode from "vscode"
import { createHash } from "crypto"
import { ClientCache } from "./types"
import { safeWriteJson } from "../../../utils/safeWriteJson"
import { getCurrentBranch } from "./git-utils"

/**
 * Gets the cache file path for a specific workspace and branch
 *
 * @param context VSCode extension context
 * @param workspacePath Workspace root path
 * @param gitBranch Git branch name
 * @returns URI to the cache file
 */
function getCachePath(context: vscode.ExtensionContext, workspacePath: string, gitBranch: string): vscode.Uri {
	const workspaceHash = createHash("sha256").update(workspacePath).digest("hex")
	const branchHash = createHash("sha256").update(gitBranch).digest("hex")
	const fileName = `managed-index-cache-${workspaceHash}-${branchHash}.json`

	return vscode.Uri.joinPath(context.globalStorageUri, fileName)
}

/**
 * Loads the client cache for the current branch
 *
 * @param context VSCode extension context
 * @param workspacePath Workspace root path
 * @returns Client cache or empty cache if not found
 */
export async function loadClientCache(context: vscode.ExtensionContext, workspacePath: string): Promise<ClientCache> {
	try {
		const gitBranch = getCurrentBranch(workspacePath)
		const cachePath = getCachePath(context, workspacePath, gitBranch)

		const cacheData = await vscode.workspace.fs.readFile(cachePath)
		const cache: ClientCache = JSON.parse(cacheData.toString())

		// Validate cache structure
		if (!cache.gitBranch || !cache.files) {
			throw new Error("Invalid cache structure")
		}

		return cache
	} catch (error) {
		// Return empty cache if file doesn't exist or is invalid
		const gitBranch = getCurrentBranch(workspacePath)
		return createEmptyCache(gitBranch)
	}
}

/**
 * Saves the client cache to disk
 *
 * @param context VSCode extension context
 * @param workspacePath Workspace root path
 * @param cache Client cache to save
 */
export async function saveClientCache(
	context: vscode.ExtensionContext,
	workspacePath: string,
	cache: ClientCache,
): Promise<void> {
	try {
		const cachePath = getCachePath(context, workspacePath, cache.gitBranch)
		await safeWriteJson(cachePath.fsPath, cache)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error(`Failed to save client cache: ${errorMessage}`)
		// Don't throw - cache save failure shouldn't break indexing
	}
}

/**
 * Creates an empty cache for a specific branch
 *
 * @param gitBranch Git branch name
 * @returns Empty client cache
 */
export function createEmptyCache(gitBranch: string): ClientCache {
	return {
		gitBranch,
		deletedFiles: [],
		files: {},
	}
}

/**
 * Updates the cache entry for a specific file
 *
 * @param cache Client cache to update
 * @param filePath File path
 * @param fileHash SHA-256 hash of file content
 * @param chunkCount Number of chunks generated
 * @returns Updated cache (does not mutate original)
 */
export function updateCacheEntry(
	cache: ClientCache,
	filePath: string,
	fileHash: string,
	chunkCount: number,
): ClientCache {
	cache.files[filePath] = {
		hash: fileHash,
		lastIndexed: Date.now(),
		chunkCount,
	}

	return cache
}

/**
 * Removes a file entry from the cache
 *
 * @param cache Client cache to update
 * @param filePath File path to remove
 * @returns Updated cache (does not mutate original)
 */
export function removeCacheEntry(cache: ClientCache, filePath: string): ClientCache {
	const { [filePath]: removed, ...remainingFiles } = cache.files

	return {
		...cache,
		files: remainingFiles,
	}
}

/**
 * Adds a file to the deleted files list
 *
 * @param cache Client cache to update
 * @param filePath File path to mark as deleted
 * @returns Updated cache (does not mutate original)
 */
export function addDeletedFile(cache: ClientCache, filePath: string): ClientCache {
	if (cache.deletedFiles.includes(filePath)) {
		return cache
	}

	return {
		...cache,
		deletedFiles: [...cache.deletedFiles, filePath],
	}
}

/**
 * Removes a file from the deleted files list
 *
 * @param cache Client cache to update
 * @param filePath File path to remove from deleted list
 * @returns Updated cache (does not mutate original)
 */
export function removeDeletedFile(cache: ClientCache, filePath: string): ClientCache {
	return {
		...cache,
		deletedFiles: cache.deletedFiles.filter((f) => f !== filePath),
	}
}

/**
 * Clears the entire cache for the current branch
 *
 * @param context VSCode extension context
 * @param workspacePath Workspace root path
 */
export async function clearClientCache(context: vscode.ExtensionContext, workspacePath: string): Promise<void> {
	try {
		const gitBranch = getCurrentBranch(workspacePath)
		const cachePath = getCachePath(context, workspacePath, gitBranch)

		// Write empty cache
		const emptyCache = createEmptyCache(gitBranch)
		await safeWriteJson(cachePath.fsPath, emptyCache)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error(`Failed to clear client cache: ${errorMessage}`)
		// Don't throw - cache clear failure shouldn't break operations
	}
}

/**
 * Checks if a file should be indexed based on cache state
 *
 * @param cache Client cache
 * @param filePath File path to check
 * @param currentHash Current SHA-256 hash of file content
 * @returns true if file should be indexed (new or changed)
 */
export function shouldIndexFile(cache: ClientCache, filePath: string, currentHash: string): boolean {
	const cached = cache.files[filePath]

	// Index if:
	// 1. Not in cache (new file)
	// 2. Hash changed (file modified)
	return !cached || cached.hash !== currentHash
}

/**
 * Managed Codebase Indexing
 *
 * This module provides a complete, standalone indexing system for Kilo Code
 * organization users. It is completely separate from the local indexing system
 * and uses a simpler, more efficient approach:
 *
 * - Line-based chunking (no tree-sitter)
 * - Delta indexing (only changed files on feature branches)
 * - Server-side embeddings (no client computation)
 * - Client-driven search (client sends deleted files)
 * - Functional architecture (stateless, composable functions)
 *
 * @example
 * ```typescript
 * import { startIndexing, search, createManagedIndexingConfig } from './managed'
 *
 * // Create configuration
 * const config = createManagedIndexingConfig(
 *   organizationId,
 *   projectId,
 *   kilocodeToken,
 *   workspacePath
 * )
 *
 * // Start indexing
 * const disposable = await startIndexing(config, context, (state) => {
 *   console.log('State:', state)
 * })
 *
 * // Search
 * const results = await search('my query', config)
 *
 * // Stop indexing
 * disposable.dispose()
 * ```
 */

// Main API
export { startIndexing, search, getIndexerState, createManagedIndexingConfig } from "./indexer"

// Scanner functions (for advanced usage)
export { scanDirectory, indexFile, handleFileDeleted } from "./scanner"

// Watcher functions
export { createFileWatcher } from "./watcher"

// Chunker functions
export { chunkFile, calculateFileHash, getDefaultChunkerConfig } from "./chunker"

// API client functions
export {
	upsertChunks,
	searchCode,
	deleteFiles,
	deleteFile,
	getServerManifest,
	deleteBranchIndex,
	deleteProjectIndex,
} from "./api-client"

// Git utilities
export {
	getCurrentBranch,
	getCurrentCommitSha,
	getRemoteUrl,
	getGitDiff,
	isBaseBranch,
	getBaseBranch,
	isGitRepository,
	hasUncommittedChanges,
	// getGitTrackedFiles,
	getGitTrackedFilesSync,
} from "./git-utils"

// Cache utilities
export {
	loadClientCache,
	saveClientCache,
	createEmptyCache,
	updateCacheEntry,
	removeCacheEntry,
	addDeletedFile,
	removeDeletedFile,
	clearClientCache,
	shouldIndexFile,
} from "./cache"

// Types
export type {
	ManagedCodeChunk,
	ChunkerConfig,
	GitDiff,
	ClientCache,
	ManagedIndexingConfig,
	ScanProgress,
	ScanResult,
	ManifestFileEntry,
	ServerManifest,
	SearchRequest,
	SearchResult,
	FileChangeEvent,
	IndexerState,
} from "./types"

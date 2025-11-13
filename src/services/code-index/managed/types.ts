// kilocode_change - new file
/**
 * Type definitions for Managed Codebase Indexing
 *
 * This module defines the core types used throughout the managed indexing system.
 * The system uses a delta-based approach where only the main branch has a full index,
 * and feature branches only index their changes (added/modified files).
 */

/**
 * A code chunk with git metadata for managed indexing
 */
export interface ManagedCodeChunk {
	/** Unique identifier for this chunk (uuidv5 based on chunk hash + org ID) */
	id: string
	/** Organization ID */
	organizationId: string
	/** Project ID */
	projectId: string
	/** Relative file path from workspace root */
	filePath: string
	/** The actual code content of this chunk */
	codeChunk: string
	/** Starting line number (1-based) */
	startLine: number
	/** Ending line number (1-based, inclusive) */
	endLine: number
	/** Hash of the chunk content for deduplication */
	chunkHash: string
	/** Git branch this chunk belongs to */
	gitBranch: string
	/** Whether this is from a base branch (main/develop) */
	isBaseBranch: boolean
}

/**
 * Configuration for the line-based chunker
 */
export interface ChunkerConfig {
	/** Maximum characters per chunk (default: 1000) */
	maxChunkChars: number
	/** Minimum characters per chunk (default: 200) */
	minChunkChars: number
	/** Number of lines to overlap between chunks (default: 5) */
	overlapLines: number
}

/**
 * Git diff result showing changes between branches
 */
export interface GitDiff {
	/** Files added on the feature branch */
	added: string[]
	/** Files modified on the feature branch */
	modified: string[]
	/** Files deleted on the feature branch */
	deleted: string[]
}

/**
 * Configuration for managed indexing
 */
export interface ManagedIndexingConfig {
	/** Organization ID */
	organizationId: string
	/** Project ID */
	projectId: string
	/** Kilo Code authentication token */
	kilocodeToken: string
	/** Workspace root path */
	workspacePath: string
	/** Chunker configuration */
	chunker: ChunkerConfig
	/** Batch size for API calls (default: 60) */
	batchSize: number
	/** Whether to auto-sync on file changes (default: true) */
	autoSync: boolean
}

/**
 * Progress information during scanning
 */
export interface ScanProgress {
	/** Number of files processed so far */
	filesProcessed: number
	/** Total number of files to process */
	filesTotal: number
	/** Number of chunks indexed so far */
	chunksIndexed: number
	/** Current file being processed (optional) */
	currentFile?: string
}

/**
 * Result of a directory scan operation
 */
export interface ScanResult {
	/** Whether the scan completed successfully */
	success: boolean
	/** Number of files processed */
	filesProcessed: number
	/** Number of files skipped (unchanged) */
	filesSkipped: number
	/** Number of chunks indexed */
	chunksIndexed: number
	/** Any errors encountered during scanning */
	errors: Error[]
}

/**
 * Server manifest entry for a single file
 */
export interface ManifestFileEntry {
	/** Relative file path */
	filePath: string
	/** Array of chunk hashes for this file (for accurate change detection) */
	chunkHashes: string[]
	/** Number of chunks for this file */
	chunkCount: number
	/** When this file was last indexed */
	lastIndexed: string
	/** Optional: which user/client indexed it */
	indexedBy?: string
}

/**
 * Server manifest response
 */
export interface ServerManifest {
	/** Organization ID */
	organizationId: string
	/** Project ID */
	projectId: string
	/** Git branch */
	gitBranch: string
	/** List of indexed files */
	files: ManifestFileEntry[]
	/** Total number of files in manifest */
	totalFiles: number
	/** Total number of chunks across all files */
	totalChunks: number
	/** When manifest was last updated */
	lastUpdated: string
}

/**
 * Search request with branch preferences
 */
export interface SearchRequest {
	/** Search query */
	query: string
	/** Organization ID */
	organizationId: string
	/** Project ID */
	projectId: string
	/** Preferred branch to search first */
	preferBranch: string
	/** Fallback branch to search (usually 'main') */
	fallbackBranch: string
	/** Files to exclude from results (deleted on preferred branch) */
	excludeFiles: string[]
	/** Optional directory path filter */
	path?: string
}

/**
 * Search result from the server
 */
export interface SearchResult {
	/** Chunk ID */
	id: string
	/** File path */
	filePath: string
	/** Starting line number */
	startLine: number
	/** Ending line number */
	endLine: number
	/** Relevance score */
	score: number
	/** Which branch this result came from */
	gitBranch: string
	/** Whether this result came from the preferred branch */
	fromPreferredBranch: boolean
}

/**
 * File change event
 */
export interface FileChangeEvent {
	/** Type of change */
	type: "created" | "changed" | "deleted"
	/** File path */
	filePath: string
	/** Timestamp of change */
	timestamp: number
}

/**
 * Indexer state for UI updates
 */
export interface IndexerState {
	/** Current status */
	status: "idle" | "scanning" | "watching" | "error"
	/** Status message */
	message: string
	/** Current git branch */
	gitBranch?: string
	/** Last sync timestamp */
	lastSyncTime?: number
	/** Total files indexed */
	totalFiles?: number
	/** Total chunks indexed */
	totalChunks?: number
	/** Error message if status is 'error' */
	error?: string
	/** Server manifest data (when available) */
	manifest?: {
		totalFiles: number
		totalChunks: number
		lastUpdated: string
	}
}

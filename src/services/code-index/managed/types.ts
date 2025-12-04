// kilocode_change - new file
/**
 * Type definitions for Managed Codebase Indexing
 *
 * This module defines the core types used throughout the managed indexing system.
 * The system uses a delta-based approach where only the main branch has a full index,
 * and feature branches only index their changes (added/modified files).
 */

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
 * A single file change from git diff
 */
export interface GitDiffFile {
	/** Type of change */
	type: "added" | "modified" | "deleted"
	/** File path relative to workspace root */
	filePath: string
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
	/** Map of indexed files by fileHash to filePath */
	files: {
		[fileHash: string]: string
	}
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
	organizationId: string | null
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

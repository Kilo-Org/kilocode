// kilocode_change - new file

/**
 * Review Mode Types
 *
 * Type definitions for the local code review feature.
 * Simplified for dynamic tool-based review approach.
 */

/**
 * Review scope - what the user wants to review
 */
export type ReviewScope = "uncommitted" | "branch"

/**
 * File status from git
 */
export type FileStatus = "A" | "M" | "D" | "R" | "C" | "U" | "?"

/**
 * Summary of a single changed file
 */
export interface FileSummary {
	/** File path relative to repository root */
	path: string
	/** Change status: A=added, M=modified, D=deleted, R=renamed, C=copied, U=unmerged, ?=untracked */
	status: FileStatus
	/** Original path for renamed/copied files */
	oldPath?: string
}

/**
 * Lightweight review summary - minimal context for dynamic review
 * The agent will use tools to explore details as needed
 */
export interface ReviewSummary {
	/** The review scope selected by user */
	scope: ReviewScope
	/** Current branch name */
	currentBranch: string
	/** Base branch for comparison (only for branch scope) */
	baseBranch?: string
	/** List of changed files with their status */
	files: FileSummary[]
	/** Total number of files changed */
	totalFiles: number
	/** Whether there are any changes to review */
	hasChanges: boolean
	/** Error message if summary gathering failed */
	error?: string
}

/**
 * Options for the ReviewService
 */
export interface ReviewServiceOptions {
	/** Working directory (repository root) */
	cwd: string
}

/**
 * Information about available review scopes
 * Used by UI to show preview before user selects
 */
export interface ReviewScopeInfo {
	/** Info about uncommitted changes scope */
	uncommitted: {
		/** Whether this scope is available (has changes) */
		available: boolean
		/** Number of files with uncommitted changes */
		fileCount: number
		/** Preview of file names (first few) */
		filePreview?: string[]
	}
	/** Info about branch comparison scope */
	branch: {
		/** Whether this scope is available (not on base branch, has commits) */
		available: boolean
		/** Current branch name */
		currentBranch: string
		/** Detected base branch for comparison */
		baseBranch: string
		/** Number of files changed between branches */
		fileCount: number
		/** Preview of file names (first few) */
		filePreview?: string[]
	}
	/** Error message if unable to get scope info */
	error?: string
}

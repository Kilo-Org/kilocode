/**
 * Worktree Types
 *
 * Platform-agnostic type definitions for git worktree operations.
 * These types are decoupled from VSCode and can be used by any consumer.
 */

/**
 * Represents a git worktree
 */
export interface Worktree {
	/** Absolute path to the worktree directory */
	path: string
	/** Branch name - empty string if detached HEAD */
	branch: string
	/** Current commit hash */
	commitHash: string
	/** Whether this is the current worktree (matches cwd) */
	isCurrent: boolean
	/** Whether this is the bare/main repository */
	isBare: boolean
	/** Whether HEAD is detached (not on a branch) */
	isDetached: boolean
	/** Whether the worktree is locked */
	isLocked: boolean
	/** Reason for lock if locked */
	lockReason?: string
}

/**
 * Result of a worktree operation (create, delete, etc.)
 */
export interface WorktreeResult {
	/** Whether the operation succeeded */
	success: boolean
	/** Human-readable message describing the result */
	message: string
	/** The worktree that was affected (if applicable) */
	worktree?: Worktree
}

/**
 * Branch information for worktree creation
 */
export interface BranchInfo {
	/** Local branches available */
	localBranches: string[]
	/** Remote branches available */
	remoteBranches: string[]
	/** Currently checked out branch */
	currentBranch: string
}

/**
 * Options for creating a worktree
 */
export interface CreateWorktreeOptions {
	/** Path where the worktree will be created */
	path: string
	/** Branch name to checkout or create */
	branch?: string
	/** Base branch to create new branch from */
	baseBranch?: string
	/** If true, create a new branch; if false, checkout existing branch */
	createNewBranch?: boolean
}

/**
 * Status of .worktreeinclude file
 */
export interface WorktreeIncludeStatus {
	/** Whether .worktreeinclude exists in the directory */
	exists: boolean
	/** Whether .gitignore exists in the directory */
	hasGitignore: boolean
	/** Content of .gitignore (for creating .worktreeinclude) */
	gitignoreContent?: string
}

/**
 * Response for listWorktrees handler
 */
export interface WorktreeListResponse {
	worktrees: Worktree[]
	isGitRepo: boolean
	error?: string
	isMultiRoot: boolean
	isSubfolder: boolean
	gitRootPath: string
}

/**
 * Response for worktree defaults
 */
export interface WorktreeDefaultsResponse {
	suggestedBranch: string
	suggestedPath: string
	error?: string
}

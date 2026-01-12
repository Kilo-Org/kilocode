// kilocode_change - new file
/**
 * Git History Analyzer - Type Definitions
 */

/**
 * Information about a single commit
 */
export interface CommitInfo {
	/** Commit hash */
	hash: string
	/** Short hash (7 characters) */
	shortHash: string
	/** Author name */
	author: string
	/** Author email */
	authorEmail: string
	/** Commit date */
	date: Date
	/** Commit message */
	message: string
	/** Files changed in this commit */
	filesChanged: string[]
}

/**
 * Information about a contributor
 */
export interface Contributor {
	/** Contributor name */
	name: string
	/** Contributor email */
	email: string
	/** Number of commits by this contributor */
	commitCount: number
	/** Date of last commit */
	lastCommit: Date
	/** Date of first commit */
	firstCommit: Date
	/** Lines added (if available) */
	linesAdded?: number
	/** Lines removed (if available) */
	linesRemoved?: number
}

/**
 * A file that changes frequently (hotspot)
 */
export interface Hotspot {
	/** File path relative to repository root */
	filePath: string
	/** Number of times this file was changed */
	changeFrequency: number
	/** Number of unique contributors */
	contributorCount: number
	/** Date of last modification */
	lastModified: Date
	/** Average changes per month */
	changesPerMonth: number
}

/**
 * Information about a file change
 */
export interface FileChange {
	/** File path */
	filePath: string
	/** Type of change */
	changeType: "added" | "modified" | "deleted" | "renamed"
	/** Commit information */
	commit: CommitInfo
	/** Lines added */
	linesAdded?: number
	/** Lines removed */
	linesRemoved?: number
	/** Previous path (for renames) */
	previousPath?: string
}

/**
 * Interface for the Git History Analyzer
 */
export interface IGitHistoryAnalyzer {
	/**
	 * Initialize the analyzer for a repository
	 * @param repoPath Path to the repository
	 */
	initialize(repoPath: string): Promise<void>

	/**
	 * Check if git is available and the path is a git repository
	 */
	isAvailable(): boolean

	/**
	 * Get commit history for a specific file
	 * @param filePath Path to the file
	 * @param limit Maximum number of commits to return
	 */
	getFileHistory(filePath: string, limit?: number): Promise<CommitInfo[]>

	/**
	 * Get contributors for a specific file
	 * @param filePath Path to the file (optional, if not provided returns all contributors)
	 */
	getContributors(filePath?: string): Promise<Contributor[]>

	/**
	 * Get hotspots (frequently changed files)
	 * @param limit Maximum number of hotspots to return
	 * @param since Only consider commits since this date
	 */
	getHotspots(limit?: number, since?: Date): Promise<Hotspot[]>

	/**
	 * Get recent changes across the repository
	 * @param since Only return changes since this date
	 * @param limit Maximum number of changes to return
	 */
	getRecentChanges(since?: Date, limit?: number): Promise<FileChange[]>

	/**
	 * Get the last modification date for a file
	 * @param filePath Path to the file
	 */
	getLastModified(filePath: string): Promise<Date | null>

	/**
	 * Calculate relevance score based on recency
	 * @param filePath Path to the file
	 * @param baseScore Base relevance score to adjust
	 */
	calculateRecencyScore(filePath: string, baseScore: number): Promise<number>
}

/**
 * Options for Git History Analyzer
 */
export interface GitAnalyzerOptions {
	/** Maximum number of commits to analyze for hotspots */
	maxCommitsForHotspots?: number
	/** How far back to look for recent changes (in days) */
	recentChangesDays?: number
	/** Weight for recency in relevance scoring (0-1) */
	recencyWeight?: number
}

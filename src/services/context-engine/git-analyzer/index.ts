// kilocode_change - new file
/**
 * Git History Analyzer
 *
 * Analyzes git history to provide insights about code changes,
 * contributors, and frequently modified files (hotspots).
 */

import * as path from "path"
import simpleGit, { SimpleGit, LogResult, DefaultLogFields } from "simple-git"
import { IGitHistoryAnalyzer, CommitInfo, Contributor, Hotspot, FileChange, GitAnalyzerOptions } from "./types"

// Re-export types
export * from "./types"

const DEFAULT_OPTIONS: GitAnalyzerOptions = {
	maxCommitsForHotspots: 1000,
	recentChangesDays: 30,
	recencyWeight: 0.3,
}

/**
 * Git History Analyzer implementation using simple-git
 */
export class GitHistoryAnalyzer implements IGitHistoryAnalyzer {
	private git: SimpleGit | null = null
	private repoPath: string = ""
	private _isAvailable: boolean = false
	private options: GitAnalyzerOptions

	constructor(options: Partial<GitAnalyzerOptions> = {}) {
		this.options = { ...DEFAULT_OPTIONS, ...options }
	}

	/**
	 * Initialize the analyzer for a repository
	 */
	async initialize(repoPath: string): Promise<void> {
		this.repoPath = repoPath

		try {
			this.git = simpleGit(repoPath)
			// Check if this is a git repository
			const isRepo = await this.git.checkIsRepo()
			this._isAvailable = isRepo
		} catch (error) {
			console.warn(`[GitHistoryAnalyzer] Failed to initialize: ${error}`)
			this.git = null
			this._isAvailable = false
		}
	}

	/**
	 * Check if git is available
	 */
	isAvailable(): boolean {
		return this._isAvailable
	}

	/**
	 * Get commit history for a specific file
	 */
	async getFileHistory(filePath: string, limit: number = 50): Promise<CommitInfo[]> {
		if (!this.git || !this._isAvailable) {
			return []
		}

		try {
			const relativePath = this.getRelativePath(filePath)
			const log = await this.git.log({
				file: relativePath,
				maxCount: limit,
				"--follow": null, // Follow file renames
			})

			return this.parseLogResult(log)
		} catch (error) {
			console.warn(`[GitHistoryAnalyzer] Failed to get file history: ${error}`)
			return []
		}
	}

	/**
	 * Get contributors for a file or the entire repository
	 */
	async getContributors(filePath?: string): Promise<Contributor[]> {
		if (!this.git || !this._isAvailable) {
			return []
		}

		try {
			const logOptions: Record<string, any> = {
				maxCount: this.options.maxCommitsForHotspots,
			}

			if (filePath) {
				logOptions.file = this.getRelativePath(filePath)
				logOptions["--follow"] = null
			}

			const log = await this.git.log(logOptions)

			// Aggregate by contributor
			const contributorMap = new Map<
				string,
				{
					name: string
					email: string
					commits: Date[]
				}
			>()

			for (const commit of log.all) {
				const email = commit.author_email || "unknown"
				const name = commit.author_name || "Unknown"

				if (!contributorMap.has(email)) {
					contributorMap.set(email, {
						name,
						email,
						commits: [],
					})
				}

				contributorMap.get(email)!.commits.push(new Date(commit.date))
			}

			// Convert to Contributor array
			const contributors: Contributor[] = []
			for (const [_email, data] of contributorMap) {
				const sortedDates = data.commits.sort((a, b) => a.getTime() - b.getTime())
				contributors.push({
					name: data.name,
					email: data.email,
					commitCount: data.commits.length,
					firstCommit: sortedDates[0],
					lastCommit: sortedDates[sortedDates.length - 1],
				})
			}

			// Sort by commit count descending
			return contributors.sort((a, b) => b.commitCount - a.commitCount)
		} catch (error) {
			console.warn(`[GitHistoryAnalyzer] Failed to get contributors: ${error}`)
			return []
		}
	}

	/**
	 * Get hotspots (frequently changed files)
	 */
	async getHotspots(limit: number = 20, since?: Date): Promise<Hotspot[]> {
		if (!this.git || !this._isAvailable) {
			return []
		}

		try {
			const logOptions: Record<string, any> = {
				maxCount: this.options.maxCommitsForHotspots,
				"--name-only": null,
			}

			if (since) {
				logOptions["--since"] = since.toISOString()
			}

			const log = await this.git.log(logOptions)

			// Count file changes
			const fileStats = new Map<
				string,
				{
					changeCount: number
					contributors: Set<string>
					lastModified: Date
					firstSeen: Date
				}
			>()

			for (const commit of log.all) {
				const commitDate = new Date(commit.date)
				const authorEmail = commit.author_email || "unknown"

				// Parse files from diff summary
				const files = (commit as any).diff?.files || []
				for (const file of files) {
					const filePath = file.file || file

					if (!fileStats.has(filePath)) {
						fileStats.set(filePath, {
							changeCount: 0,
							contributors: new Set(),
							lastModified: commitDate,
							firstSeen: commitDate,
						})
					}

					const stats = fileStats.get(filePath)!
					stats.changeCount++
					stats.contributors.add(authorEmail)

					if (commitDate > stats.lastModified) {
						stats.lastModified = commitDate
					}
					if (commitDate < stats.firstSeen) {
						stats.firstSeen = commitDate
					}
				}
			}

			// Also try to get file names from the log body if diff is not available
			if (fileStats.size === 0) {
				// Fallback: use git log with --name-only
				const rawLog = await this.git.raw([
					"log",
					`--max-count=${this.options.maxCommitsForHotspots}`,
					"--name-only",
					"--format=%H|%ae|%aI",
					...(since ? [`--since=${since.toISOString()}`] : []),
				])

				let currentCommit: { hash: string; email: string; date: Date } | null = null

				for (const line of rawLog.split("\n")) {
					if (line.includes("|")) {
						const [hash, email, dateStr] = line.split("|")
						currentCommit = {
							hash,
							email,
							date: new Date(dateStr),
						}
					} else if (line.trim() && currentCommit) {
						const filePath = line.trim()

						if (!fileStats.has(filePath)) {
							fileStats.set(filePath, {
								changeCount: 0,
								contributors: new Set(),
								lastModified: currentCommit.date,
								firstSeen: currentCommit.date,
							})
						}

						const stats = fileStats.get(filePath)!
						stats.changeCount++
						stats.contributors.add(currentCommit.email)

						if (currentCommit.date > stats.lastModified) {
							stats.lastModified = currentCommit.date
						}
						if (currentCommit.date < stats.firstSeen) {
							stats.firstSeen = currentCommit.date
						}
					}
				}
			}

			// Convert to Hotspot array
			const hotspots: Hotspot[] = []
			const now = new Date()

			for (const [filePath, stats] of fileStats) {
				// Calculate changes per month
				const monthsSpan = Math.max(1, (now.getTime() - stats.firstSeen.getTime()) / (1000 * 60 * 60 * 24 * 30))

				hotspots.push({
					filePath,
					changeFrequency: stats.changeCount,
					contributorCount: stats.contributors.size,
					lastModified: stats.lastModified,
					changesPerMonth: stats.changeCount / monthsSpan,
				})
			}

			// Sort by change frequency descending
			return hotspots.sort((a, b) => b.changeFrequency - a.changeFrequency).slice(0, limit)
		} catch (error) {
			console.warn(`[GitHistoryAnalyzer] Failed to get hotspots: ${error}`)
			return []
		}
	}

	/**
	 * Get recent changes across the repository
	 */
	async getRecentChanges(since?: Date, limit: number = 100): Promise<FileChange[]> {
		if (!this.git || !this._isAvailable) {
			return []
		}

		try {
			const sinceDate = since || new Date(Date.now() - this.options.recentChangesDays! * 24 * 60 * 60 * 1000)

			const log = await this.git.log({
				maxCount: limit,
				"--since": sinceDate.toISOString(),
				"--name-status": null,
			})

			const changes: FileChange[] = []

			for (const commit of log.all) {
				const commitInfo = this.parseCommit(commit)

				// Parse diff to get file changes
				const diff = (commit as any).diff
				if (diff?.files) {
					for (const file of diff.files) {
						changes.push({
							filePath: file.file,
							changeType: this.parseChangeType(file.status),
							commit: commitInfo,
							linesAdded: file.insertions,
							linesRemoved: file.deletions,
						})
					}
				}
			}

			return changes
		} catch (error) {
			console.warn(`[GitHistoryAnalyzer] Failed to get recent changes: ${error}`)
			return []
		}
	}

	/**
	 * Get the last modification date for a file
	 */
	async getLastModified(filePath: string): Promise<Date | null> {
		if (!this.git || !this._isAvailable) {
			return null
		}

		try {
			const relativePath = this.getRelativePath(filePath)
			const log = await this.git.log({
				file: relativePath,
				maxCount: 1,
			})

			if (log.all.length > 0) {
				return new Date(log.all[0].date)
			}

			return null
		} catch (error) {
			console.warn(`[GitHistoryAnalyzer] Failed to get last modified: ${error}`)
			return null
		}
	}

	/**
	 * Calculate relevance score based on recency
	 */
	async calculateRecencyScore(filePath: string, baseScore: number): Promise<number> {
		const lastModified = await this.getLastModified(filePath)

		if (!lastModified) {
			return baseScore
		}

		const now = new Date()
		const daysSinceModified = (now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24)

		// Decay function: score decreases as file gets older
		// Files modified today get full boost, files older than 30 days get no boost
		const recencyFactor = Math.max(0, 1 - daysSinceModified / 30)
		const boost = recencyFactor * this.options.recencyWeight!

		return baseScore * (1 + boost)
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	private getRelativePath(filePath: string): string {
		if (path.isAbsolute(filePath)) {
			return path.relative(this.repoPath, filePath)
		}
		return filePath
	}

	private parseLogResult(log: LogResult<DefaultLogFields>): CommitInfo[] {
		return log.all.map((commit) => this.parseCommit(commit))
	}

	private parseCommit(commit: DefaultLogFields): CommitInfo {
		return {
			hash: commit.hash,
			shortHash: commit.hash.substring(0, 7),
			author: commit.author_name || "Unknown",
			authorEmail: commit.author_email || "unknown",
			date: new Date(commit.date),
			message: commit.message || "",
			filesChanged: [],
		}
	}

	private parseChangeType(status: string): FileChange["changeType"] {
		switch (status?.toUpperCase()) {
			case "A":
				return "added"
			case "D":
				return "deleted"
			case "R":
				return "renamed"
			case "M":
			default:
				return "modified"
		}
	}
}

/**
 * Create a singleton instance
 */
let instance: GitHistoryAnalyzer | null = null

export function getGitHistoryAnalyzer(options?: Partial<GitAnalyzerOptions>): GitHistoryAnalyzer {
	if (!instance) {
		instance = new GitHistoryAnalyzer(options)
	}
	return instance
}

export function resetGitHistoryAnalyzer(): void {
	instance = null
}

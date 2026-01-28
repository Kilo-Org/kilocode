// kilocode_change - new file

/**
 * Review Service
 *
 * Lightweight service for gathering review scope information.
 * The actual review is done dynamically by the agent using tools.
 */

import type { ReviewSummary, ReviewScopeInfo, ReviewServiceOptions, FileSummary, FileStatus } from "./types"
import {
	getCurrentBranch,
	detectBaseBranch,
	hasUncommittedChanges,
	getUncommittedFiles,
	getBranchFilesChanged,
	isOnBaseBranch,
	type GitFileChange,
} from "../../utils/git"

/**
 * Converts git status code to FileStatus
 */
function gitStatusToFileStatus(status: string): FileStatus {
	const upper = status.toUpperCase()
	if (upper === "A" || upper === "?") return "A"
	if (upper === "M") return "M"
	if (upper === "D") return "D"
	if (upper === "R") return "R"
	if (upper === "C") return "C"
	if (upper === "U") return "U"
	return "M" // Default to modified
}

/**
 * Converts GitFileChange array to FileSummary array
 */
function toFileSummaries(files: GitFileChange[]): FileSummary[] {
	return files.map((file) => ({
		path: file.path,
		status: gitStatusToFileStatus(file.status),
		oldPath: file.oldPath,
	}))
}

/**
 * ReviewService - Provides review scope information for the UI
 * and lightweight summaries for the agent to start reviews
 */
export class ReviewService {
	private cwd: string

	constructor(options: ReviewServiceOptions) {
		this.cwd = options.cwd
	}

	/**
	 * Gets information about available review scopes
	 * Used by UI to show preview before user selects
	 */
	async getScopeInfo(): Promise<ReviewScopeInfo> {
		try {
			// Get current branch
			const currentBranch = (await getCurrentBranch(this.cwd)) || "HEAD"

			// Check uncommitted changes
			const hasUncommitted = await hasUncommittedChanges(this.cwd)
			const uncommittedFiles = hasUncommitted ? await getUncommittedFiles(this.cwd) : []

			// Check branch diff - available as long as not on base branch
			const onBaseBranch = await isOnBaseBranch(this.cwd)
			const baseBranch = await detectBaseBranch(this.cwd)
			const branchFiles = !onBaseBranch ? await getBranchFilesChanged(this.cwd, baseBranch) : []

			const result = {
				uncommitted: {
					available: hasUncommitted,
					fileCount: uncommittedFiles.length,
					filePreview: uncommittedFiles.slice(0, 5).map((f) => f.path),
				},
				branch: {
					available: !onBaseBranch,
					currentBranch,
					baseBranch,
					fileCount: branchFiles.length,
					filePreview: branchFiles.slice(0, 5).map((f) => f.path),
				},
			}

			return result
		} catch (error) {
			console.error("Error getting scope info:", error)
			return {
				uncommitted: {
					available: false,
					fileCount: 0,
				},
				branch: {
					available: false,
					currentBranch: "unknown",
					baseBranch: "main",
					fileCount: 0,
				},
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Gets a lightweight review summary for the selected scope
	 * This provides minimal context - the agent will explore details with tools
	 */
	async getReviewSummary(scope: "uncommitted" | "branch"): Promise<ReviewSummary> {
		try {
			const currentBranch = (await getCurrentBranch(this.cwd)) || "HEAD"

			if (scope === "uncommitted") {
				return this.getUncommittedSummary(currentBranch)
			} else {
				return this.getBranchSummary(currentBranch)
			}
		} catch (error) {
			console.error(`Error getting review summary for ${scope}:`, error)
			return {
				scope,
				currentBranch: "unknown",
				files: [],
				totalFiles: 0,
				hasChanges: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Gets summary for uncommitted changes
	 */
	private async getUncommittedSummary(currentBranch: string): Promise<ReviewSummary> {
		const gitFiles = await getUncommittedFiles(this.cwd)
		const files = toFileSummaries(gitFiles)

		return {
			scope: "uncommitted",
			currentBranch,
			files,
			totalFiles: files.length,
			hasChanges: files.length > 0,
		}
	}

	/**
	 * Gets summary for branch comparison
	 */
	private async getBranchSummary(currentBranch: string): Promise<ReviewSummary> {
		const baseBranch = await detectBaseBranch(this.cwd)
		const gitFiles = await getBranchFilesChanged(this.cwd, baseBranch)
		const files = toFileSummaries(gitFiles)

		return {
			scope: "branch",
			currentBranch,
			baseBranch,
			files,
			totalFiles: files.length,
			hasChanges: files.length > 0,
		}
	}
}

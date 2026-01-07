/**
 * Review Service for local git-based code reviews
 *
 * This service collects git context (uncommitted changes or branch diff)
 * to enable AI-powered code reviews without external integrations.
 */

import {
	isGitRepository,
	hasUncommittedChanges,
	getCurrentBranch,
	getBaseBranch,
	isBaseBranch,
	collectOutput,
} from "../code-index/managed/git-utils"

const MAX_DIFF_SIZE = 100 * 1024 // 100KB limit for diff content

export interface ReviewContext {
	scope: "uncommitted" | "branch" | "none"
	currentBranch: string
	baseBranch?: string
	diff: string
	filesSummary: string
	error?: string
}

export class ReviewService {
	constructor(private workspacePath: string) {}

	/**
	 * Determines review scope and collects diff context
	 */
	async getReviewContext(): Promise<ReviewContext> {
		// Check if in a git repository
		const isRepo = await isGitRepository(this.workspacePath)
		if (!isRepo) {
			return {
				scope: "none",
				currentBranch: "",
				diff: "",
				filesSummary: "",
				error: "Not a git repository.",
			}
		}

		const currentBranch = await getCurrentBranch(this.workspacePath)

		// Check for uncommitted changes first
		const hasChanges = await hasUncommittedChanges(this.workspacePath)
		if (hasChanges) {
			return this.getUncommittedReviewContext(currentBranch)
		}

		// No uncommitted changes - check if we're on a feature branch
		const onBaseBranch = await isBaseBranch(currentBranch, this.workspacePath)
		if (onBaseBranch) {
			return {
				scope: "none",
				currentBranch,
				diff: "",
				filesSummary: "",
				error: "You're on the base branch with no uncommitted changes.",
			}
		}

		// On feature branch - get diff against base branch
		return this.getBranchReviewContext(currentBranch)
	}

	/**
	 * Gets review context for uncommitted changes (staged + unstaged)
	 */
	private async getUncommittedReviewContext(currentBranch: string): Promise<ReviewContext> {
		try {
			// Get the full diff of uncommitted changes
			const diff = await this.getUncommittedDiff()
			const filesSummary = await this.getUncommittedFilesSummary()

			return {
				scope: "uncommitted",
				currentBranch,
				diff: this.truncateDiff(diff),
				filesSummary,
			}
		} catch (error) {
			return {
				scope: "none",
				currentBranch,
				diff: "",
				filesSummary: "",
				error: `Failed to get uncommitted changes: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Gets review context for feature branch vs base branch
	 */
	private async getBranchReviewContext(currentBranch: string): Promise<ReviewContext> {
		try {
			const baseBranch = await getBaseBranch(this.workspacePath)

			// Get merge base
			const mergeBase = await collectOutput(
				`git merge-base ${baseBranch} ${currentBranch}`,
				this.workspacePath,
				"getting merge base",
			)

			// Get the full diff content
			const diff = await collectOutput(
				`git diff ${mergeBase.trim()}..${currentBranch}`,
				this.workspacePath,
				"getting branch diff",
			)

			// Get files summary
			const filesSummary = await this.getBranchFilesSummary(mergeBase.trim(), currentBranch)

			return {
				scope: "branch",
				currentBranch,
				baseBranch,
				diff: this.truncateDiff(diff),
				filesSummary,
			}
		} catch (error) {
			return {
				scope: "none",
				currentBranch,
				diff: "",
				filesSummary: "",
				error: `Failed to get branch diff: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Gets uncommitted diff (staged + unstaged changes)
	 */
	private async getUncommittedDiff(): Promise<string> {
		// Get both staged and unstaged changes
		// Using HEAD to compare against the last commit
		return collectOutput("git diff HEAD", this.workspacePath, "getting uncommitted diff")
	}

	/**
	 * Gets summary of uncommitted files with their status
	 */
	private async getUncommittedFilesSummary(): Promise<string> {
		const status = await collectOutput("git status --porcelain", this.workspacePath, "getting file status")

		const lines = status.split("\n").filter((line) => line.trim())
		const added: string[] = []
		const modified: string[] = []
		const deleted: string[] = []
		const untracked: string[] = []

		for (const line of lines) {
			const statusCode = line.substring(0, 2)
			const filePath = line.substring(3)

			// Check both index (first char) and working tree (second char) status
			if (statusCode.includes("A")) {
				added.push(filePath)
			} else if (statusCode.includes("M")) {
				modified.push(filePath)
			} else if (statusCode.includes("D")) {
				deleted.push(filePath)
			} else if (statusCode.startsWith("?")) {
				untracked.push(filePath)
			}
		}

		return this.formatFilesSummary({ added, modified, deleted, untracked })
	}

	/**
	 * Gets summary of files changed between branches
	 */
	private async getBranchFilesSummary(mergeBase: string, currentBranch: string): Promise<string> {
		const nameStatus = await collectOutput(
			`git diff --name-status ${mergeBase}..${currentBranch}`,
			this.workspacePath,
			"getting branch files summary",
		)

		const lines = nameStatus.split("\n").filter((line) => line.trim())
		const added: string[] = []
		const modified: string[] = []
		const deleted: string[] = []

		for (const line of lines) {
			const parts = line.split("\t")
			if (parts.length < 2) continue

			const status = parts[0]
			const filePath = parts.slice(1).join("\t")

			switch (status[0]) {
				case "A":
					added.push(filePath)
					break
				case "M":
					modified.push(filePath)
					break
				case "D":
					deleted.push(filePath)
					break
				case "R":
					if (parts.length >= 3) {
						deleted.push(parts[1])
						added.push(parts[2])
					}
					break
			}
		}

		return this.formatFilesSummary({ added, modified, deleted })
	}

	/**
	 * Formats the files summary for display
	 */
	private formatFilesSummary(files: {
		added: string[]
		modified: string[]
		deleted: string[]
		untracked?: string[]
	}): string {
		const sections: string[] = []

		if (files.added.length > 0) {
			sections.push(`**Added (${files.added.length}):**\n${files.added.map((f) => `  + ${f}`).join("\n")}`)
		}
		if (files.modified.length > 0) {
			sections.push(`**Modified (${files.modified.length}):**\n${files.modified.map((f) => `  ~ ${f}`).join("\n")}`)
		}
		if (files.deleted.length > 0) {
			sections.push(`**Deleted (${files.deleted.length}):**\n${files.deleted.map((f) => `  - ${f}`).join("\n")}`)
		}
		if (files.untracked && files.untracked.length > 0) {
			sections.push(
				`**Untracked (${files.untracked.length}):**\n${files.untracked.map((f) => `  ? ${f}`).join("\n")}`,
			)
		}

		const total =
			files.added.length + files.modified.length + files.deleted.length + (files.untracked?.length || 0)
		return `**Total files changed: ${total}**\n\n${sections.join("\n\n")}`
	}

	/**
	 * Truncates diff if it exceeds the maximum size
	 */
	private truncateDiff(diff: string): string {
		if (diff.length <= MAX_DIFF_SIZE) {
			return diff
		}

		const truncated = diff.substring(0, MAX_DIFF_SIZE)
		const lastNewline = truncated.lastIndexOf("\n")
		const cleanTruncate = lastNewline > 0 ? truncated.substring(0, lastNewline) : truncated

		return (
			cleanTruncate +
			`\n\n... [Diff truncated - showing first ${Math.round(MAX_DIFF_SIZE / 1024)}KB of ${Math.round(diff.length / 1024)}KB]`
		)
	}
}

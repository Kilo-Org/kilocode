// kilocode_change - new file
import * as vscode from "vscode"
import * as path from "path"
import { spawnSync } from "child_process"
import { shouldExcludeLockFile } from "./exclusionUtils"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import { GitProgressOptions, GitChange, GitOptions, GitStatus } from "./types"

// Re-export types for backward compatibility
export type { GitChange, GitOptions, GitProgressOptions } from "./types"

/**
 * Utility class for Git operations using direct shell commands
 */
export class GitExtensionService {
	private ignoreController: RooIgnoreController | null = null

	constructor(private workspaceRoot: string) {
		this.ignoreController = new RooIgnoreController(workspaceRoot)
		this.ignoreController.initialize()
	}

	/**
	 * Gathers information about changes (staged or unstaged)
	 */
	public async gatherChanges(options: GitProgressOptions): Promise<GitChange[]> {
		try {
			const statusOutput = this.getStatus(options)
			if (!statusOutput.trim()) {
				return []
			}

			const changes: GitChange[] = []
			const lines = statusOutput.split("\n").filter((line: string) => line.trim())
			for (const line of lines) {
				if (line.length < 2) continue

				let statusCode: string
				let filePath: string

				if (options.staged) {
					// git diff --name-status --cached format: "M\tfile.txt"
					statusCode = line.substring(0, 1).trim()
					filePath = line.substring(1).trim()
				} else {
					// git status --porcelain format: "?? file.txt" or " M file.txt"
					statusCode = line.substring(0, 2).trim()
					filePath = line.substring(2).trim()

					// Handle porcelain format status codes
					if (statusCode === "??") {
						statusCode = "?" // Untracked
					} else if (statusCode.includes("M")) {
						statusCode = "M" // Modified
					} else if (statusCode.includes("A")) {
						statusCode = "A" // Added
					} else if (statusCode.includes("D")) {
						statusCode = "D" // Deleted
					} else {
						statusCode = statusCode.charAt(1) || statusCode.charAt(0) // Take the working tree status
					}
				}

				changes.push({
					filePath: path.join(this.workspaceRoot, filePath),
					status: this.getChangeStatusFromCode(statusCode),
					staged: options.staged,
				})
			}

			return changes
		} catch (error) {
			const changeType = options.staged ? "staged" : "unstaged"
			console.error(`Error gathering ${changeType} changes:`, error)
			return []
		}
	}

	/**
	 * Runs a git command with arguments and returns the output
	 * @param args The git command arguments as an array
	 * @returns The command output as a string
	 */
	public spawnGitWithArgs(args: string[]): string {
		const result = spawnSync("git", args, {
			cwd: this.workspaceRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		})

		if (result.error) {
			throw result.error
		}

		if (result.status !== 0) {
			throw new Error(`Git command failed with status ${result.status}: ${result.stderr}`)
		}

		return result.stdout
	}

	/**
	 * Gets diffs for specific file paths or discovers all changed files if none specified
	 */
	private async getDiffForChanges(changes: GitChange[], options: GitProgressOptions): Promise<string> {
		const { onProgress } = options || {}
		if (changes.length === 0) {
			return ""
		}

		try {
			const diffs: string[] = []
			let processedFiles = 0

			for (const change of changes) {
				const absolutePath = change.filePath
				const relativePath = path.relative(this.workspaceRoot, absolutePath)
				console.log(
					`🔧 GitExtensionService.getDiffForChanges: Processing file ${processedFiles + 1}/${changes.length}: ${relativePath}`,
				)

				let isValidFile = true
				if (this.ignoreController) {
					try {
						isValidFile = this.ignoreController.validateAccess(relativePath)
					} catch (error) {
						console.warn(`🔧 Error validating file access for ${relativePath}, allowing access:`, error)
						isValidFile = true
					}
				}

				if (isValidFile && !shouldExcludeLockFile(relativePath)) {
					console.log(`🔧 GitExtensionService.getDiffForChanges: Getting diff for ${relativePath}...`)
					const stagedFlag = change.staged ?? options.staged ?? true
					const diffStartTime = Date.now()
					const diff = this.getGitDiff(absolutePath, { staged: stagedFlag }).trim()
					const diffEndTime = Date.now()
					console.log(
						`🔧 GitExtensionService.getDiffForChanges: Diff for ${relativePath} completed in ${diffEndTime - diffStartTime}ms, length: ${diff.length}`,
					)

					if (diff) {
						diffs.push(diff)
					} else {
						console.warn("🔧 No diff generated for file:", relativePath)
					}
				} else {
					console.log("🔧 Skipping file (validation/exclusion):", relativePath)
				}

				processedFiles++
				if (onProgress) {
					const percentage = (processedFiles / changes.length) * 100
					onProgress(percentage)
				}
			}

			console.log("🔧 Total diffs generated:", diffs.length, "total length:", diffs.join("\n").length)
			return diffs.join("\n")
		} catch (error) {
			console.error("🔧 Error generating diff for changes:", error)
			return ""
		}
	}

	private getStatus(options: GitOptions): string {
		const { staged } = options
		if (staged) {
			// For staged files, use diff --cached to get only staged changes
			return this.spawnGitWithArgs(["diff", "--name-status", "--cached"])
		} else {
			// For unstaged files, use status --porcelain to get both modified tracked and untracked files
			return this.spawnGitWithArgs(["status", "--porcelain"])
		}
	}

	private getGitDiff(filePath: string, options: GitOptions): string {
		const { staged } = options

		try {
			// First check if file is binary to avoid hanging on large binary diffs
			const checkArgs = staged
				? ["diff", "--cached", "--numstat", "--", filePath]
				: ["diff", "--numstat", "--", filePath]

			const numstatOutput = this.spawnGitWithArgs(checkArgs)

			// If numstat shows "-	-" it's a binary file
			if (numstatOutput.includes("-\t-\t")) {
				return `Binary file ${filePath} has been ${staged ? "staged" : "modified"}`
			}

			// For untracked files, we can't get a diff
			if (!staged) {
				const statusArgs = ["status", "--porcelain", "--", filePath]
				const statusOutput = this.spawnGitWithArgs(statusArgs)
				if (statusOutput.startsWith("??")) {
					return `New untracked file: ${filePath}`
				}
			}

			// Get actual diff for text files
			const diffArgs = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath]
			return this.spawnGitWithArgs(diffArgs)
		} catch (error) {
			console.warn(`🔧 Error getting diff for ${filePath}:`, error)
			return `File ${filePath} - diff unavailable`
		}
	}

	private getCurrentBranch(): string {
		return this.spawnGitWithArgs(["branch", "--show-current"])
	}

	private getRecentCommits(count: number = 5): string {
		return this.spawnGitWithArgs(["log", "--oneline", `-${count}`])
	}

	/**
	 * Gets all context needed for commit message generation
	 * Can optionally focus on specific files if provided
	 */
	public async getCommitContext(
		changes: GitChange[],
		options: GitProgressOptions,
		specificFiles?: string[],
	): Promise<string> {
		const { staged, includeRepoContext = true } = options
		console.log(
			"🔧 GitExtensionService getCommitContext called with changes:",
			changes.length,
			"specificFiles:",
			specificFiles?.length || 0,
		)

		try {
			// Start building the context with the required sections
			let context = "## Git Context for Commit Message Generation\n\n"

			// Determine which changes to include in diff generation
			const targetChanges =
				specificFiles && specificFiles.length > 0
					? changes.filter((change) => {
							const absolutePath = change.filePath
							const relativePath = path.relative(this.workspaceRoot, absolutePath)
							return specificFiles.some(
								(file) =>
									file === absolutePath ||
									file === relativePath ||
									absolutePath.endsWith(file) ||
									relativePath === path.normalize(file),
							)
						})
					: changes

			// Add full diff - essential for understanding what changed
			try {
				const diff = await this.getDiffForChanges(targetChanges, options)
				const fileInfo = specificFiles ? ` (${specificFiles.length} selected files)` : ""
				const allStaged = targetChanges.every((change) => change.staged)
				const allUnstaged = targetChanges.every((change) => !change.staged)
				const changeDescriptor = allStaged ? "Staged" : allUnstaged ? "Unstaged" : "Selected"
				context += `### Full Diff of ${changeDescriptor} Changes${fileInfo}\n\`\`\`diff\n` + diff + "\n```\n\n"
				console.log("🔧 Generated diff context length:", diff.length)
			} catch (error) {
				const changeType = staged ? "Staged" : "Unstaged"
				const fileInfo = specificFiles ? ` (${specificFiles.length} selected files)` : ""
				context += `### Full Diff of ${changeType} Changes${fileInfo}\n\`\`\`diff\n(No diff available)\n\`\`\`\n\n`
				console.error("🔧 Error generating diff context:", error)
			}

			// Add change summary derived from provided changes
			if (targetChanges.length > 0) {
				const summaryLines = targetChanges.map((change) => {
					const relativePath = path.relative(this.workspaceRoot, change.filePath)
					const scope = change.staged ? "staged" : "unstaged"
					return `${this.getReadableStatus(change.status)} (${scope}): ${relativePath}`
				})

				context += "### Change Summary\n```\n" + summaryLines.join("\n") + "\n```\n\n"
			} else {
				context += "### Change Summary\n```\n(No changes matched selection)\n```\n\n"
			}

			if (includeRepoContext) {
				// Add contextual information
				context += "### Repository Context\n\n"

				// Show current branch
				try {
					const currentBranch = this.getCurrentBranch()
					if (currentBranch) {
						context += "**Current branch:** `" + currentBranch.trim() + "`\n\n"
					}
				} catch (error) {
					// Skip if not available
				}

				// Show recent commits for context
				try {
					const recentCommits = this.getRecentCommits()
					if (recentCommits) {
						context += "**Recent commits:**\n```\n" + recentCommits + "\n```\n"
					}
				} catch (error) {
					// Skip if not available
				}
			}

			console.log("🔧 Final git context length:", context.length)
			return context
		} catch (error) {
			console.error("🔧 Error generating commit context:", error)
			return "## Error generating commit context\n\nUnable to gather complete context for commit message generation."
		}
	}

	/**
	 * Validates and returns the raw Git status code
	 */
	private getChangeStatusFromCode(code: string): GitStatus {
		switch (code) {
			case "M":
			case "A":
			case "D":
			case "R":
			case "C":
			case "U":
			case "?":
				return code as GitStatus
			default:
				return "Unknown"
		}
	}

	/**
	 * Converts Git status code to readable text for display
	 */
	private getReadableStatus(status: GitStatus): string {
		switch (status) {
			case "M":
				return "Modified"
			case "A":
				return "Added"
			case "D":
				return "Deleted"
			case "R":
				return "Renamed"
			case "C":
				return "Copied"
			case "U":
				return "Updated"
			case "?":
				return "Untracked"
			case "Unknown":
			default:
				return "Unknown"
		}
	}

	public dispose() {
		this.ignoreController?.dispose()
	}
}

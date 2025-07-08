// kilocode_change - new file
import * as vscode from "vscode"
import * as path from "path"
import { spawnSync } from "child_process"
import { shouldExcludeLockFile } from "./exclusionUtils"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"

export interface GitChange {
	filePath: string
	status: string
}

export interface GitOptions {
	staged: boolean
}

/**
 * Utility class for Git operations using direct shell commands
 */
export class GitExtensionService {
	private workspaceRoot: string
	private ignoreController: RooIgnoreController

	constructor() {
		this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()

		this.ignoreController = new RooIgnoreController(this.workspaceRoot)
		this.ignoreController.initialize()
	}

	/**
	 * Initialize the service by checking if git is available
	 */
	public async initialize(): Promise<boolean> {
		try {
			// Check if git is available and we're in a git repository
			this.spawnGitWithArgs(["rev-parse", "--is-inside-work-tree"])
			return true
		} catch (error) {
			console.error("Git initialization failed:", error)
			return false
		}
	}

	/**
	 * Gathers information about changes (staged or unstaged)
	 */
	public async gatherChanges(options: GitOptions): Promise<GitChange[]> {
		try {
			const statusOutput = this.getStatus(options)
			if (!statusOutput.trim()) {
				return []
			}

			const changes: GitChange[] = []
			const lines = statusOutput.split("\n").filter((line: string) => line.trim())

			for (const line of lines) {
				if (line.length < 2) continue

				const statusCode = line.substring(0, 1).trim()
				const filePath = line.substring(1).trim()

				changes.push({
					filePath: path.join(this.workspaceRoot, filePath),
					status: this.getChangeStatusFromCode(statusCode),
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
	 * Sets the commit message in the Git input box
	 */
	public setCommitMessage(message: string): void {
		try {
			// Try to use the VS Code Git Extension API to set the commit message directly
			const gitExtension = vscode.extensions.getExtension("vscode.git")
			if (gitExtension && gitExtension.isActive) {
				const gitApi = gitExtension.exports.getAPI(1)
				if (gitApi?.repositories?.length > 0) {
					const repo = gitApi.repositories[0]
					repo.inputBox.value = message
					return
				}
			}

			// Fallback to clipboard if VS Code Git Extension API is not available
			this.copyToClipboardFallback(message)
		} catch (error) {
			console.error("Error setting commit message:", error)
			this.copyToClipboardFallback(message)
		}
	}

	/**
	 * Runs a git command with arguments and returns the output
	 * @param args The git command arguments as an array
	 * @returns The command output as a string
	 */
	public spawnGitWithArgs(args: string[]): string {
		try {
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
		} catch (error) {
			console.error(`Error executing git command: git ${args.join(" ")}`, error)
			throw error
		}
	}

	private getDiffForChanges(options: GitOptions): string {
		const { staged } = options
		try {
			const diffs: string[] = []
			const args = staged ? ["diff", "--name-only", "--cached"] : ["diff", "--name-only"]
			const files = this.spawnGitWithArgs(args)
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0)

			for (const filePath of files) {
				if (this.ignoreController.validateAccess(filePath) && !shouldExcludeLockFile(filePath)) {
					const diff = this.getGitDiff(filePath, { staged }).trim()
					diffs.push(diff)
				}
			}

			return diffs.join("\n")
		} catch (error) {
			const changeType = staged ? "staged" : "unstaged"
			console.error(`Error generating ${changeType} diff:`, error)
			return ""
		}
	}

	private getStatus(options: GitOptions): string {
		const { staged } = options
		const args = staged ? ["diff", "--name-status", "--cached"] : ["diff", "--name-status"]
		return this.spawnGitWithArgs(args)
	}

	private getSummary(options: GitOptions): string {
		const { staged } = options
		const args = staged ? ["diff", "--cached", "--stat"] : ["diff", "--stat"]
		return this.spawnGitWithArgs(args)
	}

	private getGitDiff(filePath: string, options: GitOptions): string {
		const { staged } = options
		const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath]
		return this.spawnGitWithArgs(args)
	}

	private getCurrentBranch(): string {
		return this.spawnGitWithArgs(["branch", "--show-current"])
	}

	private getRecentCommits(count: number = 5): string {
		return this.spawnGitWithArgs(["log", "--oneline", `-${count}`])
	}

	/**
	 * Gets all context needed for commit message generation
	 */
	public getCommitContext(changes: GitChange[], options: GitOptions): string {
		const { staged } = options
		try {
			// Start building the context with the required sections
			let context = "## Git Context for Commit Message Generation\n\n"

			// Add full diff - essential for understanding what changed
			try {
				const diff = this.getDiffForChanges(options)
				const changeType = staged ? "Staged" : "Unstaged"
				context += `### Full Diff of ${changeType} Changes\n\`\`\`diff\n` + diff + "\n```\n\n"
			} catch (error) {
				const changeType = staged ? "Staged" : "Unstaged"
				context += `### Full Diff of ${changeType} Changes\n\`\`\`diff\n(No diff available)\n\`\`\`\n\n`
			}

			// Add statistical summary - helpful for quick overview
			try {
				const summary = this.getSummary(options)
				context += "### Statistical Summary\n```\n" + summary + "\n```\n\n"
			} catch (error) {
				context += "### Statistical Summary\n```\n(No summary available)\n```\n\n"
			}

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

			return context
		} catch (error) {
			console.error("Error generating commit context:", error)
			return "## Error generating commit context\n\nUnable to gather complete context for commit message generation."
		}
	}

	/**
	 * Fallback method to copy commit message to clipboard
	 * @private Helper method for setCommitMessage
	 */
	private copyToClipboardFallback(message: string): void {
		try {
			vscode.env.clipboard.writeText(message)
			vscode.window.showInformationMessage(
				"Commit message copied to clipboard. Paste it into the commit message field.",
			)
		} catch (clipboardError) {
			console.error("Error copying to clipboard:", clipboardError)
			throw new Error("Failed to set commit message")
		}
	}

	/**
	 * Converts Git status code to readable text
	 */
	private getChangeStatusFromCode(code: string): string {
		switch (code) {
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
			default:
				return "Unknown"
		}
	}

	public dispose() {
		this.ignoreController.dispose()
	}
}

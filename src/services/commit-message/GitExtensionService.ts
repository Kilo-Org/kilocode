import * as vscode from "vscode"
import * as path from "path"
import { spawnSync } from "child_process"
import { shouldExcludeLockFile } from "./exclusionUtils"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"

export interface GitChange {
	filePath: string
	status: string
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
	 * Gathers information about staged changes using git diff --cached
	 */
	public async gatherStagedChanges(): Promise<GitChange[] | null> {
		try {
			const statusOutput = await this.getStagedStatus()
			if (!statusOutput.trim()) {
				return null
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

			return changes.length > 0 ? changes : null
		} catch (error) {
			console.error("Error gathering staged changes:", error)
			return null
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

	/**
	 * Gets the diff of staged changes, automatically excluding files based on shouldExcludeFromGitDiff
	 */
	private getStagedDiff(): string {
		try {
			const diffs: string[] = []
			const stagedFiles = this.getStagedFilesList()

			for (const filePath of stagedFiles) {
				if (this.ignoreController.validateAccess(filePath) && !shouldExcludeLockFile(filePath)) {
					const diff = this.getStagedDiffForFile(filePath).trim()
					diffs.push(diff)
				}
			}

			return diffs.join("\n")
		} catch (error) {
			console.error("Error generating staged diff:", error)
			return ""
		}
	}

	private getStagedFilesList(): string[] {
		return this.spawnGitWithArgs(["diff", "--name-only", "--cached"])
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
	}

	private getStagedDiffForFile(filePath: string): string {
		return this.spawnGitWithArgs(["diff", "--cached", "--", filePath])
	}

	private getStagedStatus(): string {
		return this.spawnGitWithArgs(["diff", "--name-status", "--cached"])
	}

	private getStagedSummary(): string {
		return this.spawnGitWithArgs(["diff", "--cached", "--stat"])
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
	public getCommitContext(changes: GitChange[]): string {
		try {
			// Start building the context with the required sections
			let context = "## Git Context for Commit Message Generation\n\n"

			// Add full diff - essential for understanding what changed
			try {
				const stagedDiff = this.getStagedDiff()
				context += "### Full Diff of Staged Changes\n```diff\n" + stagedDiff + "\n```\n\n"
			} catch (error) {
				context += "### Full Diff of Staged Changes\n```diff\n(No diff available)\n```\n\n"
			}

			// Add statistical summary - helpful for quick overview
			try {
				const stagedSummary = this.getStagedSummary()
				context += "### Statistical Summary\n```\n" + stagedSummary + "\n```\n\n"
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

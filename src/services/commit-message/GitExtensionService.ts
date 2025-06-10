import * as vscode from "vscode"
import * as path from "path"
import { execSync } from "child_process"

export interface GitChange {
	filePath: string
	status: string
}

/**
 * Utility class for Git operations using direct shell commands
 */
export class GitExtensionService {
	private workspaceRoot: string | undefined

	constructor() {
		this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	}

	/**
	 * Initialize the service by checking if git is available
	 */
	public async initialize(): Promise<boolean> {
		try {
			if (!this.workspaceRoot) {
				return false
			}

			// Check if git is available and we're in a git repository
			this.executeGitCommand("git rev-parse --is-inside-work-tree")
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
					filePath: path.join(this.workspaceRoot || "", filePath),
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
	 * Executes a git command and returns the output
	 * @param command The git command to execute
	 * @returns The command output as a string
	 */
	public executeGitCommand(command: string): string {
		try {
			if (!this.workspaceRoot) {
				throw new Error("No workspace folder found")
			}
			return execSync(command, { cwd: this.workspaceRoot, encoding: "utf8" })
		} catch (error) {
			console.error(`Error executing git command: ${command}`, error)
			throw error
		}
	}

	/**
	 * Gets the diff of staged changes
	 * @private Internal helper method
	 */
	private getStagedDiff(): string {
		return this.executeGitCommand("git diff --cached")
	}

	/**
	 * Gets only the staged files using git diff --cached
	 * @private Internal helper method
	 */
	private getStagedStatus(): string {
		return this.executeGitCommand("git diff --name-status --cached")
	}

	/**
	 * Gets a summary of staged changes
	 * @private Internal helper method
	 */
	private getStagedSummary(): string {
		return this.executeGitCommand("git diff --cached --stat")
	}

	/**
	 * Gets extended context for complex changes
	 * @private Internal helper method
	 */
	private getExtendedDiff(): string {
		return this.executeGitCommand("git diff --cached --unified=5")
	}

	/**
	 * Gets the current branch name
	 * @private Internal helper method
	 */
	private getCurrentBranch(): string {
		return this.executeGitCommand("git branch --show-current")
	}

	/**
	 * Gets recent commits for context
	 * @private Internal helper method
	 */
	private getRecentCommits(count: number = 5): string {
		return this.executeGitCommand(`git log --oneline -${count}`)
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
}

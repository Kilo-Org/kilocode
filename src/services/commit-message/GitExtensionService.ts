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
	 * Gathers information about staged changes using git status
	 */
	public async gatherStagedChanges(): Promise<GitChange[] | null> {
		try {
			const statusOutput = await this.getStagedStatus()
			if (!statusOutput.trim()) {
				return null
			}

			const changes: GitChange[] = []
			const lines = statusOutput.split("\n").filter((line) => line.trim())

			for (const line of lines) {
				if (line.length < 3) continue

				const statusCode = line.substring(0, 2).trim()
				const filePath = line.substring(3).trim()

				// Only include staged changes (those in the index)
				if (statusCode[0] !== "?" && statusCode[0] !== " ") {
					changes.push({
						filePath: path.join(this.workspaceRoot || "", filePath),
						status: this.getChangeStatusFromCode(statusCode[0]),
					})
				}
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
				if (gitApi && gitApi.repositories && gitApi.repositories.length > 0) {
					const repo = gitApi.repositories[0]
					repo.inputBox.value = message
					vscode.window.showInformationMessage("✨ Commit message set in Git input box!")
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

	public getStagedDiff(): string {
		return this.executeGitCommand("git diff --staged")
	}

	public getStagedStatus(): string {
		return this.executeGitCommand("git status --porcelain")
	}

	public getStagedSummary(): string {
		return this.executeGitCommand("git diff --staged --stat")
	}

	public getExtendedDiff(): string {
		return this.executeGitCommand("git diff --staged --unified=5")
	}

	public getCurrentBranch(): string {
		return this.executeGitCommand("git branch --show-current")
	}

	public getRecentCommits(count: number = 5): string {
		return this.executeGitCommand(`git log --oneline -${count}`)
	}

	/**
	 * Gets all context needed for commit message generation
	 */
	public getCommitContext(changes: GitChange[]): string {
		try {
			// Start building the context with the required sections
			let context = "## Input Context Commands\n\n"

			// Add staged changes with diff
			try {
				const stagedDiff = this.getStagedDiff()
				context += "### Staged changes with context\n```diff\n" + stagedDiff + "\n```\n\n"
			} catch (error) {
				context += "### Staged changes with context\n```diff\n(No diff available)\n```\n\n"
			}

			// Add staged file names and status
			try {
				const stagedStatus = this.getStagedStatus()
				context += "### Staged file names and status\n```\n" + stagedStatus + "\n```\n\n"
			} catch (error) {
				context += "### Staged file names and status\n```\n(No status available)\n```\n\n"
			}

			// Add summary of staged changes
			try {
				const stagedSummary = this.getStagedSummary()
				context += "### Summary of staged changes\n```\n" + stagedSummary + "\n```\n\n"
			} catch (error) {
				context += "### Summary of staged changes\n```\n(No summary available)\n```\n\n"
			}

			// Add additional context if available
			context += "### Additional Context\n\n"

			// Show current branch
			try {
				const currentBranch = this.getCurrentBranch()
				if (currentBranch) {
					context += "#### Current branch\n```\n" + currentBranch + "\n```\n\n"
				}
			} catch (error) {
				// Skip if not available
			}

			// Show recent commits for context
			try {
				const recentCommits = this.getRecentCommits()
				if (recentCommits) {
					context += "#### Recent commits for context\n```\n" + recentCommits + "\n```\n\n"
				}
			} catch (error) {
				// Skip if not available
			}

			// Add a summary of the changes by file type
			if (changes && changes.length > 0) {
				const changesByType = changes.reduce(
					(acc, change) => {
						if (!acc[change.status]) {
							acc[change.status] = []
						}
						acc[change.status].push(change.filePath)
						return acc
					},
					{} as Record<string, string[]>,
				)

				context += "## Staged Changes Summary\n\n"
				for (const [status, files] of Object.entries(changesByType)) {
					context += `\n### ${status} files:\n`
					files.forEach((file) => {
						context += `- ${file}\n`
					})
				}
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

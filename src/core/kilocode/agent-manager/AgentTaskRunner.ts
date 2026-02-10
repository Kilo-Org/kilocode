/**
 * AgentTaskRunner - Sends instructions to agents and waits for completion
 *
 * Provides a reusable pattern for agent-driven tasks like:
 * - Generating commit messages and committing
 * - Creating pull requests
 * - Running custom workflows
 */

import * as vscode from "vscode"
import simpleGit from "simple-git"

export interface AgentTask {
	/** Human-readable name for logging */
	name: string
	/** Instruction to send to the agent */
	instruction: string
	/** Check if the task completed successfully */
	checkComplete: () => Promise<boolean>
	/** Timeout in milliseconds */
	timeoutMs: number
	/** Optional fallback if agent doesn't complete in time */
	fallback?: () => Promise<void>
}

export interface AgentTaskResult {
	success: boolean
	completedByAgent: boolean
	error?: string
}

const DEFAULT_POLL_INTERVAL_MS = 1000

export class AgentTaskRunner {
	constructor(
		private readonly outputChannel: vscode.OutputChannel,
		private readonly sendMessage: (sessionId: string, message: string) => Promise<void>,
	) {}

	/**
	 * Execute a task by sending instruction to agent and waiting for completion
	 */
	async executeTask(sessionId: string, task: AgentTask): Promise<AgentTaskResult> {
		this.log(`Starting task: ${task.name}`)

		try {
			// Send instruction to agent
			await this.sendMessage(sessionId, task.instruction)
			this.log(`Sent instruction to agent`)

			// Poll for completion
			const completed = await this.pollForCompletion(task.checkComplete, task.timeoutMs)

			if (completed) {
				this.log(`Task completed by agent: ${task.name}`)
				return { success: true, completedByAgent: true }
			}

			// Agent didn't complete in time
			if (task.fallback) {
				this.log(`Agent timed out, running fallback for: ${task.name}`)
				await task.fallback()
				return { success: true, completedByAgent: false }
			}

			this.log(`Agent timed out, no fallback for: ${task.name}`)
			return { success: false, completedByAgent: false, error: "Agent timed out" }
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.log(`Task failed: ${task.name} - ${errorMsg}`)
			return { success: false, completedByAgent: false, error: errorMsg }
		}
	}

	private async pollForCompletion(checkComplete: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
		const startTime = Date.now()

		while (Date.now() - startTime < timeoutMs) {
			const complete = await checkComplete()
			if (complete) {
				return true
			}
			await this.sleep(DEFAULT_POLL_INTERVAL_MS)
		}

		return false
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	private log(message: string): void {
		this.outputChannel.appendLine(`[AgentTaskRunner] ${message}`)
	}
}

/**
 * Pre-built task definitions for common operations
 */
export const AgentTasks = {
	/**
	 * Create a commit task that asks the agent to generate a proper commit message
	 */
	createCommitTask(worktreePath: string, fallbackMessage: string): AgentTask {
		const git = simpleGit(worktreePath)

		return {
			name: "commit-changes",
			instruction: `Inspect the git diff and commit all staged changes with a proper conventional commit message (e.g., 'feat:', 'fix:', 'chore:', etc.). Use execute_command to run 'git diff --staged', then commit with an appropriate message using 'git commit -m "your-message"'.`,
			timeoutMs: 60_000,
			checkComplete: async () => {
				try {
					const stagedDiff = await git.diff(["--staged"])
					// If no staged changes, commit was successful
					return !stagedDiff.trim()
				} catch {
					return false
				}
			},
			fallback: async () => {
				await git.commit(fallbackMessage)
			},
		}
	},

	/**
	 * Create a PR task that asks the agent to create a pull request
	 * (placeholder for future implementation)
	 */
	createPullRequestTask(worktreePath: string, baseBranch: string): AgentTask {
		return {
			name: "create-pull-request",
			instruction: `Create a pull request from the current branch to ${baseBranch}. First, push the current branch to origin if not already pushed. Then use the GitHub CLI (gh) or API to create a PR with an appropriate title and description based on the commits.`,
			timeoutMs: 60_000,
			checkComplete: async () => {
				// TODO: Check if PR was created via gh pr list or API
				return false
			},
		}
	},
}

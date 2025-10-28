import { getGitInfo } from "../utils/git.js"
import { determineParallelBranch } from "./determineBranch.js"
import { logs } from "../services/logs.js"
import type { CLI } from "../cli.js"
import { execSync } from "child_process"

export type Input = {
	cwd: string
	prompt: string
	timeout?: number
	existingBranch?: string
}

/**
 * Start parallel mode by creating a git worktree and spawning CLI in auto mode
 */
export async function startParallelMode({ cwd, prompt, existingBranch }: Input) {
	const { branch: cwdBranch } = await getGitInfo(cwd)

	// Determine branch and worktree path
	const { worktreeBranch, worktreePath } = await determineParallelBranch({
		cwd,
		prompt,
		...(existingBranch && { existingBranch }),
	})

	return {
		cwdBranch,
		worktreeBranch,
		worktreePath,
	}
}

/**
 * Finish parallel mode by having the extension agent generate a commit message and committing changes,
 * then cleaning up the git worktree
 * This function should be called from the CLI dispose method when in parallel mode
 */
export async function finishParallelMode(cli: CLI, worktreePath?: string) {
	const cwd = process.cwd()

	logs.info("Starting parallel mode cleanup...", "ParallelMode")

	// 1. Get the git diff and have the extension agent generate a commit message
	try {
		// Check if there are any changes to commit
		const statusOutput = execSync("git status --porcelain", {
			cwd,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		})

		if (statusOutput.trim()) {
			logs.info("Staging all changes...", "ParallelMode")

			// Stage all changes first
			execSync("git add -A", { cwd, stdio: "inherit" })

			// Get the staged diff
			const diff = execSync("git diff --staged", {
				cwd,
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
			})

			if (!diff.trim()) {
				logs.warn("No staged changes found after git add", "ParallelMode")
			} else {
				// Request the extension agent to inspect the diff and commit with a proper message
				const service = cli.getService()

				if (!service) {
					logs.error("Extension service not available, using fallback commit", "ParallelMode")

					const fallbackMessage = "chore: parallel mode task completion"

					execSync(`git commit -m "${fallbackMessage}"`, { cwd, stdio: "inherit" })

					logs.info("Changes committed with fallback message", "ParallelMode")
				} else {
					logs.info("Instructing extension agent to inspect diff and commit changes...", "ParallelMode")

					// Send a task to the extension agent to inspect the diff and commit
					await service.sendWebviewMessage({
						type: "askResponse",
						askResponse:
							"Inspect the git diff and commit all staged changes with a proper conventional commit message (e.g., 'feat:', 'fix:', 'chore:', etc.). Use execute_command to run 'git diff --staged', then commit with an appropriate message using 'git commit -m \"your-message\"'.",
						text: "Inspect the git diff and commit all staged changes with a proper conventional commit message (e.g., 'feat:', 'fix:', 'chore:', etc.). Use execute_command to run 'git diff --staged', then commit with an appropriate message using 'git commit -m \"your-message\"'.",
					})

					logs.info("Waiting for agent to commit changes...", "ParallelMode")

					// TODO: fix
					await new Promise((resolve) => setTimeout(resolve, 8000))

					// Verify if commit was made
					const commitCheck = execSync("git diff --staged", {
						cwd,
						encoding: "utf8",
						stdio: ["pipe", "pipe", "pipe"],
					})

					if (commitCheck.trim()) {
						logs.warn("Agent did not complete commit, using fallback", "ParallelMode")

						const fallbackMessage = "chore: parallel mode task completion"

						execSync(`git commit -m "${fallbackMessage}"`, { cwd, stdio: "inherit" })

						logs.info("Changes committed with fallback message", "ParallelMode")
					} else {
						logs.info("Agent successfully committed changes", "ParallelMode")
					}
				}
			}
		} else {
			logs.info("No changes to commit", "ParallelMode")
		}
	} catch (error) {
		logs.error("Failed to commit changes", "ParallelMode", { error })

		throw error
	}

	try {
		logs.info(`Removing worktree at: ${worktreePath}`, "ParallelMode")

		// Remove the worktree using git worktree remove
		execSync(`git worktree remove "${worktreePath}"`, {
			stdio: "pipe",
		})

		logs.info("Worktree removed successfully", "ParallelMode")
	} catch (error) {
		logs.warn("Failed to remove worktree", "ParallelMode", { error })
	}
}

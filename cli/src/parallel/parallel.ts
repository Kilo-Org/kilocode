import { determineParallelBranch } from "./determineBranch.js"
import { logs } from "../services/logs.js"
import type { CLI } from "../cli.js"
import { simpleGit } from "simple-git"
import { getTelemetryService } from "../services/telemetry/index.js"

/**
 * Helper function to commit changes with a fallback message
 */
async function commitWithFallback(cwd: string): Promise<void> {
	const fallbackMessage = "chore: parallel mode task completion"
	const git = simpleGit(cwd)

	await git.commit(fallbackMessage)

	logs.info("Changes committed with fallback message", "ParallelMode")
}

export const commitCompletionTimeout = 40000

/**
 * Poll git status to check if commit is complete
 * Returns true if commit was made, false if timeout reached
 */
async function waitForCommitCompletion(cwd: string): Promise<boolean> {
	const pollIntervalMs = 1000
	const startTime = Date.now()
	const git = simpleGit(cwd)

	while (Date.now() - startTime < commitCompletionTimeout) {
		try {
			const stagedDiff = await git.diff(["--staged"])

			// If no staged changes, commit was successful
			if (!stagedDiff.trim()) {
				return true
			}

			// Wait before next poll
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
		} catch (error) {
			logs.error("Error checking commit status", "ParallelMode", {
				error: error instanceof Error ? error.message : String(error),
			})

			return false
		}
	}

	return false
}

export type Input = {
	cwd: string
	prompt: string
	timeout?: number
	existingBranch?: string
}

/**
 * Get parameters for parallel mode execution
 */
export async function getParallelModeParams({ cwd, prompt, existingBranch }: Input) {
	try {
		// Determine branch and worktree path
		const { worktreeBranch, worktreePath } = await determineParallelBranch({
			cwd,
			prompt,
			...(existingBranch && { existingBranch }),
		})

		return {
			worktreeBranch,
			worktreePath,
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)

		logs.error("Error determining parallel branch", "ParallelMode", {
			error: message,
		})

		console.error(`Failed to start parallel mode: ${message}`)

		process.exit(1)
	}
}

const agentCommitInstruction =
	"Inspect the git diff and commit all staged changes with a proper conventional commit message (e.g., 'feat:', 'fix:', 'chore:', etc.). Use execute_command to run 'git diff --staged', then commit with an appropriate message using 'git commit -m \"your-message\"'."

/**
 * Finish parallel mode by having the extension agent generate a commit message and committing changes,
 * then cleaning up the git worktree.
 * This function should be called from the CLI dispose method when in parallel mode
 * Since it's part of the dispose flow, this function must never throw an error
 */
export async function finishParallelMode(cli: CLI, worktreePath: string, worktreeBranch: string) {
	const git = simpleGit(worktreePath)

	let beforeExit = () => {}

	try {
		const status = await git.status()

		if (!status.isClean()) {
			logs.info("Staging all changes...", "ParallelMode")

			await git.add("-A")

			const diff = await git.diff(["--staged"])

			if (!diff.trim()) {
				logs.warn("No staged changes found after git add", "ParallelMode")
			} else {
				const service = cli.getService()

				if (!service) {
					logs.error("Extension service not available, using fallback commit", "ParallelMode")

					await commitWithFallback(worktreePath)
				} else {
					logs.info("Instructing extension agent to inspect diff and commit changes...", "ParallelMode")

					await service.sendWebviewMessage({
						type: "askResponse",
						askResponse: "messageResponse",
						text: agentCommitInstruction,
					})

					logs.info("Waiting for agent to commit changes...", "ParallelMode")

					const commitCompleted = await waitForCommitCompletion(worktreePath)

					if (!commitCompleted) {
						logs.warn("Agent did not complete commit within timeout, using fallback", "ParallelMode")

						await commitWithFallback(worktreePath)
					} else {
						logs.info("Agent successfully committed changes", "ParallelMode")
					}
				}
			}
		} else {
			logs.info("No changes to commit", "ParallelMode")
		}

		// delegate printing the message just before exit
		beforeExit = () => {
			const green = "\x1b[32m"
			const cyan = "\x1b[36m"
			const yellow = "\x1b[33m"
			const bold = "\x1b[1m"
			const reset = "\x1b[0m"

			console.log("\n" + cyan + "─".repeat(113) + reset)
			console.log(
				`${green}✓${reset} ${bold}Parallel mode complete!${reset} Changes committed to: ${cyan}${worktreeBranch}${reset}`,
			)
			console.log(`\n${bold}Review and merge changes:${reset}`)
			console.log(`  ${yellow}git diff ...${worktreeBranch}${reset}`)
			console.log(`  ${yellow}git merge ${worktreeBranch}${reset}`)
			console.log(`\n${bold}💡 Tip:${reset} Resume work with ${yellow}--existing-branch${reset}:`)
			console.log(`  ${yellow}kilocode --parallel --existing-branch ${worktreeBranch} "<prompt>"${reset}`)
			console.log(cyan + "─".repeat(113) + reset + "\n")
		}

		getTelemetryService().trackParallelModeCompleted()
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)

		logs.error("Failed to commit changes", "ParallelMode", {
			error: errorMessage,
		})

		// Track parallel mode error
		getTelemetryService().trackParallelModeErrored(errorMessage)
	}

	try {
		logs.info(`Removing worktree at: ${worktreePath}`, "ParallelMode")

		const git = simpleGit(process.cwd())

		await git.raw(["worktree", "remove", worktreePath])

		logs.info("Worktree removed successfully", "ParallelMode")
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)

		logs.warn("Failed to remove worktree", "ParallelMode", {
			error: errorMessage,
		})

		// Track parallel mode error
		getTelemetryService().trackParallelModeErrored(errorMessage)
	}

	return beforeExit
}

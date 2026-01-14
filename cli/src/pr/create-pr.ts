import { simpleGit } from "simple-git"
import { exec } from "child_process"
import { promisify } from "util"
import { logs } from "../services/logs.js"
import type { CLI } from "../cli.js"
import { getTelemetryService } from "../services/telemetry/index.js"

const execAsync = promisify(exec)

export const prCreationTimeout = 90000 // 90 seconds for PR creation (increased for push + PR)

/**
 * Build the PR creation instruction with context about the user's original task
 */
export function buildPrInstruction(initialPrompt: string, hasChanges: boolean): string {
	const taskContext = initialPrompt
		? `\nThe user's original task was: "${initialPrompt}"\nUse this context to write a meaningful PR title and description.`
		: ""

	const changesContext = hasChanges
		? `\nThere are uncommitted changes that need to be committed before creating the PR.`
		: `\nAll changes have already been committed.`

	return `You MUST create a pull request for the current branch. Complete ALL steps below - do not stop early.
${taskContext}
${changesContext}

## Step 1: Handle uncommitted changes
Run 'git status' to check for uncommitted changes.
- If there ARE uncommitted changes:
  1. Stage all changes: 'git add -A'
  2. Commit with a conventional commit message based on the task: 'git commit -m "feat: ..." or fix: or chore: etc.'
  3. If pre-commit hooks fail, retry with: 'git commit --no-verify -m "..."'
- If there are NO uncommitted changes: proceed to Step 2

## Step 2: Push the branch (REQUIRED)
1. Get the current branch name: 'git rev-parse --abbrev-ref HEAD'
2. Push to remote: 'git push -u origin <branch-name>'
3. Do NOT use --force

## Step 3: Create the pull request (REQUIRED)
1. First check if a PR already exists: 'gh pr view --json url 2>/dev/null'
2. If a PR already exists, get its URL and skip to Step 4
3. If NO PR exists, create one:
   'gh pr create --title "<title based on task>" --body "<description of changes>"'
   - The title should summarize what was accomplished
   - The body should explain what changed and reference the original task
   - GH_TOKEN is available in the environment for authentication

## Step 4: Return the PR URL (REQUIRED)
Run: 'gh pr view --json url --jq .url'
Include the full PR URL in your final response.

## IMPORTANT RULES
- You MUST complete all 4 steps - do not stop after checking git status
- Do NOT create a PR if on main/master branch - report this and exit
- If 'gh' command fails, report the specific error
- If push fails due to no upstream, the -u flag should handle it
- Always return the PR URL at the end`
}

/**
 * Legacy instruction for backwards compatibility (exported for tests)
 */
export const agentPrInstruction = buildPrInstruction("", false)

/**
 * Check if a PR exists for the current branch using gh CLI
 */
async function checkPrExists(cwd: string): Promise<{ exists: boolean; url?: string }> {
	try {
		const { stdout } = await execAsync("gh pr view --json url --jq .url", { cwd })
		const url = stdout.trim()
		if (url && url.startsWith("http")) {
			return { exists: true, url }
		}
		return { exists: false }
	} catch {
		// gh pr view returns non-zero if no PR exists
		return { exists: false }
	}
}

/**
 * Poll to wait for PR creation to complete
 * Actively checks if a PR was created using gh CLI
 * Returns object with completion status and optional PR URL
 */
async function waitForPrCompletion(cwd: string): Promise<{ completed: boolean; prUrl?: string }> {
	const pollIntervalMs = 3000
	const startTime = Date.now()

	// Give the agent a few seconds to start before checking
	await new Promise((resolve) => setTimeout(resolve, 5000))

	while (Date.now() - startTime < prCreationTimeout) {
		try {
			// Check if PR was created
			const prCheck = await checkPrExists(cwd)
			if (prCheck.exists && prCheck.url) {
				logs.info(`PR detected: ${prCheck.url}`, "CreatePR")
				return { completed: true, prUrl: prCheck.url }
			}

			// Wait before next poll
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
		} catch (error) {
			logs.error("Error during PR creation wait", "CreatePR", {
				error: error instanceof Error ? error.message : String(error),
			})
			// Continue polling even on error
		}
	}

	// Timeout reached - do one final check
	const finalCheck = await checkPrExists(cwd)
	if (finalCheck.exists && finalCheck.url) {
		return { completed: true, prUrl: finalCheck.url }
	}

	return { completed: false }
}

export interface FinishWithPrInput {
	cwd: string
	initialPrompt: string
}

/**
 * Finish task by prompting agent to create a PR
 * This function should be called from the CLI dispose method when --create-pr is enabled
 * Since it's part of the dispose flow, this function must never throw an error
 */
export async function finishWithPrCreation(cli: CLI, input: FinishWithPrInput): Promise<() => void> {
	const { cwd, initialPrompt } = input
	const git = simpleGit(cwd)
	let beforeExit = () => {}

	try {
		// Check current branch - skip if on main/master
		const branch = await git.revparse(["--abbrev-ref", "HEAD"])
		const currentBranch = branch.trim()

		if (currentBranch === "main" || currentBranch === "master") {
			logs.info(`PR creation skipped: on ${currentBranch} branch`, "CreatePR")
			return beforeExit
		}

		// Check if there are uncommitted changes
		const status = await git.status()
		const hasUncommittedChanges = !status.isClean()

		// Check if a PR already exists for this branch
		const existingPr = await checkPrExists(cwd)
		if (existingPr.exists && existingPr.url) {
			logs.info(`PR already exists: ${existingPr.url}`, "CreatePR")
			beforeExit = () => {
				const green = "\x1b[32m"
				const cyan = "\x1b[36m"
				const reset = "\x1b[0m"

				console.log("\n" + cyan + "─".repeat(80) + reset)
				console.log(`${green}✓${reset} PR already exists for this branch!`)
				console.log(`  ${cyan}${existingPr.url}${reset}`)
				console.log(cyan + "─".repeat(80) + reset + "\n")
			}
			getTelemetryService().trackFeatureUsed("pr_creation", 1, true)
			return beforeExit
		}

		const service = cli.getService()
		if (!service) {
			logs.error("Extension service not available for PR creation", "CreatePR")
			return beforeExit
		}

		// Build context-aware instruction
		const instruction = buildPrInstruction(initialPrompt, hasUncommittedChanges)

		logs.info("Instructing agent to create pull request...", "CreatePR")
		logs.debug(`Initial prompt context: ${initialPrompt.substring(0, 100)}...`, "CreatePR")

		await service.sendWebviewMessage({
			type: "askResponse",
			askResponse: "messageResponse",
			text: instruction,
		})

		logs.info("Waiting for agent to create PR...", "CreatePR")

		const result = await waitForPrCompletion(cwd)

		if (!result.completed) {
			logs.warn("PR creation did not complete within timeout", "CreatePR")
			beforeExit = () => {
				const yellow = "\x1b[33m"
				const cyan = "\x1b[36m"
				const reset = "\x1b[0m"

				console.log("\n" + cyan + "─".repeat(80) + reset)
				console.log(`${yellow}⚠${reset} PR creation timed out`)
				console.log(`  The agent may still be working. Check the output above.`)
				console.log(`  You can manually create a PR with: ${yellow}gh pr create${reset}`)
				console.log(cyan + "─".repeat(80) + reset + "\n")
			}
		} else {
			logs.info(`PR creation completed: ${result.prUrl}`, "CreatePR")
			const prUrl = result.prUrl
			beforeExit = () => {
				const green = "\x1b[32m"
				const cyan = "\x1b[36m"
				const reset = "\x1b[0m"

				console.log("\n" + cyan + "─".repeat(80) + reset)
				console.log(`${green}✓${reset} Pull request created successfully!`)
				if (prUrl) {
					console.log(`  ${cyan}${prUrl}${reset}`)
				}
				console.log(cyan + "─".repeat(80) + reset + "\n")
			}
		}

		// Track telemetry
		getTelemetryService().trackFeatureUsed("pr_creation", 1, result.completed)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logs.error("Failed during PR creation flow", "CreatePR", { error: errorMessage })

		// Track error telemetry
		getTelemetryService().trackError("pr_creation_error", errorMessage)
	}

	return beforeExit
}

import { getGitInfo } from "../utils/git.js"
import { logs } from "../services/logs.js"
import { exec } from "child_process"
import { promisify } from "util"
import { CLI } from "../cli.js"
import { determineParallelBranch } from "./determineBranch.js"
import { getTelemetryService } from "../services/telemetry/index.js"

const execAsync = promisify(exec)

export type Input = {
	cwd: string
	prompt: string
	timeout?: number
	existingBranch?: string
}

/**
 * Start parallel mode by creating a git worktree and spawning CLI in auto mode
 */
export async function startParallelMode({ cwd, prompt, timeout, existingBranch }: Input) {
	const startTime = Date.now()
	const { branch: cwdBranch } = await getGitInfo(cwd)

	// Determine branch and worktree path
	const { worktreeBranch, worktreePath } = await determineParallelBranch({
		cwd,
		prompt,
		...(existingBranch && { existingBranch }),
	})

	// Initialize CLI in the worktree directory
	const cli = new CLI({
		workspace: worktreePath,
		ci: true, // Run in autonomous mode
		parallel: true,
		prompt: `${prompt}\n\nOnce you are done, commit your changes (if any) using a conventional commit message and leave the repo in a clean state (git status should report a clean working directory).`,
		...(timeout !== undefined && { timeout }),
	})

	let exitCode

	try {
		await cli.start()
		exitCode = await cli.dispose()

		if (exitCode) {
			throw new Error(`non-zero exit code from CLI: ${exitCode}`)
		}

		const duration = Date.now() - startTime
		logs.info(`Task completed in worktree: ${worktreePath}`, "ParallelMode")

		// Track successful completion
		getTelemetryService().trackParallelModeCompleted({
			duration,
			branchName: worktreeBranch,
			taskCompleted: true,
		})

		// Display success message to user
		console.log("\n" + "=".repeat(70))
		console.log("\x1b[32m✓ Task completed successfully!\x1b[0m")
		console.log("=".repeat(70))
		console.log("\n\x1b[1mYour changes are available on branch:\x1b[0m")
		console.log(`  \x1b[36m${worktreeBranch}\x1b[0m`)
		console.log("\n\x1b[1mTo review and merge the changes:\x1b[0m")
		console.log(`  \x1b[90m$\x1b[0m git checkout ${cwdBranch}`)
		console.log(`  \x1b[90m$\x1b[0m git diff ${cwdBranch}..${worktreeBranch}`)
		console.log(`  \x1b[90m$\x1b[0m git merge ${worktreeBranch}`)
		console.log("\n\x1b[1mTo continue work on this branch:\x1b[0m")
		console.log(`  \x1b[90m$\x1b[0m kilocode --parallel --existing-branch ${worktreeBranch} "your task"`)
		console.log("\n" + "=".repeat(70) + "\n")
	} catch (error) {
		const duration = Date.now() - startTime
		const errorMessage = error instanceof Error ? error.message : String(error)

		logs.error("Error running CLI in worktree", "ParallelMode", { error })

		// Track failure
		getTelemetryService().trackParallelModeFailed(errorMessage, duration, worktreeBranch)

		throw error
	} finally {
		// Clean up worktree
		try {
			await execAsync(`git worktree remove --force "${worktreePath}"`, { cwd })
			logs.info(`Removed worktree: ${worktreePath}`, "ParallelMode")
		} catch (cleanupError) {
			logs.warn(`Failed to remove worktree: ${worktreePath}`, "ParallelMode", { error: cleanupError })
		}

		process.exit(exitCode)
	}
}

import { getGitInfo, generateBranchName } from "../utils/git.js"
import { logs } from "../services/logs.js"
import path from "path"
import os from "os"
import { exec } from "child_process"
import { promisify } from "util"
import { CLI } from "../cli.js"

const execAsync = promisify(exec)

export type Input = {
	cwd: string
	prompt: string
	timeout?: number
}

/**
 * Start parallel mode by creating a git worktree and spawning CLI in auto mode
 */
export async function startParallelMode({ cwd, prompt, timeout }: Input) {
	const { isRepo, branch } = await getGitInfo(cwd)

	if (!isRepo) {
		console.error("Error: parallel mode (-p) requires the current working directory to be a git repository")
		process.exit(1)
	}

	if (!branch) {
		console.error("Error: could not determine current git branch")
		process.exit(1)
	}

	// Generate branch name from prompt
	const branchName = generateBranchName(prompt)
	logs.info(`Creating worktree with branch: ${branchName}`, "ParallelMode")

	// Create worktree directory path in OS temp directory
	const tempDir = os.tmpdir()
	const worktreePath = path.join(tempDir, `kilocode-worktree-${branchName}`)

	try {
		// Create new branch and worktree using git command directly
		await execAsync(`git worktree add -b ${branchName} "${worktreePath}"`, { cwd })
		logs.info(`Created worktree at: ${worktreePath}`, "ParallelMode")
	} catch (error) {
		logs.error("Failed to create worktree", "ParallelMode", { error })
		console.error(`Error: Failed to create git worktree: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}

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

		logs.info(`Task completed in worktree: ${worktreePath}`, "ParallelMode")

		// Display success message to user
		console.log("\n" + "=".repeat(70))
		console.log("\x1b[32m✓ Task completed successfully!\x1b[0m")
		console.log("=".repeat(70))
		console.log("\n\x1b[1mYour changes are available on branch:\x1b[0m")
		console.log(`  \x1b[36m${branchName}\x1b[0m`)
		console.log("\n\x1b[1mTo review and merge the changes:\x1b[0m")
		console.log(`  \x1b[90m$\x1b[0m git checkout ${branchName}`)
		console.log(`  \x1b[90m$\x1b[0m git diff ${branch}..${branchName}`)
		console.log(`  \x1b[90m$\x1b[0m git merge ${branchName}`)
		console.log("\n" + "=".repeat(70) + "\n")
	} catch (error) {
		logs.error("Error running CLI in worktree", "ParallelMode", { error })

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

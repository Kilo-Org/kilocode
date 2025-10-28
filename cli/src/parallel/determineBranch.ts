import { getGitInfo, generateBranchName, branchExists } from "../utils/git.js"
import { logs } from "../services/logs.js"
import path from "path"
import os from "os"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export interface DetermineParallelBranchInput {
	cwd: string
	prompt: string
	existingBranch?: string
}

export interface DetermineParallelBranchResult {
	worktreeBranch: string
	worktreePath: string
}

/**
 * Determine the branch and worktree path for parallel mode
 * Validates git repository, creates or uses existing branch, and sets up worktree
 */
export async function determineParallelBranch({
	cwd,
	prompt,
	existingBranch,
}: DetermineParallelBranchInput): Promise<DetermineParallelBranchResult> {
	const { isRepo, branch } = await getGitInfo(cwd)

	if (!isRepo) {
		console.error("Error: parallel mode (-p) requires the current working directory to be a git repository")
		process.exit(1)
	}

	if (!branch) {
		console.error("Error: could not determine current git branch")
		process.exit(1)
	}

	// Determine the branch to use
	let worktreeBranch: string

	if (existingBranch) {
		// Check if the existing branch exists
		const exists = await branchExists(cwd, existingBranch)

		if (!exists) {
			console.error(`Error: Branch "${existingBranch}" does not exist`)
			process.exit(1)
		}

		worktreeBranch = existingBranch

		logs.info(`Using existing branch: ${worktreeBranch}`, "ParallelMode")
	} else {
		// Generate branch name from prompt
		worktreeBranch = generateBranchName(prompt)

		logs.info(`Creating worktree with branch: ${worktreeBranch}`, "ParallelMode")
	}

	// Create worktree directory path in OS temp directory
	const tempDir = os.tmpdir()
	const worktreePath = path.join(tempDir, `kilocode-worktree-${worktreeBranch}`)

	// Create worktree with appropriate git command
	try {
		const gitCommand = existingBranch
			? `git worktree add "${worktreePath}" ${worktreeBranch}`
			: `git worktree add -b ${worktreeBranch} "${worktreePath}"`

		await execAsync(gitCommand, { cwd })
		logs.info(`Created worktree at: ${worktreePath}`, "ParallelMode")
	} catch (error) {
		logs.error("Failed to create worktree", "ParallelMode", { error })
		console.error(`Error: Failed to create git worktree: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}

	return { worktreeBranch, worktreePath }
}

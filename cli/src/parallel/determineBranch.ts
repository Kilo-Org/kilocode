import { getGitInfo, generateBranchName, branchExists } from "../utils/git.js"
import { logs } from "../services/logs.js"
import path from "path"
import os from "os"
import simpleGit from "simple-git"

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
		const errorMessage = "Parallel mode requires the current working directory to be a git repository"
		logs.error(errorMessage, "ParallelMode")
		throw new Error(errorMessage)
	}

	if (!branch) {
		const errorMessage = "Could not determine current git branch"
		logs.error(errorMessage, "ParallelMode")
		throw new Error(errorMessage)
	}

	// Determine the branch to use
	let worktreeBranch: string

	if (existingBranch) {
		// Check if the existing branch exists
		const exists = await branchExists(cwd, existingBranch)

		if (!exists) {
			const errorMessage = `Branch "${existingBranch}" does not exist`
			logs.error(errorMessage, "ParallelMode")
			throw new Error(errorMessage)
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
		const git = simpleGit(cwd)
		const args = existingBranch
			? ["worktree", "add", worktreePath, worktreeBranch]
			: ["worktree", "add", "-b", worktreeBranch, worktreePath]

		await git.raw(args)
		logs.info(`Created worktree at: ${worktreePath}`, "ParallelMode")
	} catch (error) {
		logs.error("Failed to create worktree", "ParallelMode", { error })

		throw error
	}

	return { worktreeBranch, worktreePath }
}

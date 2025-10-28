import { getGitInfo } from "../utils/git.js"
import { determineParallelBranch } from "./determineBranch.js"

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

export async function finishParallelMode() {
	// instruct the agent to commit the changes
	// clean the git worktree
}

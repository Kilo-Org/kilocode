/**
 * Git utilities for retrieving repository information
 */

import simpleGit, { SimpleGit } from "simple-git"
import { logs } from "../services/logs.js"

export interface GitInfo {
	branch: string | null
	isClean: boolean
	isRepo: boolean
}

/**
 * Get Git repository information for a given directory
 * @param cwd - Current working directory path
 * @returns Git information including branch name and clean status
 */
export async function getGitInfo(cwd: string): Promise<GitInfo> {
	const defaultResult: GitInfo = {
		branch: null,
		isClean: true,
		isRepo: false,
	}

	if (!cwd) {
		return defaultResult
	}

	try {
		const git: SimpleGit = simpleGit(cwd)

		// Check if it's a git repository
		const isRepo = await git.checkIsRepo()
		if (!isRepo) {
			return defaultResult
		}

		// Get current branch
		const branch = await git.revparse(["--abbrev-ref", "HEAD"])

		// Check if working directory is clean
		const status = await git.status()
		const isClean = status.files.length === 0

		return {
			branch: branch.trim() || null,
			isClean,
			isRepo: true,
		}
	} catch (error) {
		logs.debug("Failed to get git info", "GitUtils", { error, cwd })
		return defaultResult
	}
}

/**
 * Get just the branch name (faster than full git info)
 * @param cwd - Current working directory path
 * @returns Branch name or null
 */
export async function getGitBranch(cwd: string): Promise<string | null> {
	if (!cwd) {
		return null
	}

	try {
		const git: SimpleGit = simpleGit(cwd)
		const isRepo = await git.checkIsRepo()
		if (!isRepo) {
			return null
		}

		const branch = await git.revparse(["--abbrev-ref", "HEAD"])
		return branch.trim() || null
	} catch (error) {
		logs.debug("Failed to get git branch", "GitUtils", { error, cwd })
		return null
	}
}

/**
 * Check if a branch exists in the repository
 * @param cwd - Current working directory path
 * @param branchName - Name of the branch to check
 * @returns True if branch exists, false otherwise
 */
export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
	if (!cwd || !branchName) {
		return false
	}

	try {
		const git: SimpleGit = simpleGit(cwd)
		const isRepo = await git.checkIsRepo()
		if (!isRepo) {
			return false
		}

		// Get all branches (local and remote)
		const branches = await git.branch()

		// Check if branch exists in local branches
		return branches.all.includes(branchName) || branches.all.includes(`remotes/origin/${branchName}`)
	} catch (error) {
		logs.debug("Failed to check if branch exists", "GitUtils", { error, cwd, branchName })
		return false
	}
}

/**
 * Generate a valid git branch name from a prompt
 * Sanitizes the prompt to create a safe branch name
 */
export function generateBranchName(prompt: string): string {
	// Take first 50 chars, convert to lowercase, replace spaces and special chars with hyphens
	const sanitized = prompt
		.slice(0, 50)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
		.replace(/-+/g, "-") // Collapse multiple hyphens

	// Add timestamp to ensure uniqueness
	const timestamp = Date.now()
	return `${sanitized || "kilo"}-${timestamp}`
}

/**
 * Check if a directory is a git worktree
 * @param cwd - Current working directory path
 * @returns True if directory is a git worktree, false otherwise
 */
export async function isGitWorktree(cwd: string): Promise<boolean> {
	if (!cwd) {
		return false
	}

	try {
		const git: SimpleGit = simpleGit(cwd)
		const isRepo = await git.checkIsRepo()
		if (!isRepo) {
			return false
		}

		// In a worktree, --git-dir points to .git/worktrees/<name>
		// In a normal repo, --git-dir points to .git
		const gitDir = await git.revparse(["--git-dir"])
		return gitDir.trim().includes("worktrees")
	} catch (error) {
		logs.debug("Failed to check if git worktree", "GitUtils", { error, cwd })
		return false
	}
}

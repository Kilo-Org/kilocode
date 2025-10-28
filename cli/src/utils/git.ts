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
	return `kilo-agent-${sanitized}-${timestamp}`
}

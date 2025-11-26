// kilocode_change - new file
/**
 * Git utility functions for managed codebase indexing
 *
 * This module provides pure functions for interacting with git to determine
 * branch state and file changes. Used to implement delta-based indexing.
 */

import { execGetLines } from "../../../shared/utils/exec"
import { GitDiff, GitDiffFile } from "./types"

/**
 * Helper function to collect all lines from execGetLines into a single string
 */
async function collectOutput(cmd: string, cwd: string, context: string): Promise<string> {
	const lines: string[] = []
	for await (const line of execGetLines({ cmd, cwd, context })) {
		lines.push(line)
	}
	return lines.join("\n").trim()
}

/**
 * Gets the current git branch name
 * @param workspacePath Path to the workspace
 * @returns Current branch name (e.g., "main", "feature/new-api")
 * @throws Error if not in a git repository
 */
export async function getCurrentBranch(workspacePath: string): Promise<string> {
	try {
		return await collectOutput("git rev-parse --abbrev-ref HEAD", workspacePath, "getting current git branch")
	} catch (error) {
		throw new Error(`Failed to get current git branch: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Gets the current git commit SHA
 * @param workspacePath Path to the workspace
 * @returns Current commit SHA (full 40-character hash)
 * @throws Error if not in a git repository
 */
export async function getCurrentCommitSha(workspacePath: string): Promise<string> {
	try {
		return await collectOutput("git rev-parse HEAD", workspacePath, "getting current commit SHA")
	} catch (error) {
		throw new Error(`Failed to get current commit SHA: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Gets the remote URL for the repository
 * @param workspacePath Path to the workspace
 * @returns Remote URL (e.g., "https://github.com/org/repo.git")
 * @throws Error if no remote is configured
 */
export async function getRemoteUrl(workspacePath: string): Promise<string> {
	try {
		return await collectOutput("git config --get remote.origin.url", workspacePath, "getting remote URL")
	} catch (error) {
		throw new Error(`Failed to get remote URL: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Checks if the workspace is a git repository
 * @param workspacePath Path to the workspace
 * @returns true if workspace is a git repository
 */
export async function isGitRepository(workspacePath: string): Promise<boolean> {
	try {
		await collectOutput("git rev-parse --git-dir", workspacePath, "checking if git repository")
		return true
	} catch {
		return false
	}
}

/**
 * Gets the diff between a feature branch and base branch
 * @param featureBranch The feature branch name
 * @param baseBranch The base branch name (usually 'main' or 'develop')
 * @param workspacePath Path to the workspace
 * @returns GitDiff object with added, modified, and deleted files
 * @throws Error if git command fails
 */
export async function getGitDiff(featureBranch: string, baseBranch: string, workspacePath: string): Promise<GitDiff> {
	try {
		// Get the merge base (commit where branches diverged)
		const mergeBase = await collectOutput(
			`git merge-base ${baseBranch} ${featureBranch}`,
			workspacePath,
			"getting merge base",
		)

		// Get diff between merge base and feature branch
		const diffOutput = await collectOutput(
			`git diff --name-status ${mergeBase}..${featureBranch}`,
			workspacePath,
			"getting git diff",
		)

		return parseDiffOutput(diffOutput)
	} catch (error) {
		throw new Error(
			`Failed to get git diff between ${featureBranch} and ${baseBranch}: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/**
 * Parses git diff --name-status output into structured format
 * @param diffOutput Raw output from git diff --name-status
 * @returns GitDiff object with categorized file changes
 */
function parseDiffOutput(diffOutput: string): GitDiff {
	const added: string[] = []
	const modified: string[] = []
	const deleted: string[] = []

	const lines = diffOutput.split("\n").filter((line) => line.trim())

	for (const line of lines) {
		const parts = line.split("\t")
		if (parts.length < 2) continue

		const status = parts[0]
		const filePath = parts.slice(1).join("\t") // Handle file paths with tabs

		switch (status[0]) {
			case "A":
				added.push(filePath)
				break
			case "M":
				modified.push(filePath)
				break
			case "D":
				deleted.push(filePath)
				break
			case "R": // Renamed - treat as delete + add
				if (parts.length >= 3) {
					deleted.push(parts[1])
					added.push(parts[2])
				}
				break
			case "C": // Copied - treat as add
				if (parts.length >= 3) {
					added.push(parts[2])
				}
				break
			// Ignore other statuses (T=type change, U=unmerged, X=unknown)
		}
	}

	return { added, modified, deleted }
}

/**
 * Determines if a branch is a base branch (main or develop)
 * @param branchName The branch name to check
 * @param workspacePath Optional workspace path to check against remote default branch
 * @returns true if this is a base branch
 */
export async function isBaseBranch(branchName: string, workspacePath?: string): Promise<boolean> {
	const baseBranches = ["main", "master", "develop", "development"]
	const isCommonBaseBranch = baseBranches.includes(branchName.toLowerCase())

	// If it's a common base branch, return true
	if (isCommonBaseBranch) {
		return true
	}

	// If workspace path is provided, check if this branch is the remote's default branch
	if (workspacePath) {
		const defaultBranch = await getDefaultBranchFromRemote(workspacePath)
		if (defaultBranch && defaultBranch.toLowerCase() === branchName.toLowerCase()) {
			return true
		}
	}

	return false
}

/**
 * Gets the default branch name from the remote repository
 * @param workspacePath Path to the workspace
 * @returns The default branch name or null if it cannot be determined
 */
export async function getDefaultBranchFromRemote(workspacePath: string): Promise<string | null> {
	try {
		// Try to get the default branch from the remote's symbolic ref
		const output = await collectOutput(
			"git symbolic-ref refs/remotes/origin/HEAD",
			workspacePath,
			"getting default branch from remote",
		)

		// Output format: refs/remotes/origin/main
		// Extract the branch name after the last /
		const match = output.match(/refs\/remotes\/origin\/(.+)$/)
		if (match && match[1]) {
			return match[1]
		}
	} catch {
		// If symbolic-ref fails, try to set it first
		try {
			await collectOutput("git remote set-head origin --auto", workspacePath, "setting remote head")

			// Try again after setting
			const output = await collectOutput(
				"git symbolic-ref refs/remotes/origin/HEAD",
				workspacePath,
				"getting default branch from remote",
			)

			const match = output.match(/refs\/remotes\/origin\/(.+)$/)
			if (match && match[1]) {
				return match[1]
			}
		} catch {
			// Failed to determine from remote
		}
	}

	return null
}

/**
 * Gets the base branch for a given feature branch
 * First tries to get the default branch from the remote repository,
 * then checks if common base branches exist, defaults to 'main'
 * @param workspacePath Path to the workspace
 * @returns The base branch name (e.g., 'main', 'canary', 'develop')
 */
export async function getBaseBranch(workspacePath: string): Promise<string> {
	// First, try to get the default branch from the remote
	const defaultBranch = await getDefaultBranchFromRemote(workspacePath)
	if (defaultBranch) {
		// Verify the branch exists locally
		try {
			await collectOutput(`git rev-parse --verify ${defaultBranch}`, workspacePath, "verifying branch exists")
			return defaultBranch
		} catch {
			// Default branch from remote doesn't exist locally, continue to fallback
		}
	}

	// Fallback: Check common base branch names
	const commonBranches = ["main", "develop", "master"]
	for (const branch of commonBranches) {
		try {
			await collectOutput(`git rev-parse --verify ${branch}`, workspacePath, "verifying branch exists")
			return branch
		} catch {
			// Branch doesn't exist, try next
		}
	}

	// Ultimate fallback
	return "main"
}

/**
 * Checks if there are uncommitted changes in the workspace
 * @param workspacePath Path to the workspace
 * @returns true if there are uncommitted changes
 */
export async function hasUncommittedChanges(workspacePath: string): Promise<boolean> {
	try {
		const status = await collectOutput("git status --porcelain", workspacePath, "checking for uncommitted changes")
		return status.length > 0
	} catch {
		return false
	}
}

/**
 * Gets all files tracked by git using async generator for memory efficiency
 * @param workspacePath Path to the workspace
 * @yields File paths relative to workspace root
 */
export async function* getGitTrackedFiles(workspacePath: string): AsyncGenerator<string, void, unknown> {
	try {
		for await (const line of execGetLines({
			cmd: "git ls-files",
			cwd: workspacePath,
			context: "getting git tracked files",
		})) {
			const trimmed = line.trim()
			if (trimmed) {
				yield trimmed
			}
		}
	} catch (error) {
		throw new Error(`Failed to get git tracked files: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Checks if the repository is in a detached HEAD state
 * @param workspacePath Path to the workspace
 * @returns true if in detached HEAD state
 */
export async function isDetachedHead(workspacePath: string): Promise<boolean> {
	try {
		const branch = await collectOutput(
			"git rev-parse --abbrev-ref HEAD",
			workspacePath,
			"checking for detached HEAD",
		)
		return branch === "HEAD"
	} catch {
		return false
	}
}

/**
 * Gets the path to the .git/HEAD file
 * @param workspacePath Path to the workspace
 * @returns Path to .git/HEAD file
 */
export async function getGitHeadPath(workspacePath: string): Promise<string> {
	try {
		const gitDir = await collectOutput("git rev-parse --git-dir", workspacePath, "getting git directory")
		return `${gitDir}/HEAD`
	} catch (error) {
		throw new Error(`Failed to get git HEAD path: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Gets the current git state (branch and commit)
 * @param workspacePath Path to the workspace
 * @returns Object with branch name and commit SHA, or null if detached
 */
export async function getGitState(
	workspacePath: string,
): Promise<{ branch: string; commit: string; isDetached: boolean } | null> {
	try {
		const isDetached = await isDetachedHead(workspacePath)

		if (isDetached) {
			return null
		}

		const branch = await getCurrentBranch(workspacePath)
		const commit = await getCurrentCommitSha(workspacePath)

		return { branch, commit, isDetached: false }
	} catch {
		return null
	}
}

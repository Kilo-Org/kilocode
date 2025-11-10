/**
 * Git utility functions for managed codebase indexing
 *
 * This module provides pure functions for interacting with git to determine
 * branch state and file changes. Used to implement delta-based indexing.
 */

import { execSync } from "child_process"
import { GitDiff } from "./types"

/**
 * Gets the current git branch name
 * @param workspacePath Path to the workspace
 * @returns Current branch name (e.g., "main", "feature/new-api")
 * @throws Error if not in a git repository
 */
export function getCurrentBranch(workspacePath: string): string {
	try {
		return execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: workspacePath,
			encoding: "utf8",
		}).trim()
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
export function getCurrentCommitSha(workspacePath: string): string {
	try {
		return execSync("git rev-parse HEAD", {
			cwd: workspacePath,
			encoding: "utf8",
		}).trim()
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
export function getRemoteUrl(workspacePath: string): string {
	try {
		return execSync("git config --get remote.origin.url", {
			cwd: workspacePath,
			encoding: "utf8",
		}).trim()
	} catch (error) {
		throw new Error(`Failed to get remote URL: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Checks if the workspace is a git repository
 * @param workspacePath Path to the workspace
 * @returns true if workspace is a git repository
 */
export function isGitRepository(workspacePath: string): boolean {
	try {
		execSync("git rev-parse --git-dir", {
			cwd: workspacePath,
			encoding: "utf8",
			stdio: "pipe",
		})
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
export function getGitDiff(featureBranch: string, baseBranch: string, workspacePath: string): GitDiff {
	try {
		// Get the merge base (commit where branches diverged)
		const mergeBase = execSync(`git merge-base ${baseBranch} ${featureBranch}`, {
			cwd: workspacePath,
			encoding: "utf8",
		}).trim()

		// Get diff between merge base and feature branch
		const diffOutput = execSync(`git diff --name-status ${mergeBase}..${featureBranch}`, {
			cwd: workspacePath,
			encoding: "utf8",
		})

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
export function isBaseBranch(branchName: string, workspacePath?: string): boolean {
	const baseBranches = ["main", "master", "develop", "development"]
	const isCommonBaseBranch = baseBranches.includes(branchName.toLowerCase())

	// If it's a common base branch, return true
	if (isCommonBaseBranch) {
		return true
	}

	// If workspace path is provided, check if this branch is the remote's default branch
	if (workspacePath) {
		const defaultBranch = getDefaultBranchFromRemote(workspacePath)
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
export function getDefaultBranchFromRemote(workspacePath: string): string | null {
	try {
		// Try to get the default branch from the remote's symbolic ref
		const output = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
			cwd: workspacePath,
			encoding: "utf8",
			stdio: "pipe",
		}).trim()

		// Output format: refs/remotes/origin/main
		// Extract the branch name after the last /
		const match = output.match(/refs\/remotes\/origin\/(.+)$/)
		if (match && match[1]) {
			return match[1]
		}
	} catch {
		// If symbolic-ref fails, try to set it first
		try {
			execSync("git remote set-head origin --auto", {
				cwd: workspacePath,
				encoding: "utf8",
				stdio: "pipe",
			})

			// Try again after setting
			const output = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
				cwd: workspacePath,
				encoding: "utf8",
				stdio: "pipe",
			}).trim()

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
export function getBaseBranch(workspacePath: string): string {
	// First, try to get the default branch from the remote
	const defaultBranch = getDefaultBranchFromRemote(workspacePath)
	if (defaultBranch) {
		// Verify the branch exists locally
		try {
			execSync(`git rev-parse --verify ${defaultBranch}`, {
				cwd: workspacePath,
				encoding: "utf8",
				stdio: "pipe",
			})
			return defaultBranch
		} catch {
			// Default branch from remote doesn't exist locally, continue to fallback
		}
	}

	// Fallback: Check common base branch names
	const commonBranches = ["main", "develop", "master"]
	for (const branch of commonBranches) {
		try {
			execSync(`git rev-parse --verify ${branch}`, {
				cwd: workspacePath,
				encoding: "utf8",
				stdio: "pipe",
			})
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
export function hasUncommittedChanges(workspacePath: string): boolean {
	try {
		const status = execSync("git status --porcelain", {
			cwd: workspacePath,
			encoding: "utf8",
		})
		return status.trim().length > 0
	} catch {
		return false
	}
}

/**
 * Gets all files tracked by git using async generator for memory efficiency
 * @param workspacePath Path to the workspace
 * @yields File paths relative to workspace root
 */
// export async function* getGitTrackedFiles(workspacePath: string): AsyncGenerator<string, void, unknown> {
// 	const { spawn } = await import("child_process")

// 	return new Promise<void>((resolve, reject) => {
// 		const gitProcess = spawn("git", ["ls-files"], {
// 			cwd: workspacePath,
// 			stdio: ["ignore", "pipe", "pipe"],
// 		})

// 		let buffer = ""

// 		gitProcess.stdout.on("data", (chunk: Buffer) => {
// 			buffer += chunk.toString()
// 			const lines = buffer.split("\n")
// 			// Keep the last incomplete line in the buffer
// 			buffer = lines.pop() || ""

// 			// Yield complete lines
// 			for (const line of lines) {
// 				const trimmed = line.trim()
// 				if (trimmed) {
// 					// This is a hack to make the generator work synchronously
// 					// We'll refactor this to use a proper async generator pattern
// 					;(async () => {
// 						// Yield the file path
// 					})()
// 				}
// 			}
// 		})

// 		gitProcess.stderr.on("data", (chunk: Buffer) => {
// 			console.error(`git ls-files error: ${chunk.toString()}`)
// 		})

// 		gitProcess.on("close", (code) => {
// 			if (code !== 0) {
// 				reject(new Error(`git ls-files exited with code ${code}`))
// 			} else {
// 				// Process any remaining buffer
// 				if (buffer.trim()) {
// 					// Yield final line
// 				}
// 				resolve()
// 			}
// 		})

// 		gitProcess.on("error", (error) => {
// 			reject(new Error(`Failed to execute git ls-files: ${error.message}`))
// 		})
// 	})
// }

/**
 * Gets all files tracked by git (synchronous version)
 * @param workspacePath Path to the workspace
 * @returns Array of file paths relative to workspace root
 * @throws Error if git command fails
 */
export function getGitTrackedFilesSync(workspacePath: string): string[] {
	try {
		const output = execSync("git ls-files", {
			cwd: workspacePath,
			encoding: "utf8",
			maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large repos
		})

		return output
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
	} catch (error) {
		throw new Error(`Failed to get git tracked files: ${error instanceof Error ? error.message : String(error)}`)
	}
}

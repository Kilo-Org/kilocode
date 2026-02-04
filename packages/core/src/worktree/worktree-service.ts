/**
 * WorktreeService
 *
 * Platform-agnostic service for git worktree operations.
 * Uses simple-git and native CLI commands - no VSCode dependencies.
 */

import { exec, execFile } from "child_process"
import * as path from "path"
import { promisify } from "util"

import type { BranchInfo, CreateWorktreeOptions, Worktree, WorktreeResult } from "./types.js"

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * Service for managing git worktrees.
 * All methods are platform-agnostic and don't depend on VSCode APIs.
 */
export class WorktreeService {
	/**
	 * Check if git is installed on the system
	 */
	async checkGitInstalled(): Promise<boolean> {
		try {
			await execAsync("git --version")
			return true
		} catch {
			return false
		}
	}

	/**
	 * Check if a directory is a git repository.
	 */
	async checkGitRepo(cwd: string): Promise<boolean> {
		try {
			await execAsync("git rev-parse --git-dir", { cwd })
			return true
		} catch {
			return false
		}
	}

	/**
	 * Get the git repository root path.
	 */
	async getGitRootPath(cwd: string): Promise<string | null> {
		try {
			const { stdout } = await execAsync("git rev-parse --show-toplevel", { cwd })
			return stdout.trim()
		} catch {
			return null
		}
	}

	/**
	 * Get the current worktree path.
	 */
	async getCurrentWorktreePath(cwd: string): Promise<string | null> {
		try {
			const { stdout } = await execAsync("git rev-parse --show-toplevel", { cwd })
			return stdout.trim()
		} catch {
			return null
		}
	}

	/**
	 * Get the current branch name.
	 */
	async getCurrentBranch(cwd: string): Promise<string | null> {
		try {
			const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd })
			const branch = stdout.trim()
			return branch === "HEAD" ? null : branch
		} catch {
			return null
		}
	}

	/**
	 * List all worktrees in the repository
	 */
	async listWorktrees(cwd: string): Promise<Worktree[]> {
		try {
			const { stdout } = await execAsync("git worktree list --porcelain", { cwd })
			return this.parseWorktreeOutput(stdout, cwd)
		} catch {
			return []
		}
	}

	/**
	 * Create a new worktree
	 */
	async createWorktree(cwd: string, options: CreateWorktreeOptions): Promise<WorktreeResult> {
		try {
			const { path: worktreePath, branch, baseBranch, createNewBranch } = options

			// Build the git worktree add command arguments
			const args: string[] = ["worktree", "add"]

			if (createNewBranch && branch) {
				// Create new branch: git worktree add -b <branch> <path> [<base>]
				args.push("-b", branch, worktreePath)
				if (baseBranch) {
					args.push(baseBranch)
				}
			} else if (branch) {
				// Checkout existing branch: git worktree add <path> <branch>
				args.push(worktreePath, branch)
			} else {
				// Detached HEAD at current commit
				args.push("--detach", worktreePath)
			}

			await execFileAsync("git", args, { cwd })

			// Get the created worktree info
			const worktrees = await this.listWorktrees(cwd)
			const createdWorktree = worktrees.find(
				(wt) => this.normalizePath(wt.path) === this.normalizePath(worktreePath),
			)

			return {
				success: true,
				message: `Worktree created at ${worktreePath}`,
				worktree: createdWorktree,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			return {
				success: false,
				message: `Failed to create worktree: ${errorMessage}`,
			}
		}
	}

	/**
	 * Delete a worktree
	 */
	async deleteWorktree(cwd: string, worktreePath: string, force = false): Promise<WorktreeResult> {
		try {
			// Get worktree info BEFORE deletion to capture the branch name
			const worktrees = await this.listWorktrees(cwd)
			const worktreeToDelete = worktrees.find(
				(wt) => this.normalizePath(wt.path) === this.normalizePath(worktreePath),
			)

			const args = ["worktree", "remove"]
			if (force) {
				args.push("--force")
			}
			args.push(worktreePath)
			await execFileAsync("git", args, { cwd })

			// Also try to delete the branch if it exists
			if (worktreeToDelete?.branch) {
				try {
					await execFileAsync("git", ["branch", "-d", worktreeToDelete.branch], { cwd })
				} catch {
					// Branch deletion is best-effort
				}
			}

			return {
				success: true,
				message: `Worktree removed from ${worktreePath}`,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			return {
				success: false,
				message: `Failed to delete worktree: ${errorMessage}`,
			}
		}
	}

	/**
	 * Get available branches
	 * @param cwd - Current working directory
	 * @param includeWorktreeBranches - If true, include branches already checked out in worktrees (useful for base branch selection)
	 */
	async getAvailableBranches(cwd: string, includeWorktreeBranches = false): Promise<BranchInfo> {
		try {
			// Run all git commands in parallel for better performance
			const [worktrees, localResult, remoteResult, currentBranch] = await Promise.all([
				this.listWorktrees(cwd),
				execAsync('git branch --format="%(refname:short)"', { cwd }),
				execAsync('git branch -r --format="%(refname:short)"', { cwd }),
				this.getCurrentBranch(cwd),
			])

			const branchesInWorktrees = new Set(worktrees.map((wt) => wt.branch).filter(Boolean))

			// Filter local branches
			const localBranches = localResult.stdout
				.trim()
				.split("\n")
				.filter((b) => b && (includeWorktreeBranches || !branchesInWorktrees.has(b)))

			// Filter remote branches
			const remoteBranches = remoteResult.stdout
				.trim()
				.split("\n")
				.filter(
					(b) =>
						b &&
						!b.includes("HEAD") &&
						(includeWorktreeBranches || !branchesInWorktrees.has(b.replace(/^origin\//, ""))),
				)

			return {
				localBranches,
				remoteBranches,
				currentBranch: currentBranch || "",
			}
		} catch {
			return {
				localBranches: [],
				remoteBranches: [],
				currentBranch: "",
			}
		}
	}

	/**
	 * Checkout a branch in the current worktree
	 */
	async checkoutBranch(cwd: string, branch: string): Promise<WorktreeResult> {
		try {
			await execFileAsync("git", ["checkout", branch], { cwd })
			return {
				success: true,
				message: `Checked out branch ${branch}`,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			return {
				success: false,
				message: `Failed to checkout branch: ${errorMessage}`,
			}
		}
	}

	/**
	 * Parse git worktree list --porcelain output
	 */
	private parseWorktreeOutput(output: string, currentCwd: string): Worktree[] {
		const worktrees: Worktree[] = []
		const entries = output.trim().split("\n\n")

		for (const entry of entries) {
			if (!entry.trim()) continue

			const lines = entry.trim().split("\n")
			const worktree: Partial<Worktree> = {
				path: "",
				branch: "",
				commitHash: "",
				isCurrent: false,
				isBare: false,
				isDetached: false,
				isLocked: false,
			}

			for (const line of lines) {
				if (line.startsWith("worktree ")) {
					worktree.path = line.substring(9).trim()
				} else if (line.startsWith("HEAD ")) {
					worktree.commitHash = line.substring(5).trim()
				} else if (line.startsWith("branch ")) {
					// branch refs/heads/main -> main
					const branchRef = line.substring(7).trim()
					worktree.branch = branchRef.replace(/^refs\/heads\//, "")
				} else if (line === "bare") {
					worktree.isBare = true
				} else if (line === "detached") {
					worktree.isDetached = true
				} else if (line === "locked") {
					worktree.isLocked = true
				} else if (line.startsWith("locked ")) {
					worktree.isLocked = true
					worktree.lockReason = line.substring(7).trim()
				}
			}

			if (worktree.path) {
				worktree.isCurrent = this.normalizePath(worktree.path) === this.normalizePath(currentCwd)
				worktrees.push(worktree as Worktree)
			}
		}

		return worktrees
	}

	/**
	 * Normalize a path for comparison (handle trailing slashes, etc.)
	 */
	private normalizePath(p: string): string {
		// normalize resolves ./.. segments, removes duplicate slashes, and standardizes path separators
		let normalized = path.normalize(p)
		// however it doesn't remove trailing slashes
		// remove trailing slash, except for root paths (handles both / and \)
		if (normalized.length > 1 && (normalized.endsWith("/") || normalized.endsWith("\\"))) {
			normalized = normalized.slice(0, -1)
		}
		return normalized
	}
}

// Export singleton instance for convenience
export const worktreeService = new WorktreeService()

/**
 * WorktreeManager - Manages git worktrees for agent sessions
 *
 * Handles creation, discovery, commit, and cleanup of worktrees
 * stored in {projectRoot}/.kilocode/worktrees/
 */

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import simpleGit, { SimpleGit } from "simple-git"

export interface WorktreeInfo {
	branch: string
	path: string
	parentBranch: string
	createdAt: number
}

export interface CreateWorktreeResult {
	branch: string
	path: string
	parentBranch: string
}

export interface CommitResult {
	success: boolean
	skipped?: boolean
	reason?: string
	error?: string
}

export class WorktreeError extends Error {
	constructor(
		public readonly code: string,
		message: string,
	) {
		super(message)
		this.name = "WorktreeError"
	}
}

/**
 * Generate a valid git branch name from a prompt.
 * Exported for testing.
 */
export function generateBranchName(prompt: string): string {
	const sanitized = prompt
		.slice(0, 50)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-")

	const timestamp = Date.now()
	return `${sanitized || "kilo"}-${timestamp}`
}

export class WorktreeManager {
	private readonly projectRoot: string
	private readonly worktreesDir: string
	private readonly git: SimpleGit
	private readonly outputChannel: vscode.OutputChannel

	constructor(projectRoot: string, outputChannel: vscode.OutputChannel) {
		this.projectRoot = projectRoot
		this.worktreesDir = path.join(projectRoot, ".kilocode", "worktrees")
		this.git = simpleGit(projectRoot)
		this.outputChannel = outputChannel
	}

	/**
	 * Create a new worktree for an agent session
	 */
	async createWorktree(params: { prompt?: string; existingBranch?: string }): Promise<CreateWorktreeResult> {
		const isRepo = await this.git.checkIsRepo()
		if (!isRepo) {
			throw new WorktreeError("NOT_GIT_REPO", "Workspace is not a git repository")
		}

		await this.ensureWorktreesDir()
		await this.ensureGitExclude()

		const parentBranch = await this.getCurrentBranch()

		let branch: string
		if (params.existingBranch) {
			const exists = await this.branchExists(params.existingBranch)
			if (!exists) {
				throw new WorktreeError("BRANCH_NOT_FOUND", `Branch "${params.existingBranch}" does not exist`)
			}
			branch = params.existingBranch
		} else {
			branch = generateBranchName(params.prompt || "agent-task")
		}

		let worktreePath = path.join(this.worktreesDir, branch)

		if (fs.existsSync(worktreePath)) {
			this.log(`Worktree directory exists, removing: ${worktreePath}`)
			await fs.promises.rm(worktreePath, { recursive: true, force: true })
		}

		try {
			const args = params.existingBranch
				? ["worktree", "add", worktreePath, branch]
				: ["worktree", "add", "-b", branch, worktreePath]

			await this.git.raw(args)
			this.log(`Created worktree at: ${worktreePath} (branch: ${branch})`)
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)

			if (errorMsg.includes("already exists")) {
				const newBranch = `${branch}-${Date.now()}`
				worktreePath = path.join(this.worktreesDir, newBranch)
				this.log(`Branch exists, retrying with: ${newBranch}`)

				await this.git.raw(["worktree", "add", "-b", newBranch, worktreePath])
				branch = newBranch
				this.log(`Created worktree at: ${worktreePath} (branch: ${branch})`)
			} else {
				throw new WorktreeError("WORKTREE_CREATE_FAILED", `Failed to create worktree: ${errorMsg}`)
			}
		}

		return { branch, path: worktreePath, parentBranch }
	}

	/**
	 * Stage all changes in a worktree.
	 * Returns true if there are staged changes after staging.
	 */
	async stageAllChanges(worktreePath: string): Promise<boolean> {
		const git = simpleGit(worktreePath)

		const status = await git.status()
		if (status.isClean()) {
			this.log("No changes to stage")
			return false
		}

		await git.add("-A")

		// Verify we have staged changes
		const stagedDiff = await git.diff(["--staged"])
		const hasChanges = !!stagedDiff.trim()

		this.log(hasChanges ? "Changes staged successfully" : "No changes after staging")
		return hasChanges
	}

	/**
	 * Check if a worktree has staged changes
	 */
	async hasStagedChanges(worktreePath: string): Promise<boolean> {
		try {
			const git = simpleGit(worktreePath)
			const stagedDiff = await git.diff(["--staged"])
			return !!stagedDiff.trim()
		} catch {
			return false
		}
	}

	/**
	 * Commit staged changes with a message (fallback for when agent doesn't commit)
	 */
	async commitStagedChanges(worktreePath: string, message: string): Promise<CommitResult> {
		try {
			const git = simpleGit(worktreePath)
			await git.commit(message)
			this.log(`Committed changes: ${message}`)
			return { success: true, skipped: false }
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.log(`Commit failed: ${errorMsg}`)
			return { success: false, error: errorMsg }
		}
	}

	/**
	 * Commit all changes in a worktree (stages + commits in one step)
	 * Use this for programmatic commits. For agent-driven commits, use stageAllChanges + AgentTaskRunner.
	 */
	async commitChanges(worktreePath: string, message?: string): Promise<CommitResult> {
		try {
			const hasChanges = await this.stageAllChanges(worktreePath)
			if (!hasChanges) {
				return { success: true, skipped: true, reason: "no_changes" }
			}

			return this.commitStagedChanges(worktreePath, message || "chore: parallel mode task completion")
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.log(`Commit failed: ${errorMsg}`)
			return { success: false, error: errorMsg }
		}
	}

	/**
	 * Remove a worktree (keeps the branch)
	 */
	async removeWorktree(worktreePath: string): Promise<void> {
		try {
			await this.git.raw(["worktree", "remove", worktreePath])
			this.log(`Removed worktree: ${worktreePath}`)
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			this.log(`Warning: Failed to remove worktree: ${errorMsg}, trying force removal`)

			try {
				await this.git.raw(["worktree", "remove", "--force", worktreePath])
				this.log(`Force removed worktree: ${worktreePath}`)
			} catch (forceError) {
				const forceErrorMsg = forceError instanceof Error ? forceError.message : String(forceError)
				this.log(`Failed to force remove worktree: ${forceErrorMsg}`)
			}
		}
	}

	/**
	 * Discover existing worktrees in .kilocode/worktrees/
	 */
	async discoverWorktrees(): Promise<WorktreeInfo[]> {
		if (!fs.existsSync(this.worktreesDir)) {
			return []
		}

		const entries = await fs.promises.readdir(this.worktreesDir, { withFileTypes: true })
		const results = await Promise.all(
			entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => this.getWorktreeInfo(path.join(this.worktreesDir, entry.name))),
		)

		return results.filter((info): info is WorktreeInfo => info !== undefined)
	}

	/**
	 * Get info for a single worktree directory.
	 * Returns undefined if the directory is not a valid worktree or cannot be read.
	 */
	private async getWorktreeInfo(wtPath: string): Promise<WorktreeInfo | undefined> {
		const isWorktree = await this.isValidWorktree(wtPath)
		if (!isWorktree) {
			return undefined
		}

		try {
			const git = simpleGit(wtPath)
			const [branch, stat, parentBranch] = await Promise.all([
				git.revparse(["--abbrev-ref", "HEAD"]),
				fs.promises.stat(wtPath),
				this.getDefaultBranch(),
			])

			return {
				branch: branch.trim(),
				path: wtPath,
				parentBranch,
				createdAt: stat.birthtimeMs,
			}
		} catch (error) {
			this.log(`Failed to get info for worktree ${wtPath}: ${error}`)
			return undefined
		}
	}

	/**
	 * Get diff between worktree HEAD and parent branch
	 */
	async getWorktreeDiff(worktreePath: string, parentBranch: string): Promise<string> {
		const git = simpleGit(worktreePath)
		return git.diff([`${parentBranch}...HEAD`])
	}

	/**
	 * Ensure .kilocode/worktrees/ directory exists
	 */
	private async ensureWorktreesDir(): Promise<void> {
		if (!fs.existsSync(this.worktreesDir)) {
			await fs.promises.mkdir(this.worktreesDir, { recursive: true })
			this.log(`Created worktrees directory: ${this.worktreesDir}`)
		}
	}

	/**
	 * Ensure .kilocode/worktrees/ is excluded from git using .git/info/exclude.
	 * This avoids modifying the user's .gitignore file which would require a commit.
	 */
	async ensureGitExclude(): Promise<void> {
		const entry = ".kilocode/worktrees/"

		const gitDir = await this.resolveGitDir()
		const excludePath = path.join(gitDir, "info", "exclude")

		// Ensure the info directory exists
		const infoDir = path.join(gitDir, "info")
		if (!fs.existsSync(infoDir)) {
			await fs.promises.mkdir(infoDir, { recursive: true })
		}

		let content = ""
		if (fs.existsSync(excludePath)) {
			content = await fs.promises.readFile(excludePath, "utf-8")
			if (content.includes(entry)) return
		}

		const addition = content.endsWith("\n") || content === "" ? "" : "\n"
		const excludeEntry = `${addition}\n# Kilo Code agent worktrees\n${entry}\n`

		await fs.promises.appendFile(excludePath, excludeEntry)
		this.log("Added .kilocode/worktrees/ to .git/info/exclude")
	}

	/**
	 * Resolve the actual .git directory, handling worktrees.
	 * In a worktree, .git is a file containing "gitdir: /path/to/main/.git/worktrees/<name>".
	 * We need to find the main repo's .git directory for the exclude file.
	 * Note: Assumes caller has already verified this is a git repo (via checkIsRepo).
	 */
	private async resolveGitDir(): Promise<string> {
		const gitPath = path.join(this.projectRoot, ".git")
		const stat = await fs.promises.stat(gitPath)

		if (stat.isDirectory()) {
			// Normal repository - .git is a directory
			return gitPath
		}

		// Worktree - .git is a file containing gitdir reference
		const gitFileContent = await fs.promises.readFile(gitPath, "utf-8")
		const match = gitFileContent.match(/^gitdir:\s*(.+)$/m)

		if (!match) {
			throw new WorktreeError("INVALID_GIT_FILE", "Invalid .git file format")
		}

		const worktreeGitDir = match[1].trim()

		// worktreeGitDir is like: /path/to/main/.git/worktrees/<name>
		// We need: /path/to/main/.git
		// Navigate up from worktrees/<name> to .git
		const mainGitDir = path.resolve(path.dirname(gitPath), worktreeGitDir, "..", "..")
		return mainGitDir
	}

	/**
	 * Check if directory is a valid git worktree
	 */
	private async isValidWorktree(dirPath: string): Promise<boolean> {
		const gitFile = path.join(dirPath, ".git")

		if (!fs.existsSync(gitFile)) return false

		try {
			const stat = await fs.promises.stat(gitFile)
			return stat.isFile()
		} catch {
			return false
		}
	}

	/**
	 * Get current branch name
	 */
	private async getCurrentBranch(): Promise<string> {
		const branch = await this.git.revparse(["--abbrev-ref", "HEAD"])
		return branch.trim()
	}

	/**
	 * Check if a branch exists
	 */
	private async branchExists(branchName: string): Promise<boolean> {
		try {
			const branches = await this.git.branch()
			return branches.all.includes(branchName) || branches.all.includes(`remotes/origin/${branchName}`)
		} catch {
			return false
		}
	}

	/**
	 * Get the default branch for this repository.
	 * Tries to detect from remote HEAD, falls back to main/master detection.
	 */
	private async getDefaultBranch(): Promise<string> {
		try {
			// Try to get default branch from origin/HEAD
			const remoteHead = await this.git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"])
			const match = remoteHead.trim().match(/refs\/remotes\/origin\/(.+)$/)
			if (match) {
				return match[1]
			}
		} catch {
			// Remote HEAD not available, fall back to branch detection
		}

		try {
			const branches = await this.git.branch()
			if (branches.all.includes("main")) return "main"
			if (branches.all.includes("master")) return "master"
		} catch {
			// Ignore branch detection errors
		}

		return "main"
	}

	private log(message: string): void {
		this.outputChannel.appendLine(`[WorktreeManager] ${message}`)
	}
}

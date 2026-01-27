import * as vscode from "vscode"
import * as path from "path"
import { promises as fs } from "fs"
import { exec } from "child_process"
import { promisify } from "util"

import type { GitRepositoryInfo, GitCommit } from "@roo-code/types"

import { truncateOutput } from "../integrations/misc/extract-text"

const execAsync = promisify(exec)

const GIT_OUTPUT_LINE_LIMIT = 500

/**
 * Extracts git repository information from the workspace's .git directory
 * @param workspaceRoot The root path of the workspace
 * @returns Git repository information or empty object if not a git repository
 */
export async function getGitRepositoryInfo(workspaceRoot: string): Promise<GitRepositoryInfo> {
	try {
		const gitDir = path.join(workspaceRoot, ".git")

		// Check if .git directory exists
		try {
			await fs.access(gitDir)
		} catch {
			// Not a git repository
			return {}
		}

		const gitInfo: GitRepositoryInfo = {}

		// Try to read git config file
		try {
			const configPath = path.join(gitDir, "config")
			const configContent = await fs.readFile(configPath, "utf8")

			// Very simple approach - just find any URL line
			const urlMatch = configContent.match(/url\s*=\s*(.+?)(?:\r?\n|$)/m)

			if (urlMatch && urlMatch[1]) {
				const url = urlMatch[1].trim()
				// Sanitize the URL and convert to HTTPS format for telemetry
				gitInfo.repositoryUrl = convertGitUrlToHttps(sanitizeGitUrl(url))
				const repositoryName = extractRepositoryName(url)
				if (repositoryName) {
					gitInfo.repositoryName = repositoryName
				}
			}

			// Extract default branch (if available)
			const branchMatch = configContent.match(/\[branch "([^"]+)"\]/i)
			if (branchMatch && branchMatch[1]) {
				gitInfo.defaultBranch = branchMatch[1]
			}
		} catch (error) {
			// Ignore config reading errors
		}

		// Try to read HEAD file to get current branch
		if (!gitInfo.defaultBranch) {
			try {
				const headPath = path.join(gitDir, "HEAD")
				const headContent = await fs.readFile(headPath, "utf8")
				const branchMatch = headContent.match(/ref: refs\/heads\/(.+)/)
				if (branchMatch && branchMatch[1]) {
					gitInfo.defaultBranch = branchMatch[1].trim()
				}
			} catch (error) {
				// Ignore HEAD reading errors
			}
		}

		return gitInfo
	} catch (error) {
		// Return empty object on any error
		return {}
	}
}

/**
 * Converts a git URL to HTTPS format
 * @param url The git URL to convert
 * @returns The URL in HTTPS format, or the original URL if conversion is not possible
 */
export function convertGitUrlToHttps(url: string): string {
	try {
		// Already HTTPS, just return it
		if (url.startsWith("https://")) {
			return url
		}

		// Handle SSH format: git@github.com:user/repo.git -> https://github.com/user/repo.git
		if (url.startsWith("git@")) {
			const match = url.match(/git@([^:]+):(.+)/)
			if (match && match.length === 3) {
				const [, host, path] = match
				return `https://${host}/${path}`
			}
		}

		// Handle SSH with protocol: ssh://git@github.com/user/repo.git -> https://github.com/user/repo.git
		if (url.startsWith("ssh://")) {
			const match = url.match(/ssh:\/\/(?:git@)?([^\/]+)\/(.+)/)
			if (match && match.length === 3) {
				const [, host, path] = match
				return `https://${host}/${path}`
			}
		}

		// Return original URL if we can't convert it
		return url
	} catch {
		// If parsing fails, return original
		return url
	}
}

/**
 * Sanitizes a git URL to remove sensitive information like tokens
 * @param url The original git URL
 * @returns Sanitized URL
 */
export function sanitizeGitUrl(url: string): string {
	try {
		// Remove credentials from HTTPS URLs
		if (url.startsWith("https://")) {
			const urlObj = new URL(url)
			// Remove username and password
			urlObj.username = ""
			urlObj.password = ""
			return urlObj.toString()
		}

		// For SSH URLs, return as-is (they don't contain sensitive tokens)
		if (url.startsWith("git@") || url.startsWith("ssh://")) {
			return url
		}

		// For other formats, return as-is but remove any potential tokens
		return url.replace(/:[a-f0-9]{40,}@/gi, "@")
	} catch {
		// If URL parsing fails, return original (might be SSH format)
		return url
	}
}

/**
 * Extracts repository name from a git URL
 * @param url The git URL
 * @returns Repository name or undefined
 */
export function extractRepositoryName(url: string): string {
	try {
		// Handle different URL formats
		const patterns = [
			// HTTPS: https://github.com/user/repo.git -> user/repo
			/https:\/\/[^\/]+\/([^\/]+\/[^\/]+?)(?:\.git)?$/,
			// SSH: git@github.com:user/repo.git -> user/repo
			/git@[^:]+:([^\/]+\/[^\/]+?)(?:\.git)?$/,
			// SSH with user: ssh://git@github.com/user/repo.git -> user/repo
			/ssh:\/\/[^\/]+\/([^\/]+\/[^\/]+?)(?:\.git)?$/,
		]

		for (const pattern of patterns) {
			const match = url.match(pattern)
			if (match && match[1]) {
				return match[1].replace(/\.git$/, "")
			}
		}

		return ""
	} catch {
		return ""
	}
}

/**
 * Gets git repository information for the current VSCode workspace
 * @returns Git repository information or empty object if not available
 */
export async function getWorkspaceGitInfo(): Promise<GitRepositoryInfo> {
	const workspaceFolders = vscode.workspace.workspaceFolders
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return {}
	}

	// Use the first workspace folder.
	const workspaceRoot = workspaceFolders[0].uri.fsPath
	return getGitRepositoryInfo(workspaceRoot)
}

async function checkGitRepo(cwd: string): Promise<boolean> {
	try {
		await execAsync("git rev-parse --git-dir", { cwd })
		return true
	} catch (error) {
		return false
	}
}

/**
 * Checks if Git is installed on the system by attempting to run git --version
 * @returns {Promise<boolean>} True if Git is installed and accessible, false otherwise
 * @example
 * const isGitInstalled = await checkGitInstalled();
 * if (!isGitInstalled) {
 *   console.log("Git is not installed");
 * }
 */
export async function checkGitInstalled(): Promise<boolean> {
	try {
		await execAsync("git --version")
		return true
	} catch (error) {
		return false
	}
}

export async function searchCommits(query: string, cwd: string): Promise<GitCommit[]> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			console.error("Git is not installed")
			return []
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			console.error("Not a git repository")
			return []
		}

		// Search commits by hash or message, limiting to 10 results
		const { stdout } = await execAsync(
			`git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short ` + `--grep="${query}" --regexp-ignore-case`,
			{ cwd },
		)

		let output = stdout
		if (!output.trim() && /^[a-f0-9]+$/i.test(query)) {
			// If no results from grep search and query looks like a hash, try searching by hash
			const { stdout: hashStdout } = await execAsync(
				`git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short ` + `--author-date-order ${query}`,
				{ cwd },
			).catch(() => ({ stdout: "" }))

			if (!hashStdout.trim()) {
				return []
			}

			output = hashStdout
		}

		const commits: GitCommit[] = []
		const lines = output
			.trim()
			.split("\n")
			.filter((line) => line !== "--")

		for (let i = 0; i < lines.length; i += 5) {
			commits.push({
				hash: lines[i],
				shortHash: lines[i + 1],
				subject: lines[i + 2],
				author: lines[i + 3],
				date: lines[i + 4],
			})
		}

		return commits
	} catch (error) {
		console.error("Error searching commits:", error)
		return []
	}
}

export async function getCommitInfo(hash: string, cwd: string): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return "Git is not installed"
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return "Not a git repository"
		}

		// Get commit info, stats, and diff separately
		const { stdout: info } = await execAsync(`git show --format="%H%n%h%n%s%n%an%n%ad%n%b" --no-patch ${hash}`, {
			cwd,
		})
		const [fullHash, shortHash, subject, author, date, body] = info.trim().split("\n")

		const { stdout: stats } = await execAsync(`git show --stat --format="" ${hash}`, { cwd })

		const { stdout: diff } = await execAsync(`git show --format="" ${hash}`, { cwd })

		const summary = [
			`Commit: ${shortHash} (${fullHash})`,
			`Author: ${author}`,
			`Date: ${date}`,
			`\nMessage: ${subject}`,
			body ? `\nDescription:\n${body}` : "",
			"\nFiles Changed:",
			stats.trim(),
			"\nFull Changes:",
		].join("\n")

		const output = summary + "\n\n" + diff.trim()
		return truncateOutput(output, GIT_OUTPUT_LINE_LIMIT)
	} catch (error) {
		console.error("Error getting commit info:", error)
		return `Failed to get commit info: ${error instanceof Error ? error.message : String(error)}`
	}
}

export async function getWorkingState(cwd: string): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return "Git is not installed"
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return "Not a git repository"
		}

		// Get status of working directory
		const { stdout: status } = await execAsync("git status --short", { cwd })
		if (!status.trim()) {
			return "No changes in working directory"
		}

		// Get all changes (both staged and unstaged) compared to HEAD
		const { stdout: diff } = await execAsync("git diff HEAD", { cwd })
		const lineLimit = GIT_OUTPUT_LINE_LIMIT
		const output = `Working directory changes:\n\n${status}\n\n${diff}`.trim()
		return truncateOutput(output, lineLimit)
	} catch (error) {
		console.error("Error getting working state:", error)
		return `Failed to get working state: ${error instanceof Error ? error.message : String(error)}`
	}
}

/**
 * Gets git status output with configurable file limit
 * @param cwd The working directory to check git status in
 * @param maxFiles Maximum number of file entries to include (0 = disabled)
 * @returns Git status string or null if not a git repository
 */
export async function getGitStatus(cwd: string, maxFiles: number = 20): Promise<string | null> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return null
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return null
		}

		// Use porcelain v1 format with branch info
		const { stdout } = await execAsync("git status --porcelain=v1 --branch", { cwd })

		if (!stdout.trim()) {
			return null
		}

		const lines = stdout.trim().split("\n")

		// First line is always branch info (e.g., "## main...origin/main")
		const branchLine = lines[0]
		const fileLines = lines.slice(1)

		// Build output with branch info and limited file entries
		const output: string[] = [branchLine]

		if (maxFiles > 0 && fileLines.length > 0) {
			const filesToShow = fileLines.slice(0, maxFiles)
			output.push(...filesToShow)

			// Add truncation notice if needed
			if (fileLines.length > maxFiles) {
				output.push(`... ${fileLines.length - maxFiles} more files`)
			}
		}

		return output.join("\n")
	} catch (error) {
		console.error("Error getting git status:", error)
		return null
	}
}

/**
 * Gets the current branch name
 * @param cwd The working directory to check the current branch in
 * @returns The current branch name, or undefined if not a git repository or in detached HEAD state
 */
export async function getCurrentBranch(cwd: string): Promise<string | undefined> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return undefined
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return undefined
		}

		const { stdout } = await execAsync("git branch --show-current", { cwd })
		const branch = stdout.trim()
		return branch.length > 0 ? branch : undefined
	} catch (error) {
		console.error("Error getting current branch:", error)
		return undefined
	}
}

// kilocode_change start - Review mode git utilities

/**
 * File change info from git status or diff
 */
export interface GitFileChange {
	/** File path relative to repository root */
	path: string
	/** Git status code (M, A, D, R, C, U, ?) */
	status: string
	/** Original path for renamed files */
	oldPath?: string
}

/**
 * Detects the base branch (main/master/develop) from remote or local branches
 * @param cwd The working directory
 * @returns The detected base branch name (defaults to "main" if detection fails)
 */
export async function detectBaseBranch(cwd: string): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return "main"
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return "main"
		}

		// Try to get the default branch from remote
		try {
			const { stdout } = await execAsync("git symbolic-ref refs/remotes/origin/HEAD", { cwd })
			const remoteBranch = stdout.trim().replace(/^refs\/remotes\/origin\//, "")
			if (remoteBranch) {
				return remoteBranch
			}
		} catch {
			// Remote HEAD not set, continue with fallback
		}

		// Fallback: check which common base branches exist locally
		const baseBranchCandidates = ["main", "master", "develop", "development"]

		for (const candidate of baseBranchCandidates) {
			try {
				await execAsync(`git rev-parse --verify ${candidate}`, { cwd })
				return candidate
			} catch {
				// Branch doesn't exist, try next
			}
		}

		// Last resort: return "main"
		return "main"
	} catch (error) {
		console.error("Error detecting base branch:", error)
		return "main"
	}
}

/**
 * Checks if there are uncommitted changes (staged or unstaged)
 * @param cwd The working directory
 * @returns True if there are uncommitted changes
 */
export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return false
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return false
		}

		// Check for any changes (staged, unstaged, or untracked)
		const { stdout } = await execAsync("git status --porcelain", { cwd })
		return stdout.trim().length > 0
	} catch (error) {
		console.error("Error checking uncommitted changes:", error)
		return false
	}
}

/**
 * Gets the uncommitted diff (staged + unstaged changes)
 * @param cwd The working directory
 * @returns The diff output or empty string if no changes
 */
export async function getUncommittedDiff(cwd: string): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return ""
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return ""
		}

		// Get diff of all changes compared to HEAD (includes staged and unstaged)
		const { stdout } = await execAsync("git diff HEAD", { cwd, maxBuffer: 10 * 1024 * 1024 })
		return stdout
	} catch (error) {
		console.error("Error getting uncommitted diff:", error)
		return ""
	}
}

/**
 * Gets list of uncommitted files with their status
 * @param cwd The working directory
 * @returns Array of file changes with status
 */
export async function getUncommittedFiles(cwd: string): Promise<GitFileChange[]> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return []
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return []
		}

		// Get porcelain status for parsing
		const { stdout } = await execAsync("git status --porcelain", { cwd })

		if (!stdout.trim()) {
			return []
		}

		const files: GitFileChange[] = []
		const lines = stdout.trim().split("\n")

		for (const line of lines) {
			if (!line || line.length < 3) {
				continue
			}

			// Porcelain format: XY filename
			// X = index status, Y = worktree status
			const statusCode = line.substring(0, 2).trim()
			let filePath = line.substring(3)

			// Handle renamed files (R oldpath -> newpath)
			let oldPath: string | undefined
			if (statusCode.startsWith("R") && filePath.includes(" -> ")) {
				const parts = filePath.split(" -> ")
				oldPath = parts[0]
				filePath = parts[1]
			}

			// Determine the primary status
			let status = statusCode[0] !== " " && statusCode[0] !== "?" ? statusCode[0] : statusCode[1]
			if (statusCode === "??") {
				status = "?"
			}

			files.push({
				path: filePath,
				status,
				...(oldPath && { oldPath }),
			})
		}

		return files
	} catch (error) {
		console.error("Error getting uncommitted files:", error)
		return []
	}
}

/**
 * Resolves a branch name to an existing ref (local or remote)
 * @param cwd The working directory
 * @param branchName The branch name to resolve
 * @returns The resolved ref or null if not found
 */
async function resolveBranchRef(cwd: string, branchName: string): Promise<string | null> {
	const refsToTry = [branchName, `origin/${branchName}`]

	for (const ref of refsToTry) {
		try {
			await execAsync(`git rev-parse --verify ${ref}`, { cwd })
			return ref
		} catch {
			// Ref not found, try next
		}
	}

	return null
}

/**
 * Gets the diff between current branch and base branch
 * @param cwd The working directory
 * @param baseBranch The base branch to compare against
 * @returns The diff output or empty string if no changes
 */
export async function getBranchDiff(cwd: string, baseBranch: string): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return ""
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return ""
		}

		// Resolve branch to local or remote ref
		const resolvedRef = await resolveBranchRef(cwd, baseBranch)
		if (!resolvedRef) {
			console.error(`Could not resolve branch ref: ${baseBranch}`)
			return ""
		}

		// Get diff between base branch and current working directory
		// This includes both committed and uncommitted changes
		const { stdout } = await execAsync(`git diff ${resolvedRef}`, { cwd, maxBuffer: 10 * 1024 * 1024 })
		return stdout
	} catch (error) {
		console.error("Error getting branch diff:", error)
		return ""
	}
}

/**
 * Gets list of files changed between current branch and base branch
 * @param cwd The working directory
 * @param baseBranch The base branch to compare against
 * @returns Array of file changes with status
 */
export async function getBranchFilesChanged(cwd: string, baseBranch: string): Promise<GitFileChange[]> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return []
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return []
		}

		// Resolve branch to local or remote ref
		const resolvedRef = await resolveBranchRef(cwd, baseBranch)
		if (!resolvedRef) {
			console.error(`Could not resolve branch ref: ${baseBranch}`)
			return []
		}

		// Get file list with status using name-status format
		// This includes both committed and uncommitted changes vs base branch
		const { stdout } = await execAsync(`git diff --name-status ${resolvedRef}`, { cwd })

		if (!stdout.trim()) {
			return []
		}

		const files: GitFileChange[] = []
		const lines = stdout.trim().split("\n")

		for (const line of lines) {
			if (!line) {
				continue
			}

			// Format: STATUS\tfilename (or STATUS\toldname\tnewname for renames)
			const parts = line.split("\t")
			if (parts.length < 2) {
				continue
			}

			const status = parts[0][0] // First character is the status
			let filePath = parts[1]
			let oldPath: string | undefined

			// Handle renames (R100\toldpath\tnewpath)
			if (status === "R" && parts.length >= 3) {
				oldPath = parts[1]
				filePath = parts[2]
			}

			files.push({
				path: filePath,
				status,
				...(oldPath && { oldPath }),
			})
		}

		return files
	} catch (error) {
		console.error("Error getting branch files changed:", error)
		return []
	}
}

/**
 * Checks if the current branch is a base branch (main/master/develop)
 * @param cwd The working directory
 * @returns True if current branch is a base branch
 */
export async function isOnBaseBranch(cwd: string): Promise<boolean> {
	try {
		const currentBranch = await getCurrentBranch(cwd)
		if (!currentBranch) {
			return false
		}

		const baseBranches = ["main", "master", "develop", "development"]
		return baseBranches.includes(currentBranch)
	} catch (error) {
		console.error("Error checking if on base branch:", error)
		return false
	}
}

/**
 * Gets the number of commits between current branch and base branch
 * @param cwd The working directory
 * @param baseBranch The base branch to compare against
 * @returns Number of commits ahead of base branch
 */
export async function getCommitCountFromBase(cwd: string, baseBranch: string): Promise<number> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return 0
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return 0
		}

		// Resolve branch to local or remote ref
		const resolvedRef = await resolveBranchRef(cwd, baseBranch)
		if (!resolvedRef) {
			return 0
		}

		const { stdout } = await execAsync(`git rev-list --count ${resolvedRef}..HEAD`, { cwd })
		return parseInt(stdout.trim(), 10) || 0
	} catch (error) {
		console.error("Error getting commit count from base:", error)
		return 0
	}
}

// kilocode_change end

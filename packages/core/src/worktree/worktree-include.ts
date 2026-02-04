/**
 * WorktreeIncludeService
 *
 * Platform-agnostic service for handling .worktreeinclude files.
 * Used to copy untracked files (like node_modules) when creating worktrees.
 */

import { execFile, spawn } from "child_process"
import * as fs from "fs/promises"
import * as path from "path"
import { promisify } from "util"

import ignore, { type Ignore } from "ignore"

import type { WorktreeIncludeStatus } from "./types.js"

/**
 * Progress info for copy tracking.
 * Shows activity without trying to predict total size (which is inaccurate).
 */
export interface CopyProgress {
	/** Current bytes copied */
	bytesCopied: number
	/** Name of current item being copied */
	itemName: string
}

/**
 * Callback for reporting copy progress during worktree file copying.
 */
export type CopyProgressCallback = (progress: CopyProgress) => void

const execFileAsync = promisify(execFile)

/**
 * Service for managing .worktreeinclude files and copying files to new worktrees.
 * All methods are platform-agnostic and don't depend on VSCode APIs.
 */
export class WorktreeIncludeService {
	/**
	 * Check if .worktreeinclude exists in a directory
	 */
	async hasWorktreeInclude(dir: string): Promise<boolean> {
		try {
			await fs.access(path.join(dir, ".worktreeinclude"))
			return true
		} catch {
			return false
		}
	}

	/**
	 * Check if a specific branch has .worktreeinclude file (in git, not local filesystem)
	 * @param cwd - Current working directory (git repo)
	 * @param branch - Branch name to check
	 */
	async branchHasWorktreeInclude(cwd: string, branch: string): Promise<boolean> {
		try {
			const ref = `${branch}:.worktreeinclude`
			// Use git cat-file -e to check if the file exists on the branch (without printing contents)
			await execFileAsync("git", ["cat-file", "-e", "--", ref], { cwd })
			return true
		} catch {
			// File doesn't exist on this branch
			return false
		}
	}

	/**
	 * Get the status of .worktreeinclude and .gitignore
	 */
	async getStatus(dir: string): Promise<WorktreeIncludeStatus> {
		const worktreeIncludePath = path.join(dir, ".worktreeinclude")
		const gitignorePath = path.join(dir, ".gitignore")

		let exists = false
		let hasGitignore = false
		let gitignoreContent: string | undefined

		try {
			await fs.access(worktreeIncludePath)
			exists = true
		} catch {
			exists = false
		}

		try {
			gitignoreContent = await fs.readFile(gitignorePath, "utf-8")
			hasGitignore = true
		} catch {
			hasGitignore = false
		}

		return {
			exists,
			hasGitignore,
			gitignoreContent,
		}
	}

	/**
	 * Create a .worktreeinclude file with the specified content
	 */
	async createWorktreeInclude(dir: string, content: string): Promise<void> {
		await fs.writeFile(path.join(dir, ".worktreeinclude"), content, "utf-8")
	}

	/**
	 * Copy files matching .worktreeinclude patterns from source to target.
	 * Only copies files that are ALSO in .gitignore (to avoid copying tracked files).
	 *
	 * @param sourceDir - The source directory containing the files to copy
	 * @param targetDir - The target directory where files will be copied
	 * @param onProgress - Optional callback to report copy progress (size-based)
	 * @returns Array of copied file/directory paths
	 */
	async copyWorktreeIncludeFiles(
		sourceDir: string,
		targetDir: string,
		onProgress?: CopyProgressCallback,
	): Promise<string[]> {
		const worktreeIncludePath = path.join(sourceDir, ".worktreeinclude")
		const gitignorePath = path.join(sourceDir, ".gitignore")

		// Check if both files exist
		let hasWorktreeInclude = false
		let hasGitignore = false

		try {
			await fs.access(worktreeIncludePath)
			hasWorktreeInclude = true
		} catch {
			hasWorktreeInclude = false
		}

		try {
			await fs.access(gitignorePath)
			hasGitignore = true
		} catch {
			hasGitignore = false
		}

		if (!hasWorktreeInclude || !hasGitignore) {
			return []
		}

		// Parse both files
		const worktreeIncludePatterns = await this.parseIgnoreFile(worktreeIncludePath)
		const gitignorePatterns = await this.parseIgnoreFile(gitignorePath)

		if (worktreeIncludePatterns.length === 0 || gitignorePatterns.length === 0) {
			return []
		}

		// Create ignore matchers
		const worktreeIncludeMatcher = ignore().add(worktreeIncludePatterns)
		const gitignoreMatcher = ignore().add(gitignorePatterns)

		// Find items that match BOTH patterns (intersection)
		const itemsToCopy = await this.findMatchingItems(sourceDir, worktreeIncludeMatcher, gitignoreMatcher)

		if (itemsToCopy.length === 0) {
			return []
		}

		let bytesCopied = 0

		// Report initial progress
		if (onProgress && itemsToCopy.length > 0) {
			onProgress({ bytesCopied: 0, itemName: itemsToCopy[0]! })
		}

		// Copy the items with progress tracking (no total size calculation)
		const copiedItems: string[] = []
		for (const item of itemsToCopy) {
			const sourcePath = path.join(sourceDir, item)
			const targetPath = path.join(targetDir, item)

			try {
				const stats = await fs.stat(sourcePath)

				if (stats.isDirectory()) {
					// Copy directory with progress tracking
					bytesCopied = await this.copyDirectoryWithProgress(
						sourcePath,
						targetPath,
						item,
						bytesCopied,
						onProgress,
					)
				} else {
					// Report progress before copying
					onProgress?.({ bytesCopied, itemName: item })

					// Ensure parent directory exists
					await fs.mkdir(path.dirname(targetPath), { recursive: true })
					await fs.copyFile(sourcePath, targetPath)

					// Update bytes copied
					bytesCopied += this.getSizeOnDisk(stats)
				}

				copiedItems.push(item)

				// Report progress after copying
				onProgress?.({ bytesCopied, itemName: item })
			} catch (error) {
				// Log but don't fail on individual copy errors
				console.error(`Failed to copy ${item}:`, error)
			}
		}

		return copiedItems
	}

	/**
	 * Get the size on disk of a file (accounts for filesystem block allocation).
	 * Uses blksize to calculate actual disk usage including block overhead.
	 */
	private getSizeOnDisk(stats: { size: number; blksize?: number }): number {
		// Calculate size on disk using filesystem block size
		if (stats.blksize !== undefined && stats.blksize > 0) {
			return stats.blksize * Math.ceil(stats.size / stats.blksize)
		}
		// Fallback to logical size when blksize not available
		return stats.size
	}

	/**
	 * Get the total size on disk of a file or directory (recursively).
	 * Uses native Node.js fs operations for cross-platform compatibility.
	 */
	private async getPathSize(targetPath: string): Promise<number> {
		try {
			const stats = await fs.stat(targetPath)

			if (stats.isFile()) {
				return this.getSizeOnDisk(stats)
			}

			if (stats.isDirectory()) {
				return await this.getDirectorySizeRecursive(targetPath)
			}

			return 0
		} catch {
			return 0
		}
	}

	/**
	 * Recursively calculate directory size on disk using Node.js fs.
	 * Uses parallel processing for better performance on large directories.
	 */
	private async getDirectorySizeRecursive(dirPath: string): Promise<number> {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true })
			const sizes = await Promise.all(
				entries.map(async (entry) => {
					const entryPath = path.join(dirPath, entry.name)
					try {
						if (entry.isFile()) {
							const stats = await fs.stat(entryPath)
							return this.getSizeOnDisk(stats)
						} else if (entry.isDirectory()) {
							return await this.getDirectorySizeRecursive(entryPath)
						}
						return 0
					} catch {
						return 0 // Skip inaccessible files
					}
				}),
			)
			return sizes.reduce((sum, size) => sum + size, 0)
		} catch {
			return 0
		}
	}

	/**
	 * Get the current size of a directory (for progress tracking).
	 */
	private async getCurrentDirectorySize(dirPath: string): Promise<number> {
		try {
			await fs.access(dirPath)
			return await this.getDirectorySizeRecursive(dirPath)
		} catch {
			return 0
		}
	}

	/**
	 * Copy directory with progress polling using native cp command.
	 * Starts native copy and polls target directory size to report progress.
	 * Returns the updated bytesCopied count.
	 */
	private async copyDirectoryWithProgress(
		source: string,
		target: string,
		itemName: string,
		bytesCopiedBefore: number,
		onProgress?: CopyProgressCallback,
	): Promise<number> {
		// Ensure parent directory exists
		await fs.mkdir(path.dirname(target), { recursive: true })

		const isWindows = process.platform === "win32"

		// Start the copy process
		const copyPromise = new Promise<void>((resolve, reject) => {
			let proc: ReturnType<typeof spawn>

			if (isWindows) {
				proc = spawn("robocopy", [source, target, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"], {
					windowsHide: true,
				})
			} else {
				proc = spawn("cp", ["-r", "--", source, target])
			}

			proc.on("close", (code) => {
				if (isWindows) {
					// robocopy returns non-zero for success (values < 8)
					if (code !== null && code < 8) {
						resolve()
					} else {
						reject(new Error(`robocopy failed with code ${code}`))
					}
				} else {
					if (code === 0) {
						resolve()
					} else {
						reject(new Error(`cp failed with code ${code}`))
					}
				}
			})

			proc.on("error", reject)
		})

		// Poll progress while copying
		const pollInterval = 500 // Poll every 500ms
		let polling = true

		const pollProgress = async () => {
			while (polling) {
				const currentSize = await this.getCurrentDirectorySize(target)
				const totalCopied = bytesCopiedBefore + currentSize

				onProgress?.({
					bytesCopied: totalCopied,
					itemName,
				})

				await new Promise((resolve) => setTimeout(resolve, pollInterval))
			}
		}

		// Start polling and wait for copy to complete
		const pollPromise = pollProgress()

		try {
			await copyPromise
		} finally {
			polling = false
			// Wait for final poll iteration to complete
			await pollPromise.catch(() => {})
		}

		// Get the final size of the copied directory
		const finalSize = await this.getPathSize(target)
		return bytesCopiedBefore + finalSize
	}

	/**
	 * Parse a .gitignore-style file and return the patterns
	 */
	private async parseIgnoreFile(filePath: string): Promise<string[]> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			return content
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#"))
		} catch {
			return []
		}
	}

	/**
	 * Find items in sourceDir that match both matchers
	 */
	private async findMatchingItems(
		sourceDir: string,
		includeMatcher: Ignore,
		gitignoreMatcher: Ignore,
	): Promise<string[]> {
		const matchingItems: string[] = []

		try {
			const entries = await fs.readdir(sourceDir, { withFileTypes: true })

			for (const entry of entries) {
				const relativePath = entry.name

				// Skip .git directory
				if (relativePath === ".git") continue

				// Check if this path matches both patterns
				// For .worktreeinclude, we want items that are "ignored" (matched)
				// For .gitignore, we want items that are "ignored" (matched)
				const matchesWorktreeInclude = includeMatcher.ignores(relativePath)
				const matchesGitignore = gitignoreMatcher.ignores(relativePath)

				if (matchesWorktreeInclude && matchesGitignore) {
					matchingItems.push(relativePath)
				}
			}
		} catch {
			return []
		}

		return matchingItems
	}
}

// Export singleton instance for convenience
export const worktreeIncludeService = new WorktreeIncludeService()

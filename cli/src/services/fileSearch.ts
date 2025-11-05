/**
 * File Search Service
 * Provides file searching functionality with gitignore support and caching
 */

import fg from "fast-glob"
import { Fzf } from "fzf"
import ignore from "ignore"
import fs from "fs/promises"
import path from "path"

export interface FileSearchResult {
	/** Relative path from workspace root */
	path: string
	/** Type of the entry */
	type: "file" | "folder"
	/** Base name of the file/folder */
	basename: string
	/** Parent directory path */
	dirname: string
}

/**
 * File Search Service
 * Handles searching workspace files with caching and gitignore support
 */
class FileSearchService {
	/** Cache of file listings per workspace */
	private cache = new Map<string, FileSearchResult[]>()

	/** Cache timestamp per workspace */
	private cacheTimestamp = new Map<string, number>()

	/** Cache TTL in milliseconds (5 minutes) */
	private readonly CACHE_TTL = 5 * 60 * 1000

	/**
	 * Search files matching query with fuzzy matching
	 * @param query Search query string
	 * @param cwd Current working directory (workspace root)
	 * @param maxResults Maximum number of results to return (default: 50)
	 * @returns Array of matching file search results
	 */
	async searchFiles(query: string, cwd: string, maxResults = 50): Promise<FileSearchResult[]> {
		// Get all files (cached)
		const allFiles = await this.getAllFiles(cwd)

		if (!query) {
			// Return first N files if no query
			return allFiles.slice(0, maxResults)
		}

		// Use fuzzy search
		const fzf = new Fzf(allFiles, {
			selector: (item) => item.basename + " " + item.path,
		})

		const results = fzf.find(query)
		return results.slice(0, maxResults).map((r) => r.item)
	}

	/**
	 * Load and parse .gitignore file
	 * @param cwd Current working directory
	 * @returns Ignore instance or null if no .gitignore
	 */
	private async loadGitignore(cwd: string): Promise<ReturnType<typeof ignore> | null> {
		const gitignorePath = path.join(cwd, ".gitignore")

		try {
			const gitignoreContent = await fs.readFile(gitignorePath, "utf-8")
			const ig = ignore()
			ig.add(gitignoreContent)
			return ig
		} catch {
			// No .gitignore file or can't read it
			return null
		}
	}

	/**
	 * Get all files in workspace (with caching)
	 * @param cwd Current working directory (workspace root)
	 * @returns Array of all file search results
	 */
	async getAllFiles(cwd: string): Promise<FileSearchResult[]> {
		// Check if cache is valid
		const cachedTime = this.cacheTimestamp.get(cwd)
		if (cachedTime && Date.now() - cachedTime < this.CACHE_TTL) {
			const cached = this.cache.get(cwd)
			if (cached) {
				return cached
			}
		}

		// Load .gitignore patterns
		const ig = await this.loadGitignore(cwd)

		// Search with fast-glob
		const entries = await fg("**/*", {
			cwd,
			dot: false, // Don't include hidden files
			followSymbolicLinks: false,
			markDirectories: true, // Add trailing slash to directories
			stats: false, // We don't need file stats
			onlyFiles: false, // Include both files and directories
		})

		// Process and filter results
		const results: FileSearchResult[] = entries
			.map((entry: string): FileSearchResult => {
				const isFolder = entry.endsWith("/")
				const filePath = isFolder ? entry.slice(0, -1) : entry
				const parts = filePath.split("/")
				const basename = parts[parts.length - 1] || filePath
				const dirname = parts.slice(0, -1).join("/") || ""

				return {
					path: filePath,
					type: isFolder ? ("folder" as const) : ("file" as const),
					basename,
					dirname,
				}
			})
			.filter((result: FileSearchResult) => {
				// Filter out gitignored paths if we have .gitignore
				if (ig) {
					// Check if the path is ignored
					return !ig.ignores(result.path)
				}
				return true
			})

		// Cache results
		this.cache.set(cwd, results)
		this.cacheTimestamp.set(cwd, Date.now())

		return results
	}

	/**
	 * Clear cache for specific workspace or all workspaces
	 * @param cwd Optional workspace to clear, if not provided clears all
	 */
	clearCache(cwd?: string): void {
		if (cwd) {
			this.cache.delete(cwd)
			this.cacheTimestamp.delete(cwd)
		} else {
			this.cache.clear()
			this.cacheTimestamp.clear()
		}
	}

	/**
	 * Invalidate cache for a specific workspace
	 * @param cwd Workspace to invalidate
	 */
	invalidateCache(cwd: string): void {
		this.clearCache(cwd)
	}
}

/** Singleton instance of the file search service */
export const fileSearchService = new FileSearchService()

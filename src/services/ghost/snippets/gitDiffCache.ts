/**
 * Git Diff Cache
 * Based on Continue's gitDiffCache.ts for caching git diff information
 */

import * as vscode from "vscode"

type GetDiffFn = () => Promise<string[]>

/**
 * Singleton cache for git diff information with time-based invalidation
 */
export class GitDiffCache {
	private static instance: GitDiffCache | null = null
	private cachedDiff: string[] | undefined = undefined
	private lastFetchTime: number = 0
	private pendingRequest: Promise<string[]> | null = null
	private getDiffFn: GetDiffFn
	private cacheTimeMs: number

	private constructor(getDiffFn: GetDiffFn, cacheTimeSeconds: number = 60) {
		this.getDiffFn = getDiffFn
		this.cacheTimeMs = cacheTimeSeconds * 1000
	}

	public static getInstance(getDiffFn: GetDiffFn, cacheTimeSeconds?: number): GitDiffCache {
		if (!GitDiffCache.instance) {
			GitDiffCache.instance = new GitDiffCache(getDiffFn, cacheTimeSeconds)
		}
		return GitDiffCache.instance
	}

	private async getDiffPromise(): Promise<string[]> {
		try {
			const diff = await this.getDiffFn()
			this.cachedDiff = diff
			this.lastFetchTime = Date.now()
			return this.cachedDiff
		} catch (e) {
			console.error("Error fetching git diff:", e)
			return []
		} finally {
			this.pendingRequest = null
		}
	}

	public async get(): Promise<string[]> {
		if (this.cachedDiff !== undefined && Date.now() - this.lastFetchTime < this.cacheTimeMs) {
			return this.cachedDiff
		}

		// If there's already a request in progress, return that instead of starting a new one
		if (this.pendingRequest) {
			return this.pendingRequest
		}

		this.pendingRequest = this.getDiffPromise()
		return this.pendingRequest
	}

	public invalidate(): void {
		this.cachedDiff = undefined
		this.pendingRequest = null
	}
}

/**
 * Factory to make diff cache more testable
 */
export function getDiffFn(): GetDiffFn {
	return async () => {
		try {
			// Use VSCode's git extension to get diff
			const gitExtension = vscode.extensions.getExtension("vscode.git")
			if (!gitExtension?.exports?.getAPI) {
				return []
			}

			const git = gitExtension.exports.getAPI(1)
			if (!git.repositories || git.repositories.length === 0) {
				return []
			}

			const repo = git.repositories[0]
			if (!repo) {
				return []
			}

			// Get staged and unstaged changes
			const changes = [...repo.state.indexChanges, ...repo.state.workingTreeChanges]
			const diffs: string[] = []

			for (const change of changes.slice(0, 10)) {
				// Limit to 10 changes
				try {
					if (change.uri && change.uri.scheme === "file") {
						// Get diff for this file
						const diff = await repo.diffWithHEAD(change.uri.fsPath)
						if (diff && diff.trim().length > 0) {
							diffs.push(diff)
						}
					}
				} catch (error) {
					// Skip files that can't be diffed
				}
			}

			return diffs
		} catch (error) {
			console.warn("Failed to get git diff:", error)
			return []
		}
	}
}

/**
 * Get diffs from cache
 */
export async function getDiffsFromCache(): Promise<string[]> {
	const diffCache = GitDiffCache.getInstance(getDiffFn())
	return await diffCache.get()
}

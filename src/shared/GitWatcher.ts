// kilocode_change - new file
/**
 * GitWatcher - Monitors git repository state and emits events
 *
 * This module provides a lightweight git watcher that:
 * - Emits events for scan lifecycle (start/end)
 * - Emits events for file changes (added/modified) with git hashes
 * - Emits events for file deletions
 * - Monitors git state changes (commits, branch switches)
 * - Supports delta-based scanning on feature branches
 * - Implements vscode.Disposable for proper cleanup
 */

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { EventEmitter } from "events"
import { execGetLines } from "./utils/exec"
import {
	getCurrentBranch,
	getCurrentCommitSha,
	getGitHeadPath,
	isDetachedHead,
	getBaseBranch,
	getGitDiff,
} from "../services/code-index/managed/git-utils"

/**
 * Configuration for GitWatcher
 */
export interface GitWatcherConfig {
	/**
	 * Working directory (git repository root)
	 */
	cwd: string

	/**
	 * Optional override for the default branch name
	 * If not provided, will be determined automatically
	 */
	defaultBranchOverride?: string
}

/**
 * Represents a file in the git repository
 */
export type GitWatcherFile =
	| { type: "file"; filePath: string; fileHash: string }
	| { type: "file-deleted"; filePath: string }

/**
 * Base event data shared by all GitWatcher events
 */
interface GitWatcherBaseEvent {
	/**
	 * Current branch name
	 */
	branch: string

	/**
	 * Whether or not the event is coming from the base branch
	 */
	isBaseBranch: boolean

	/**
	 * Current instance which emitted the event
	 */
	watcher: GitWatcher

	/**
	 * Async iterable that yields files affected by this event
	 */
	files: AsyncIterable<GitWatcherFile>
}

/**
 * Event emitted when the branch changes
 */
export interface GitWatcherBranchChangedEvent extends GitWatcherBaseEvent {
	type: "branch-changed"
	/**
	 * The previous branch name
	 */
	previousBranch: string
	/**
	 * The new branch name
	 */
	newBranch: string
}

/**
 * Event emitted when a commit is detected
 */
export interface GitWatcherCommitEvent extends GitWatcherBaseEvent {
	type: "commit"
	/**
	 * The previous commit SHA
	 */
	previousCommit: string
	/**
	 * The new commit SHA
	 */
	newCommit: string
}

export interface GitWatcherStartEvent extends GitWatcherBaseEvent {
	type: "start"
}

/**
 * Discriminated union of all GitWatcher event types
 */
export type GitWatcherEvent = GitWatcherBranchChangedEvent | GitWatcherCommitEvent | GitWatcherStartEvent

/**
 * @deprecated Use GitWatcherEvent instead. This type alias is provided for backward compatibility.
 */
export type GitWatcherFileEvent = never

/**
 * Git state snapshot for change detection
 */
interface GitStateSnapshot {
	branch: string
	commit: string
	isDetached: boolean
}

export class GitWatcher implements vscode.Disposable {
	private readonly emitter: EventEmitter
	private readonly disposables: vscode.Disposable[] = []
	private currentState: GitStateSnapshot | null = null
	private isProcessing = false
	private defaultBranch: string | null = null

	constructor(public config: GitWatcherConfig) {
		this.config = config
		this.emitter = new EventEmitter()
	}

	/**
	 * Register a handler for all GitWatcher events
	 * @param handler Callback function that receives event data
	 */
	public onEvent(handler: (data: GitWatcherEvent) => void): void {
		this.emitter.on("event", handler)
	}

	/**
	 * Creates an async iterable that yields files from the repository
	 *
	 * Behavior:
	 * - On default/main branch: Yields all tracked files
	 * - On feature branch: Yields only files that differ from default branch
	 */
	public async *getFiles(branch: string, isBaseBranch: boolean): AsyncIterable<GitWatcherFile> {
		try {
			if (isBaseBranch) {
				// On default branch: yield all tracked files
				yield* this.getAllFiles()
			} else {
				// On feature branch: yield only diff files
				const defaultBranch = await this.getDefaultBranch()
				yield* this.getDiffFiles(branch, defaultBranch)
			}
		} catch (error) {
			console.error("[GitWatcher] Error getting files:", error)
			throw error
		}
	}

	/**
	 * Dispose of the watcher and clean up resources
	 */
	public dispose(): void {
		console.log("[GitWatcher] Disposing watcher", {
			cwd: this.config.cwd,
			disposablesCount: this.disposables.length,
		})
		this.emitter.removeAllListeners()
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.disposables.length = 0
	}

	/**
	 * Start monitoring git state changes
	 * Must be called after construction to begin watching for git changes
	 */
	public async start(): Promise<void> {
		try {
			// Get initial git state
			const isDetached = await isDetachedHead(this.config.cwd)

			if (!isDetached) {
				const [branch, commit] = await Promise.all([
					getCurrentBranch(this.config.cwd),
					getCurrentCommitSha(this.config.cwd),
				])
				this.currentState = { branch, commit, isDetached: false }
			}

			// Set up file system watchers for git state changes
			await this.setupGitWatchers()
			if (!this.currentState) {
				return
			}
			const defaultBranch = await this.getDefaultBranch()
			const isBaseBranch = this.currentState.branch === defaultBranch
			this.emitEvent({
				type: "start",
				branch: this.currentState.branch,
				isBaseBranch,
				watcher: this,
				files: this.getFiles(this.currentState.branch, isBaseBranch),
			})
		} catch (error) {
			console.error("[GitWatcher] Failed to initialize watcher:", error)
		}
	}

	/**
	 * Set up file system watchers for git state changes
	 * Uses fs.watchFile (polling) instead of fs.watch because git replaces files
	 * during branch switches, which causes fs.watch to stop working
	 */
	private async setupGitWatchers(): Promise<void> {
		try {
			const gitHeadPath = await getGitHeadPath(this.config.cwd)
			const absoluteGitHeadPath = path.isAbsolute(gitHeadPath)
				? gitHeadPath
				: path.join(this.config.cwd, gitHeadPath)

			// Watch .git/HEAD for branch switches and commits
			// Use fs.watchFile (polling) because git replaces the file during branch switches
			// which causes fs.watch to stop working after the first event
			try {
				fs.watchFile(absoluteGitHeadPath, { interval: 100 }, (curr, prev) => {
					// Only trigger if the file actually changed (mtime or size)
					if (curr.mtime.getTime() !== prev.mtime.getTime() || curr.size !== prev.size) {
						this.handleGitChange("head")
					}
				})
				this.disposables.push(
					new vscode.Disposable(() => {
						fs.unwatchFile(absoluteGitHeadPath)
					}),
				)
			} catch (error) {
				console.warn("[GitWatcher] Could not watch HEAD:", error)
			}

			// Watch branch refs for commits
			// Use fs.watch here since refs are modified in place, not replaced
			try {
				const gitDir = path.dirname(absoluteGitHeadPath)
				const refsHeadsPath = path.join(gitDir, "refs", "heads")

				if (fs.existsSync(refsHeadsPath)) {
					const refsWatcher = fs.watch(refsHeadsPath, { recursive: true }, (eventType, filename) => {
						this.handleGitChange("ref")
					})
					this.disposables.push(
						new vscode.Disposable(() => {
							console.log("[GitWatcher] Closing refs watcher")
							refsWatcher.close()
						}),
					)
				}
			} catch (error) {
				console.warn("[GitWatcher] Could not watch branch refs:", error)
			}

			// Watch packed-refs
			// Use fs.watchFile here too since packed-refs can be replaced
			try {
				const gitDir = path.dirname(absoluteGitHeadPath)
				const packedRefsPath = path.join(gitDir, "packed-refs")

				if (fs.existsSync(packedRefsPath)) {
					fs.watchFile(packedRefsPath, { interval: 1000 }, (curr, prev) => {
						if (curr.mtime.getTime() !== prev.mtime.getTime() || curr.size !== prev.size) {
							this.handleGitChange("packed-refs")
						}
					})
					this.disposables.push(
						new vscode.Disposable(() => {
							fs.unwatchFile(packedRefsPath)
						}),
					)
				}
			} catch (error) {
				console.warn("[GitWatcher] Could not watch packed-refs:", error)
			}
		} catch (error) {
			console.error("[GitWatcher] Failed to setup git watchers:", error)
		}
	}

	/**
	 * Handle git state changes
	 */
	private async handleGitChange(change?: string): Promise<void> {
		// Prevent concurrent execution - fs.watch can fire multiple times for one git operation
		if (this.isProcessing) {
			return
		}

		this.isProcessing = true

		try {
			// Check for detached HEAD
			if (await isDetachedHead(this.config.cwd)) {
				this.currentState = null
				return
			}

			// Get new git state
			const [branch, commit] = await Promise.all([
				getCurrentBranch(this.config.cwd),
				getCurrentCommitSha(this.config.cwd),
			])
			const newState: GitStateSnapshot = { branch, commit, isDetached: false }

			const defaultBranch = await this.getDefaultBranch()
			const isBaseBranch = newState.branch.toLowerCase() === defaultBranch.toLowerCase()

			// Check if state actually changed
			if (this.currentState) {
				const branchChanged = this.currentState.branch !== newState.branch
				const commitChanged = this.currentState.commit !== newState.commit

				if (!branchChanged && !commitChanged) {
					return
				}

				// Emit branch-changed event if branch changed
				if (branchChanged) {
					this.emitEvent({
						type: "branch-changed",
						previousBranch: this.currentState.branch,
						newBranch: newState.branch,
						branch: newState.branch,
						isBaseBranch,
						watcher: this,
						files: this.getFiles(newState.branch, isBaseBranch),
					})
				} else if (commitChanged) {
					// Emit commit event if only commit changed
					this.emitEvent({
						type: "commit",
						previousCommit: this.currentState.commit,
						newCommit: newState.commit,
						branch: newState.branch,
						isBaseBranch,
						watcher: this,
						files: this.getFiles(newState.branch, isBaseBranch),
					})
				}
			} else {
				// First run - emit initial commit event to trigger scan
				this.emitEvent({
					type: "commit",
					previousCommit: "",
					newCommit: newState.commit,
					branch: newState.branch,
					isBaseBranch,
					watcher: this,
					files: this.getFiles(newState.branch, isBaseBranch),
				})
			}

			this.currentState = newState
		} catch (error) {
			console.error("[GitWatcher] Error handling git change:", error)
		} finally {
			this.isProcessing = false
		}
	}

	/**
	 * Get the default branch name
	 */
	public async getDefaultBranch(): Promise<string> {
		if (this.defaultBranch) {
			return this.defaultBranch
		}

		if (this.config.defaultBranchOverride) {
			this.defaultBranch = this.config.defaultBranchOverride
			return this.defaultBranch
		}

		this.defaultBranch = await getBaseBranch(this.config.cwd)
		return this.defaultBranch
	}

	/**
	 * Helper method to emit events
	 * @param event The event data to emit
	 */
	private emitEvent(event: GitWatcherEvent): void {
		this.emitter.emit("event", event)
	}

	/**
	 * Get all tracked files in the repository
	 */
	private async *getAllFiles(): AsyncIterable<GitWatcherFile> {
		// Use git ls-files -s to get all tracked files with their hashes
		for await (const line of execGetLines({
			cmd: "git ls-files -s",
			cwd: this.config.cwd,
			context: "scanning git tracked files",
		})) {
			const trimmed = line.trim()
			if (!trimmed) continue

			// Parse git ls-files -s output
			// Format: <mode> <hash> <stage> <path>
			// Example: 100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0 README.md
			const parts = trimmed.split(/\s+/)
			if (parts.length < 4) continue

			const fileHash = parts[1]
			const filePath = parts.slice(3).join(" ") // Handle paths with spaces

			yield { type: "file", filePath, fileHash }
		}
	}

	/**
	 * Get only files that differ from the default branch
	 */
	private async *getDiffFiles(currentBranch: string, defaultBranch: string): AsyncIterable<GitWatcherFile> {
		// Get the diff between current branch and default branch
		const diff = await getGitDiff(currentBranch, defaultBranch, this.config.cwd)

		// Yield deleted files first
		for (const deletedFile of diff.deleted) {
			yield { type: "file-deleted", filePath: deletedFile }
		}

		// Combine added and modified files (we only care about files that exist)
		const filesToScan = [...diff.added, ...diff.modified]

		if (filesToScan.length === 0) {
			return
		}

		// Process files in batches to avoid exceeding shell argument length limits (E2BIG)
		// On Linux/macOS, the limit is typically ~128KB-2MB depending on system configuration
		const BATCH_SIZE = 50 // Safe number for command line length

		for (let i = 0; i < filesToScan.length; i += BATCH_SIZE) {
			const batch = filesToScan.slice(i, i + BATCH_SIZE)
			yield* this.processBatch(batch)
		}
	}

	/**
	 * Process a batch of files to get their git hashes
	 */
	private async *processBatch(files: string[]): AsyncIterable<GitWatcherFile> {
		// Build command with quoted files to handle spaces
		const quotedFiles = files.map((f) => `"${f}"`).join(" ")
		const cmd = `git ls-files -s ${quotedFiles}`

		// Execute and parse results
		for await (const line of execGetLines({
			cmd,
			cwd: this.config.cwd,
			context: "getting file hashes for diff files",
		})) {
			const trimmed = line.trim()
			if (!trimmed) continue

			// Parse git ls-files -s output
			// Format: <mode> <hash> <stage> <path>
			// Example: 100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0 README.md
			const parts = trimmed.split(/\s+/)
			if (parts.length < 4) continue

			const fileHash = parts[1]
			const filePath = parts.slice(3).join(" ") // Handle paths with spaces

			yield { type: "file", filePath, fileHash }
		}
	}
}

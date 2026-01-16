import { createHash } from "crypto"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import simpleGit from "simple-git"
import { DEFAULT_CONFIG, LOG_SOURCES } from "../config.js"
import type { ILogger } from "../types/ILogger.js"

/**
 * Represents the current git state of a repository.
 */
export interface GitState {
	repoUrl: string | undefined
	head: string
	branch: string | undefined
	patch: string
}

/**
 * Represents the git state needed to restore a repository to a specific point.
 */
export interface GitRestoreState {
	head: string
	patch: string
	branch: string
}

/**
 * Dependencies required by GitStateService.
 */
export interface GitStateServiceDependencies {
	logger: ILogger
	getWorkspaceDir: () => string | null
}

/**
 * Service responsible for git-related operations including
 * capturing and restoring git state.
 */
export class GitStateService {
	private readonly maxPatchSizeBytes: number

	private logger: ILogger
	private getWorkspaceDir: () => string | null

	/**
	 * Creates a new GitStateService instance.
	 *
	 * @param dependencies - Required service dependencies
	 * @param config - Optional configuration overrides for git settings.
	 *                 Defaults to values from DEFAULT_CONFIG.
	 */
	constructor(
		dependencies: GitStateServiceDependencies,
		config: {
			maxPatchSizeBytes?: number
		} = {},
	) {
		this.logger = dependencies.logger
		this.getWorkspaceDir = dependencies.getWorkspaceDir
		this.maxPatchSizeBytes = config.maxPatchSizeBytes ?? DEFAULT_CONFIG.git.maxPatchSizeBytes
	}

	/**
	 * Hashes the git state for change detection.
	 * @param gitState The git state to hash (head, patch, branch)
	 * @returns A SHA-256 hash of the git state
	 */
	hashGitState(gitState: Pick<GitState, "head" | "patch" | "branch">): string {
		return createHash("sha256").update(JSON.stringify(gitState)).digest("hex")
	}

	/**
	 * Gets the current git state including repo URL, HEAD, branch, and patch.
	 * @returns The current git state or null if not in a git repository
	 */
	async getGitState(): Promise<GitState | null> {
		try {
			const cwd = this.getWorkspaceDir() || process.cwd()
			const git = simpleGit(cwd)

			const remotes = await git.getRemotes(true)

			// Get branch name (undefined if detached HEAD)
			let branch: string | undefined
			try {
				const symbolicRef = await git.raw(["symbolic-ref", "-q", "HEAD"])
				branch = symbolicRef.trim().replace(/^refs\/heads\//, "")
			} catch {
				// Detached HEAD - branch remains undefined
			}

			// Determine which remote to use based on branch tracking configuration
			let selectedRemote: (typeof remotes)[0] | undefined
			if (branch) {
				try {
					const trackingRemote = await git.raw(["config", `branch.${branch}.remote`])
					const trackingRemoteName = trackingRemote.trim()
					if (trackingRemoteName) {
						selectedRemote = remotes.find((remote) => remote.name === trackingRemoteName)
					}
				} catch {
					// No tracking remote configured - fall through to fallback
				}
			}

			// Fallback: prefer origin, then first remote
			selectedRemote ??= remotes.find((remote) => remote.name === "origin") ?? remotes[0]

			const repoUrl = selectedRemote?.refs?.fetch ?? selectedRemote?.refs?.push
			const head = await git.revparse(["HEAD"])

			const untrackedOutput = await git.raw(["ls-files", "--others", "--exclude-standard"])
			const untrackedFiles = untrackedOutput.trim().split("\n").filter(Boolean)

			if (untrackedFiles.length > 0) {
				await git.raw(["add", "--intent-to-add", "--", ...untrackedFiles])
			}

			try {
				let patch = await git.diff(["HEAD"])

				if (!patch || patch.trim().length === 0) {
					const parents = await git.raw(["rev-list", "--parents", "-n", "1", "HEAD"])
					const isFirstCommit = parents.trim().split(" ").length === 1

					if (isFirstCommit) {
						const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null"
						const emptyTreeHash = (await git.raw(["hash-object", "-t", "tree", nullDevice])).trim()
						patch = await git.diff([emptyTreeHash, "HEAD"])
					}
				}

				if (patch && patch.length > this.maxPatchSizeBytes) {
					this.logger.warn("Git patch too large", LOG_SOURCES.GIT_STATE, {
						patchSize: patch.length,
						maxSize: this.maxPatchSizeBytes,
					})
					patch = ""
				}

				return {
					repoUrl,
					head,
					branch,
					patch,
				}
			} finally {
				if (untrackedFiles.length > 0) {
					await git.raw(["reset", "HEAD", "--", ...untrackedFiles])
				}
			}
		} catch (error) {
			this.logger.error("Failed to get git state", LOG_SOURCES.GIT_STATE, {
				error: error instanceof Error ? error.message : String(error),
			})

			return null
		}
	}

	/**
	 * Restores git state from a saved state object.
	 * This will:
	 * 1. Stash current work
	 * 2. Checkout to the target commit/branch
	 * 3. Apply the patch from a temp file
	 * 4. Pop the stash
	 * @param gitState The git state to restore
	 */
	async executeGitRestore(gitState: GitRestoreState): Promise<void> {
		try {
			const cwd = this.getWorkspaceDir() || process.cwd()
			const git = simpleGit(cwd)

			let shouldPop = false

			try {
				const stashListBefore = await git.stashList()
				const stashCountBefore = stashListBefore.total

				await git.stash()

				const stashListAfter = await git.stashList()
				const stashCountAfter = stashListAfter.total

				if (stashCountAfter > stashCountBefore) {
					shouldPop = true
					this.logger.debug(`Stashed current work`, LOG_SOURCES.GIT_STATE)
				} else {
					this.logger.debug(`No changes to stash`, LOG_SOURCES.GIT_STATE)
				}
			} catch (error) {
				this.logger.warn(`Failed to stash current work`, LOG_SOURCES.GIT_STATE, {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				const currentHead = await git.revparse(["HEAD"])

				if (currentHead.trim() === gitState.head.trim()) {
					this.logger.debug(`Already at target commit, skipping checkout`, LOG_SOURCES.GIT_STATE, {
						head: gitState.head.substring(0, 8),
					})
				} else {
					if (gitState.branch) {
						try {
							const branchCommit = await git.revparse([gitState.branch])

							if (branchCommit.trim() === gitState.head.trim()) {
								await git.checkout(gitState.branch)

								this.logger.debug(`Checked out to branch`, LOG_SOURCES.GIT_STATE, {
									branch: gitState.branch,
									head: gitState.head.substring(0, 8),
								})
							} else {
								await git.checkout(gitState.head)

								this.logger.debug(
									`Branch moved, checked out to commit (detached HEAD)`,
									LOG_SOURCES.GIT_STATE,
									{
										branch: gitState.branch,
										head: gitState.head.substring(0, 8),
									},
								)
							}
						} catch {
							await git.checkout(gitState.head)

							this.logger.debug(
								`Branch not found, checked out to commit (detached HEAD)`,
								LOG_SOURCES.GIT_STATE,
								{
									branch: gitState.branch,
									head: gitState.head.substring(0, 8),
								},
							)
						}
					} else {
						await git.checkout(gitState.head)

						this.logger.debug(
							`No branch info, checked out to commit (detached HEAD)`,
							LOG_SOURCES.GIT_STATE,
							{
								head: gitState.head.substring(0, 8),
							},
						)
					}
				}
			} catch (error) {
				this.logger.warn(`Failed to checkout`, LOG_SOURCES.GIT_STATE, {
					branch: gitState.branch,
					head: gitState.head.substring(0, 8),
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				const tempDir = mkdtempSync(path.join(tmpdir(), "kilocode-git-patches"))
				const patchFile = path.join(tempDir, `${Date.now()}.patch`)

				try {
					writeFileSync(patchFile, gitState.patch)

					await git.applyPatch(patchFile)

					this.logger.debug(`Applied patch`, LOG_SOURCES.GIT_STATE, {
						patchSize: gitState.patch.length,
					})
				} finally {
					try {
						rmSync(tempDir, { recursive: true, force: true })
					} catch {
						// Ignore error
					}
				}
			} catch (error) {
				this.logger.warn(`Failed to apply patch`, LOG_SOURCES.GIT_STATE, {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				if (shouldPop) {
					await git.stash(["pop"])

					this.logger.debug(`Popped stash`, LOG_SOURCES.GIT_STATE)
				}
			} catch (error) {
				this.logger.warn(`Failed to pop stash`, LOG_SOURCES.GIT_STATE, {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			this.logger.info(`Git state restoration finished`, LOG_SOURCES.GIT_STATE, {
				head: gitState.head.substring(0, 8),
			})
		} catch (error) {
			this.logger.error(`Failed to restore git state`, LOG_SOURCES.GIT_STATE, {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}
}

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "fs"
import path from "path"
import simpleGit from "simple-git"
import { tmpdir } from "os"
import { createHash } from "crypto"
import type { IPathProvider } from "../types/IPathProvider.js"
import type { ILogger } from "../types/ILogger.js"
import type { IExtensionMessenger } from "../types/IExtensionMessenger.js"
import type { ITaskDataProvider } from "../types/ITaskDataProvider.js"
import { SessionClient } from "./SessionClient.js"
import { SessionWithSignedUrls, CliSessionSharedState } from "./SessionClient.js"
import type { ClineMessage, HistoryItem } from "@roo-code/types"
import { TrpcClient, TrpcClientDependencies } from "./TrpcClient.js"
import { SessionPersistenceManager } from "../utils/SessionPersistenceManager.js"
import { fetchSignedBlob } from "../utils/fetchBlobFromSignedUrl.js"

interface SessionCreatedMessage {
	sessionId: string
	timestamp: number
	event: "session_created"
}

/**
 * Message emitted when a session has been synced to the cloud.
 * Contains timing information for tracking sync state and detecting stale data.
 */
interface SessionSyncedMessage {
	sessionId: string
	/** The server-side updated_at timestamp (as Unix milliseconds) from the most recent sync operation */
	updatedAt: number
	/** The local timestamp (Unix milliseconds) when this sync event was emitted */
	timestamp: number
	event: "session_synced"
}

export interface SessionManagerDependencies extends TrpcClientDependencies {
	platform: string
	pathProvider: IPathProvider
	logger: ILogger
	extensionMessenger: IExtensionMessenger
	onSessionCreated?: (message: SessionCreatedMessage) => void
	onSessionRestored?: () => void
	onSessionSynced?: (message: SessionSyncedMessage) => void
}

export class SessionManager {
	static readonly SYNC_INTERVAL = 3000
	static readonly MAX_PATCH_SIZE_BYTES = 5 * 1024 * 1024
	static readonly VERSION = 1
	static readonly QUEUE_FLUSH_THRESHOLD = 5

	private static instance = new SessionManager()

	static init(dependencies?: SessionManagerDependencies) {
		if (dependencies) {
			SessionManager.instance.initDeps(dependencies)
		}

		return SessionManager.instance
	}

	private workspaceDir: string | null = null
	private taskGitUrls: Record<string, string> = {}
	private taskGitHashes: Record<string, string> = {}
	private sessionTitles: Record<string, string> = {}
	private sessionUpdatedAt: Record<string, string> = {}
	private tokenValid: Record<string, boolean | undefined> = {}
	private verifiedSessions: Set<string> = new Set()

	public get sessionId() {
		return this.lastActiveSessionId || this.sessionPersistenceManager?.getLastSession()?.sessionId
	}
	private lastActiveSessionId: string | null = null

	private pathProvider: IPathProvider | undefined
	private logger: ILogger | undefined
	private extensionMessenger: IExtensionMessenger | undefined
	public sessionPersistenceManager: SessionPersistenceManager | undefined
	public sessionClient: SessionClient | undefined
	private onSessionCreated: ((message: SessionCreatedMessage) => void) | undefined
	private onSessionRestored: (() => void) | undefined
	private onSessionSynced: ((message: SessionSyncedMessage) => void) | undefined
	private platform: string | undefined
	private getToken: (() => Promise<string>) | undefined

	private constructor() {}

	private initDeps(dependencies: SessionManagerDependencies) {
		this.pathProvider = dependencies.pathProvider
		this.logger = dependencies.logger
		this.extensionMessenger = dependencies.extensionMessenger
		this.onSessionCreated = dependencies.onSessionCreated ?? (() => {})
		this.onSessionRestored = dependencies.onSessionRestored ?? (() => {})
		this.onSessionSynced = dependencies.onSessionSynced ?? (() => {})
		this.platform = dependencies.platform
		this.getToken = dependencies.getToken

		const trpcClient = new TrpcClient({
			getToken: dependencies.getToken,
		})

		this.sessionClient = new SessionClient(trpcClient)
		this.sessionPersistenceManager = new SessionPersistenceManager(this.pathProvider)

		this.logger.debug("Initialized SessionManager", "SessionManager")
	}

	private pendingSync: Promise<void> | null = null

	private queue = [] as {
		taskId: string
		blobName: string
		blobPath: string
		timestamp: number
	}[]

	handleFileUpdate(taskId: string, key: string, value: string) {
		const blobName = this.pathKeyToBlobKey(key)

		if (blobName) {
			this.queue.push({
				taskId,
				blobName,
				blobPath: value,
				timestamp: Date.now(),
			})
		}

		if (this.queue.length > SessionManager.QUEUE_FLUSH_THRESHOLD) {
			this.doSync()
		}
	}

	setWorkspaceDirectory(dir: string) {
		this.workspaceDir = dir
		this.sessionPersistenceManager?.setWorkspaceDir(dir)
	}

	async restoreLastSession() {
		try {
			if (!this.sessionPersistenceManager) {
				throw new Error("SessionManager used before initialization")
			}

			const lastSession = this.sessionPersistenceManager.getLastSession()

			if (!lastSession?.sessionId) {
				this.logger?.debug("No persisted session ID found", "SessionManager")
				return false
			}

			this.logger?.info("Found persisted session ID, attempting to restore", "SessionManager", {
				sessionId: lastSession.sessionId,
			})

			await this.restoreSession(lastSession.sessionId, true)

			this.logger?.info("Successfully restored persisted session", "SessionManager", {
				sessionId: lastSession.sessionId,
			})
			return true
		} catch (error) {
			this.logger?.warn("Failed to restore persisted session", "SessionManager", {
				error: error instanceof Error ? error.message : String(error),
			})

			return false
		}
	}

	async restoreSession(sessionId: string, rethrowError = false) {
		try {
			this.logger?.info("Restoring session", "SessionManager", { sessionId })

			if (
				!this.pathProvider ||
				!this.sessionClient ||
				!this.extensionMessenger ||
				!this.sessionPersistenceManager
			) {
				throw new Error("SessionManager used before initialization")
			}

			const session = (await this.sessionClient.get({
				session_id: sessionId,
				include_blob_urls: true,
			})) as SessionWithSignedUrls | undefined

			if (!session) {
				this.logger?.error("Failed to obtain session", "SessionManager", { sessionId })
				throw new Error("Failed to obtain session")
			}

			if (session.version !== SessionManager.VERSION) {
				this.logger?.warn("Session version mismatch", "SessionManager", {
					sessionId,
					expectedVersion: SessionManager.VERSION,
					actualVersion: session.version,
				})
			}

			this.logger?.debug("Obtained session", "SessionManager", { sessionId, session })

			const sessionDirectoryPath = path.join(this.pathProvider.getTasksDir(), sessionId)

			mkdirSync(sessionDirectoryPath, { recursive: true })

			const blobUrlFields = [
				"api_conversation_history_blob_url",
				"ui_messages_blob_url",
				"task_metadata_blob_url",
				"git_state_blob_url",
			] as const

			const fetchPromises = blobUrlFields
				.filter((blobUrlField) => {
					const signedUrl = session[blobUrlField]
					if (!signedUrl) {
						this.logger?.debug(`No signed URL for ${blobUrlField}`, "SessionManager")
						return false
					}
					return true
				})
				.map(async (blobUrlField) => {
					const signedUrl = session[blobUrlField]!

					return {
						filename: blobUrlField.replace("_blob_url", ""),
						result: await this.fetchBlobFromSignedUrl(signedUrl, blobUrlField)
							.then((content) => ({ success: true as const, content }))
							.catch((error) => ({
								success: false as const,
								error: error instanceof Error ? error.message : String(error),
							})),
					}
				})

			const results = await Promise.allSettled(fetchPromises)

			for (const result of results) {
				if (result.status === "fulfilled") {
					const { filename, result: fetchResult } = result.value

					if (fetchResult.success) {
						let fileContent = fetchResult.content

						if (filename === "git_state") {
							const gitState = fileContent as Parameters<typeof this.executeGitRestore>[0]

							await this.executeGitRestore(gitState)

							continue
						}

						if (filename === "ui_messages") {
							fileContent = (fileContent as ClineMessage[]).filter(
								(message) => message.say !== "checkpoint_saved",
							)
						}

						const fullPath = path.join(sessionDirectoryPath, `${filename}.json`)

						writeFileSync(fullPath, JSON.stringify(fileContent, null, 2))

						this.logger?.debug(`Wrote blob to file`, "SessionManager", { fullPath })
					} else {
						this.logger?.error(`Failed to process blob`, "SessionManager", {
							filename,
							error: fetchResult.error,
						})
					}
				}
			}

			const historyItem: HistoryItem = {
				id: sessionId,
				number: 1,
				task: session.title,
				ts: new Date(session.created_at).getTime(),
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			this.sessionPersistenceManager.setSessionForTask(historyItem.id, sessionId)
			this.lastActiveSessionId = sessionId
			this.verifiedSessions.add(sessionId)

			await this.extensionMessenger.sendWebviewMessage({
				type: "addTaskToHistory",
				historyItem,
			})

			this.logger?.info("Task registered with extension", "SessionManager", {
				sessionId,
				taskId: historyItem.id,
			})

			await this.extensionMessenger.sendWebviewMessage({
				type: "showTaskWithId",
				text: sessionId,
			})

			this.logger?.info("Switched to restored task", "SessionManager", { sessionId })

			this.sessionPersistenceManager.setLastSession(sessionId)

			this.onSessionRestored?.()

			this.logger?.debug("Marked task as resumed after session restoration", "SessionManager", { sessionId })
		} catch (error) {
			this.logger?.error("Failed to restore session", "SessionManager", {
				error: error instanceof Error ? error.message : String(error),
				sessionId,
			})

			if (rethrowError) {
				throw error
			}
		}
	}

	async shareSession(sessionIdInput?: string) {
		if (!this.sessionClient) {
			throw new Error("SessionManager used before initialization")
		}

		const sessionId = sessionIdInput || this.sessionId

		if (!sessionId) {
			throw new Error("No active session")
		}

		return await this.sessionClient.share({
			session_id: sessionId,
			shared_state: CliSessionSharedState.Public,
		})
	}

	async renameSession(sessionId: string, newTitle: string) {
		if (!this.sessionClient) {
			throw new Error("SessionManager used before initialization")
		}

		if (!sessionId) {
			throw new Error("No active session")
		}

		const trimmedTitle = newTitle.trim()
		if (!trimmedTitle) {
			throw new Error("Session title cannot be empty")
		}

		const updateResult = await this.sessionClient.update({
			session_id: sessionId,
			title: trimmedTitle,
		})

		this.sessionTitles[sessionId] = trimmedTitle
		this.updateSessionTimestamp(sessionId, updateResult.updated_at)

		this.logger?.info("Session renamed successfully", "SessionManager", {
			sessionId,
			newTitle: trimmedTitle,
		})
	}

	async forkSession(shareOrSessionId: string, rethrowError = false) {
		if (!this.platform || !this.sessionClient) {
			throw new Error("SessionManager used before initialization")
		}

		const { session_id } = await this.sessionClient.fork({
			share_or_session_id: shareOrSessionId,
			created_on_platform: this.platform,
		})

		await this.restoreSession(session_id, rethrowError)
	}

	async getSessionFromTask(taskId: string, provider: ITaskDataProvider): Promise<string> {
		try {
			if (!this.platform || !this.sessionClient || !this.sessionPersistenceManager) {
				throw new Error("SessionManager used before initialization")
			}

			let sessionId = this.sessionPersistenceManager.getSessionForTask(taskId)

			if (sessionId) {
				if (!this.verifiedSessions.has(sessionId)) {
					this.logger?.debug("Verifying session existence", "SessionManager", { taskId, sessionId })

					try {
						const session = await this.sessionClient.get({
							session_id: sessionId,
							include_blob_urls: false,
						})

						if (!session) {
							this.logger?.info("Session no longer exists, will create new session", "SessionManager", {
								taskId,
								sessionId,
							})
							sessionId = undefined
						} else {
							this.verifiedSessions.add(sessionId)
							this.logger?.debug("Session verified and cached", "SessionManager", { taskId, sessionId })
						}
					} catch (error) {
						this.logger?.info("Session verification failed, will create new session", "SessionManager", {
							taskId,
							sessionId,
							error: error instanceof Error ? error.message : String(error),
						})
						sessionId = undefined
					}
				} else {
					this.logger?.debug("Session already verified (cached)", "SessionManager", { taskId, sessionId })
				}
			}

			if (!sessionId) {
				this.logger?.debug("No existing session for task, creating new session", "SessionManager", { taskId })

				const { historyItem, apiConversationHistoryFilePath, uiMessagesFilePath } =
					await provider.getTaskWithId(taskId)

				const apiConversationHistory = JSON.parse(readFileSync(apiConversationHistoryFilePath, "utf8"))
				const uiMessages = JSON.parse(readFileSync(uiMessagesFilePath, "utf8"))

				const title = historyItem.task || this.getFirstMessageText(uiMessages, true) || ""

				const session = await this.sessionClient.create({
					title,
					created_on_platform: this.platform,
					version: SessionManager.VERSION,
				})

				sessionId = session.session_id

				this.logger?.info("Created new session for task", "SessionManager", { taskId, sessionId })

				await this.sessionClient.uploadBlob(sessionId, "api_conversation_history", apiConversationHistory)
				await this.sessionClient.uploadBlob(sessionId, "ui_messages", uiMessages)

				this.logger?.debug("Uploaded conversation blobs to session", "SessionManager", { sessionId })

				this.sessionPersistenceManager.setSessionForTask(taskId, sessionId)

				this.verifiedSessions.add(sessionId)
			} else {
				this.logger?.debug("Found existing session for task", "SessionManager", { taskId, sessionId })
			}

			return sessionId
		} catch (error) {
			this.logger?.error("Failed to get or create session from task", "SessionManager", {
				taskId,
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	private async syncSession() {
		if (this.queue.length === 0) {
			return
		}

		if (process.env.KILO_DISABLE_SESSIONS) {
			this.logger?.debug("Sessions disabled via KILO_DISABLE_SESSIONS, clearing queue", "SessionManager")
			this.queue = []
			return
		}

		if (!this.platform || !this.sessionClient || !this.sessionPersistenceManager) {
			this.logger?.error("SessionManager used before initialization", "SessionManager")
			return
		}

		const token = await this.getToken?.()

		if (!token) {
			this.logger?.debug("No token available for session sync, skipping", "SessionManager")
			return
		}

		if (this.tokenValid[token] === undefined) {
			this.logger?.debug("Checking token validity", "SessionManager")

			try {
				const tokenValid = await this.sessionClient.tokenValid()

				this.tokenValid[token] = tokenValid
			} catch (error) {
				this.logger?.error("Failed to check token validity", "SessionManager", {
					error: error instanceof Error ? error.message : String(error),
				})
				return
			}

			this.logger?.debug("Token validity checked", "SessionManager", { tokenValid: this.tokenValid[token] })
		}

		if (!this.tokenValid[token]) {
			this.logger?.debug("Token is invalid, skipping sync", "SessionManager")
			return
		}

		const taskIds = new Set<string>(this.queue.map((item) => item.taskId))
		const lastItem = this.queue[this.queue.length - 1]

		this.logger?.debug("Starting session sync", "SessionManager", {
			queueLength: this.queue.length,
			taskCount: taskIds.size,
		})

		let gitInfo: Awaited<ReturnType<typeof this.getGitState>> | null = null
		try {
			gitInfo = await this.getGitState()
		} catch (error) {
			this.logger?.debug("Could not get git state", "SessionManager", {
				error: error instanceof Error ? error.message : String(error),
			})
		}

		for (const taskId of taskIds) {
			try {
				const taskItems = this.queue.filter((item) => item.taskId === taskId)
				const reversedTaskItems = [...taskItems].reverse()

				this.logger?.debug("Processing task", "SessionManager", {
					taskId,
					itemCount: taskItems.length,
				})

				const basePayload: Partial<Parameters<NonNullable<typeof this.sessionClient>["create"]>[0]> = {}

				if (gitInfo?.repoUrl) {
					basePayload.git_url = gitInfo.repoUrl
				}

				let sessionId = this.sessionPersistenceManager.getSessionForTask(taskId)

				if (sessionId) {
					this.logger?.debug("Found existing session for task", "SessionManager", { taskId, sessionId })

					const gitUrlChanged = !!gitInfo?.repoUrl && gitInfo.repoUrl !== this.taskGitUrls[taskId]

					if (gitUrlChanged && gitInfo?.repoUrl) {
						this.taskGitUrls[taskId] = gitInfo.repoUrl

						this.logger?.debug("Git URL changed, updating session", "SessionManager", {
							sessionId,
							newGitUrl: gitInfo.repoUrl,
						})

						const updateResult = await this.sessionClient.update({
							session_id: sessionId,
							...basePayload,
						})

						this.updateSessionTimestamp(sessionId, updateResult.updated_at)
					}
				} else {
					this.logger?.debug("Creating new session for task", "SessionManager", { taskId })

					const createdSession = await this.sessionClient.create({
						...basePayload,
						created_on_platform: this.platform,
						version: SessionManager.VERSION,
					})

					sessionId = createdSession.session_id

					this.logger?.info("Created new session", "SessionManager", { taskId, sessionId })

					this.sessionPersistenceManager.setSessionForTask(taskId, createdSession.session_id)

					this.onSessionCreated?.({
						timestamp: Date.now(),
						event: "session_created",
						sessionId: createdSession.session_id,
					})
				}

				if (!sessionId) {
					this.logger?.warn("No session ID available after create/get, skipping task", "SessionManager", {
						taskId,
					})
					continue
				}

				const blobNames = new Set(taskItems.map((item) => item.blobName))
				const blobUploads: Promise<unknown>[] = []

				this.logger?.debug("Uploading blobs for session", "SessionManager", {
					sessionId,
					blobNames: Array.from(blobNames),
				})

				for (const blobName of blobNames) {
					const lastBlobItem = reversedTaskItems.find((item) => item.blobName === blobName)

					if (!lastBlobItem) {
						this.logger?.warn("Could not find blob item in reversed list", "SessionManager", {
							blobName,
							taskId,
						})
						continue
					}

					const fileContents = JSON.parse(readFileSync(lastBlobItem.blobPath, "utf-8"))

					blobUploads.push(
						this.sessionClient
							.uploadBlob(
								sessionId,
								lastBlobItem.blobName as Parameters<typeof this.sessionClient.uploadBlob>[1],
								fileContents,
							)
							.then((result) => {
								this.logger?.debug("Blob uploaded successfully", "SessionManager", {
									sessionId,
									blobName,
								})

								// Track the updated_at timestamp from the upload using high-water mark
								this.updateSessionTimestamp(sessionId, result.updated_at)

								for (let i = 0; i < this.queue.length; i++) {
									const item = this.queue[i]

									if (!item) {
										continue
									}

									if (
										item.blobName === blobName &&
										item.taskId === taskId &&
										item.timestamp <= lastBlobItem.timestamp
									) {
										this.queue.splice(i, 1)
										i--
									}
								}
							})
							.catch((error) => {
								this.logger?.error("Failed to upload blob", "SessionManager", {
									sessionId,
									blobName,
									error: error instanceof Error ? error.message : String(error),
								})
							}),
					)

					if (blobName !== "ui_messages" || this.sessionTitles[sessionId]) {
						continue
					}

					this.logger?.debug("Checking for session title generation", "SessionManager", { sessionId })

					void (async () => {
						try {
							if (!this.sessionClient) {
								this.logger?.warn("Session client not initialized", "SessionManager", {
									sessionId,
								})
								return
							}

							this.sessionTitles[sessionId] = "Pending title"

							const session = await this.sessionClient.get({ session_id: sessionId })

							if (session.title) {
								this.sessionTitles[sessionId] = session.title

								this.logger?.debug("Found existing session title", "SessionManager", {
									sessionId,
									title: session.title,
								})

								return
							}

							const generatedTitle = await this.generateTitle(fileContents)

							if (!generatedTitle) {
								throw new Error("Failed to generate session title")
							}

							const updateResult = await this.sessionClient.update({
								session_id: sessionId,
								title: generatedTitle,
							})

							this.sessionTitles[sessionId] = generatedTitle
							this.updateSessionTimestamp(sessionId, updateResult.updated_at)

							this.logger?.debug("Updated session title", "SessionManager", {
								sessionId,
								generatedTitle,
							})
						} catch (error) {
							this.logger?.error("Failed to generate session title", "SessionManager", {
								sessionId,
								error: error instanceof Error ? error.message : String(error),
							})

							const localTitle = this.getFirstMessageText(fileContents as ClineMessage[], true) || ""

							if (!localTitle) {
								return
							}

							try {
								await this.renameSession(sessionId, localTitle)
							} catch (error) {
								this.logger?.error(
									"Failed to update session title using local title",
									"SessionManager",
									{
										sessionId,
										error: error instanceof Error ? error.message : String(error),
									},
								)
							}
						}
					})()
				}

				if (gitInfo) {
					const gitStateData = {
						head: gitInfo.head,
						patch: gitInfo.patch,
						branch: gitInfo.branch,
					}

					const gitStateHash = this.hashGitState(gitStateData)

					if (gitStateHash === this.taskGitHashes[taskId]) {
						this.logger?.debug("Git state unchanged, skipping upload", "SessionManager", { sessionId })
					} else {
						this.logger?.debug("Git state changed, uploading", "SessionManager", {
							sessionId,
							head: gitInfo.head?.substring(0, 8),
						})

						this.taskGitHashes[taskId] = gitStateHash

						blobUploads.push(
							this.sessionClient
								.uploadBlob(sessionId, "git_state", gitStateData)
								.then((result) => {
									// Track the updated_at timestamp from git state upload using high-water mark
									this.updateSessionTimestamp(sessionId, result.updated_at)
								})
								.catch((error) => {
									this.logger?.error("Failed to upload git state", "SessionManager", {
										sessionId,
										error: error instanceof Error ? error.message : String(error),
									})
								}),
						)
					}
				}

				await Promise.all(blobUploads)

				this.logger?.debug("Completed blob uploads for task", "SessionManager", {
					taskId,
					sessionId,
					uploadCount: blobUploads.length,
				})

				// Emit session synced event with the latest updated_at timestamp
				const latestUpdatedAt = this.sessionUpdatedAt[sessionId]
				if (latestUpdatedAt) {
					const updatedAtTimestamp = new Date(latestUpdatedAt).getTime()
					this.onSessionSynced?.({
						sessionId,
						updatedAt: updatedAtTimestamp,
						timestamp: Date.now(),
						event: "session_synced",
					})

					this.logger?.debug("Emitted session_synced event", "SessionManager", {
						sessionId,
						updatedAt: updatedAtTimestamp,
					})
				}
			} catch (error) {
				this.logger?.error("Failed to sync session", "SessionManager", {
					taskId,
					error: error instanceof Error ? error.message : String(error),
				})

				const token = await this.getToken?.()

				if (token) {
					this.tokenValid[token] = undefined
				}
			}
		}

		if (lastItem) {
			this.lastActiveSessionId = this.sessionPersistenceManager.getSessionForTask(lastItem.taskId) || null

			if (this.lastActiveSessionId) {
				this.sessionPersistenceManager.setLastSession(this.lastActiveSessionId)
			}
		}

		this.logger?.debug("Session sync completed", "SessionManager", {
			lastSessionId: this.lastActiveSessionId,
			remainingQueueLength: this.queue.length,
		})
	}

	async doSync(force = false) {
		this.logger?.debug("Doing sync", "SessionManager")

		if (this.pendingSync) {
			this.logger?.debug("Found pending sync", "SessionManager")

			if (!force) {
				this.logger?.debug("Not forced, returning pending sync", "SessionManager")

				return this.pendingSync
			} else {
				this.logger?.debug("Forced, syncing despite pending sync", "SessionManager")
			}
		}

		this.logger?.debug("Creating new sync", "SessionManager")

		this.pendingSync = this.syncSession()

		let pendingSync = this.pendingSync

		void (async () => {
			try {
				await pendingSync
			} finally {
				if (this.pendingSync === pendingSync) {
					this.pendingSync = null
				}

				this.logger?.debug("Nulling pending sync after resolution", "SessionManager")
			}
		})()

		return this.pendingSync
	}

	private async fetchBlobFromSignedUrl(url: string, urlType: string) {
		return fetchSignedBlob(url, urlType, this.logger, "SessionManager")
	}

	/**
	 * Updates the session timestamp using high-water mark logic.
	 * Only updates if the new timestamp is greater than the current one,
	 * preventing race conditions when multiple concurrent uploads complete.
	 */
	private updateSessionTimestamp(sessionId: string, updatedAt: string): void {
		const currentUpdatedAt = this.sessionUpdatedAt[sessionId]
		if (!currentUpdatedAt || updatedAt > currentUpdatedAt) {
			this.sessionUpdatedAt[sessionId] = updatedAt
		}
	}

	private pathKeyToBlobKey(pathKey: string) {
		switch (pathKey) {
			case "apiConversationHistoryPath":
				return "api_conversation_history"
			case "uiMessagesPath":
				return "ui_messages"
			case "taskMetadataPath":
				return "task_metadata"
			default:
				return null
		}
	}

	private hashGitState(
		gitState: Pick<NonNullable<Awaited<ReturnType<typeof this.getGitState>>>, "head" | "patch" | "branch">,
	) {
		return createHash("sha256").update(JSON.stringify(gitState)).digest("hex")
	}

	private async getGitState() {
		const cwd = this.workspaceDir || process.cwd()
		const git = simpleGit(cwd)

		const remotes = await git.getRemotes(true)
		const repoUrl = remotes[0]?.refs?.fetch || remotes[0]?.refs?.push

		const head = await git.revparse(["HEAD"])

		let branch: string | undefined
		try {
			const symbolicRef = await git.raw(["symbolic-ref", "-q", "HEAD"])
			branch = symbolicRef.trim().replace(/^refs\/heads\//, "")
		} catch {
			branch = undefined
		}

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

			if (patch && patch.length > SessionManager.MAX_PATCH_SIZE_BYTES) {
				this.logger?.warn("Git patch too large", "SessionManager", {
					patchSize: patch.length,
					maxSize: SessionManager.MAX_PATCH_SIZE_BYTES,
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
	}

	private async executeGitRestore(gitState: { head: string; patch: string; branch: string }) {
		try {
			const cwd = this.workspaceDir || process.cwd()
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
					this.logger?.debug(`Stashed current work`, "SessionManager")
				} else {
					this.logger?.debug(`No changes to stash`, "SessionManager")
				}
			} catch (error) {
				this.logger?.warn(`Failed to stash current work`, "SessionManager", {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				const currentHead = await git.revparse(["HEAD"])

				if (currentHead.trim() === gitState.head.trim()) {
					this.logger?.debug(`Already at target commit, skipping checkout`, "SessionManager", {
						head: gitState.head.substring(0, 8),
					})
				} else {
					if (gitState.branch) {
						try {
							const branchCommit = await git.revparse([gitState.branch])

							if (branchCommit.trim() === gitState.head.trim()) {
								await git.checkout(gitState.branch)

								this.logger?.debug(`Checked out to branch`, "SessionManager", {
									branch: gitState.branch,
									head: gitState.head.substring(0, 8),
								})
							} else {
								await git.checkout(gitState.head)

								this.logger?.debug(
									`Branch moved, checked out to commit (detached HEAD)`,
									"SessionManager",
									{
										branch: gitState.branch,
										head: gitState.head.substring(0, 8),
									},
								)
							}
						} catch {
							await git.checkout(gitState.head)

							this.logger?.debug(
								`Branch not found, checked out to commit (detached HEAD)`,
								"SessionManager",
								{
									branch: gitState.branch,
									head: gitState.head.substring(0, 8),
								},
							)
						}
					} else {
						await git.checkout(gitState.head)

						this.logger?.debug(`No branch info, checked out to commit (detached HEAD)`, "SessionManager", {
							head: gitState.head.substring(0, 8),
						})
					}
				}
			} catch (error) {
				this.logger?.warn(`Failed to checkout`, "SessionManager", {
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

					this.logger?.debug(`Applied patch`, "SessionManager", {
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
				this.logger?.warn(`Failed to apply patch`, "SessionManager", {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				if (shouldPop) {
					await git.stash(["pop"])

					this.logger?.debug(`Popped stash`, "SessionManager")
				}
			} catch (error) {
				this.logger?.warn(`Failed to pop stash`, "SessionManager", {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			this.logger?.info(`Git state restoration finished`, "SessionManager", {
				head: gitState.head.substring(0, 8),
			})
		} catch (error) {
			this.logger?.error(`Failed to restore git state`, "SessionManager", {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	getFirstMessageText(uiMessages: ClineMessage[], truncate = false) {
		if (uiMessages.length === 0) {
			return null
		}

		const firstMessageWithText = uiMessages.find((msg) => msg.text)

		if (!firstMessageWithText?.text) {
			return null
		}

		let rawText = firstMessageWithText.text.trim()
		rawText = rawText.replace(/\s+/g, " ")

		if (!rawText) {
			return null
		}

		if (truncate && rawText.length > 140) {
			return rawText.substring(0, 137) + "..."
		}

		return rawText
	}

	async generateTitle(uiMessages: ClineMessage[]) {
		const rawText = this.getFirstMessageText(uiMessages)

		if (!rawText) {
			return null
		}

		try {
			const prompt = `Summarize the following user request in 140 characters or less. Be concise and capture the main intent. Do not use quotes or add any prefix like "Summary:" - just provide the summary text directly. Strip out any sensitive information. Your result will be used as the conversation title.

User request:
${rawText}

Summary:`

			if (!this.extensionMessenger) {
				throw new Error("SessionManager used before initialization")
			}

			const summary = await this.extensionMessenger.requestSingleCompletion(prompt, 30000)

			let cleanedSummary = summary.trim()

			cleanedSummary = cleanedSummary.replace(/^["']|["']$/g, "")

			if (cleanedSummary) {
				return cleanedSummary
			}

			throw new Error("Empty summary generated")
		} catch (error) {
			this.logger?.warn("Failed to generate title using LLM, falling back to truncation", "SessionManager", {
				error: error instanceof Error ? error.message : String(error),
			})

			if (rawText.length > 140) {
				return rawText.substring(0, 137) + "..."
			}

			return rawText
		}
	}
}

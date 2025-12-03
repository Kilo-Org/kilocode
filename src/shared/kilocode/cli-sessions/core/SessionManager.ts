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

const defaultPaths = {
	apiConversationHistoryPath: null as null | string,
	uiMessagesPath: null as null | string,
	taskMetadataPath: null as null | string,
}

interface SessionCreatedMessage {
	sessionId: string
	timestamp: number
	event: "session_created"
}

export interface SessionManagerDependencies extends TrpcClientDependencies {
	platform: string
	pathProvider: IPathProvider
	logger: ILogger
	extensionMessenger: IExtensionMessenger
	onSessionCreated?: (message: SessionCreatedMessage) => void
	onSessionRestored?: () => void
}

export class SessionManager {
	static readonly SYNC_INTERVAL = 3000

	private static instance = new SessionManager()

	static init(dependencies?: SessionManagerDependencies) {
		if (dependencies) {
			SessionManager.instance.initSingleton(dependencies)
		}

		return SessionManager.instance
	}

	private paths = { ...defaultPaths }
	public sessionId: string | null = null
	private workspaceDir: string | null = null
	private currentTaskId: string | null = null
	private sessionTitle: string | null = null
	private sessionGitUrl: string | null = null

	private timer: NodeJS.Timeout | null = null
	private blobHashes = this.createDefaultBlobHashes()
	private lastSyncedBlobHashes = this.createDefaultBlobHashes()
	private isSyncing: boolean = false

	private pathProvider: IPathProvider | undefined
	private logger: ILogger | undefined
	private extensionMessenger: IExtensionMessenger | undefined
	public sessionPersistenceManager: SessionPersistenceManager | undefined
	public sessionClient: SessionClient | undefined
	private onSessionCreated: ((message: SessionCreatedMessage) => void) | undefined
	private onSessionRestored: (() => void) | undefined
	private platform: string | undefined

	private constructor() {}

	private initDeps(dependencies: SessionManagerDependencies) {
		this.pathProvider = dependencies.pathProvider
		this.logger = dependencies.logger
		this.extensionMessenger = dependencies.extensionMessenger
		this.onSessionCreated = dependencies.onSessionCreated ?? (() => {})
		this.onSessionRestored = dependencies.onSessionRestored ?? (() => {})
		this.platform = dependencies.platform

		const trpcClient = new TrpcClient({
			getToken: dependencies.getToken,
		})

		this.sessionClient = new SessionClient(trpcClient)
		this.sessionPersistenceManager = new SessionPersistenceManager(this.pathProvider)

		this.logger.debug("Initialized SessionManager", "SessionManager")
	}

	private initSingleton(dependencies: SessionManagerDependencies) {
		this.initDeps(dependencies)

		if (!this.timer) {
			this.timer = setInterval(() => {
				this.syncSession()
			}, SessionManager.SYNC_INTERVAL)
		}
	}

	setPath(taskId: string, key: keyof typeof defaultPaths, value: string) {
		this.currentTaskId = taskId
		this.paths[key] = value

		const blobKey = this.pathKeyToBlobKey(key)

		if (blobKey) {
			this.updateBlobHash(blobKey)
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

			this.sessionId = sessionId
			this.resetBlobHashes()
			this.isSyncing = true

			const session = (await this.sessionClient.get({
				session_id: sessionId,
				include_blob_urls: true,
			})) as SessionWithSignedUrls | undefined

			if (!session) {
				this.logger?.error("Failed to obtain session", "SessionManager", { sessionId })
				throw new Error("Failed to obtain session")
			}

			this.sessionTitle = session.title

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

			this.sessionPersistenceManager.setLastSession(this.sessionId)

			this.onSessionRestored?.()

			this.logger?.debug("Marked task as resumed after session restoration", "SessionManager", { sessionId })
		} catch (error) {
			this.logger?.error("Failed to restore session", "SessionManager", {
				error: error instanceof Error ? error.message : String(error),
				sessionId,
			})

			this.sessionId = null
			this.sessionTitle = null
			this.sessionGitUrl = null
			this.resetBlobHashes()

			if (rethrowError) {
				throw error
			}
		} finally {
			this.isSyncing = false
		}
	}

	async shareSession(sessionId?: string) {
		if (!this.sessionClient) {
			throw new Error("SessionManager used before initialization")
		}

		const sessionIdToShare = sessionId || this.sessionId
		if (!sessionIdToShare) {
			throw new Error("No active session")
		}

		return await this.sessionClient.share({
			session_id: sessionIdToShare,
			shared_state: CliSessionSharedState.Public,
		})
	}

	async renameSession(newTitle: string) {
		if (!this.sessionClient) {
			throw new Error("SessionManager used before initialization")
		}

		const sessionId = this.sessionId
		if (!sessionId) {
			throw new Error("No active session")
		}

		const trimmedTitle = newTitle.trim()
		if (!trimmedTitle) {
			throw new Error("Session title cannot be empty")
		}

		await this.sessionClient.update({
			session_id: sessionId,
			title: trimmedTitle,
		})

		this.sessionTitle = trimmedTitle

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

			if (!sessionId) {
				this.logger?.debug("No existing session for task, creating new session", "SessionManager", { taskId })

				const { historyItem, apiConversationHistoryFilePath, uiMessagesFilePath } =
					await provider.getTaskWithId(taskId)

				const apiConversationHistory = JSON.parse(readFileSync(apiConversationHistoryFilePath, "utf8"))
				const uiMessages = JSON.parse(readFileSync(uiMessagesFilePath, "utf8"))

				const title = historyItem.task || this.getFirstMessageText(uiMessages, true) || ""

				const session = await this.sessionClient.create({
					title,
					created_on_platform: process.env.KILO_PLATFORM || this.platform,
				})

				sessionId = session.session_id

				this.logger?.info("Created new session for task", "SessionManager", { taskId, sessionId })

				await this.sessionClient.uploadBlob(sessionId, "api_conversation_history", apiConversationHistory)
				await this.sessionClient.uploadBlob(sessionId, "ui_messages", uiMessages)

				this.logger?.debug("Uploaded conversation blobs to session", "SessionManager", { sessionId })

				this.sessionPersistenceManager.setSessionForTask(taskId, sessionId)
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

	async destroy() {
		this.logger?.debug("Destroying SessionManager", "SessionManager", {
			sessionId: this.sessionId,
			isSyncing: this.isSyncing,
		})

		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}

		if (this.sessionId) {
			if (this.isSyncing) {
				await new Promise((r) => setTimeout(r, 2000))
			} else {
				await this.syncSession(true)
			}
		}

		this.paths = { ...defaultPaths }
		this.sessionId = null
		this.sessionTitle = null
		this.isSyncing = false

		this.logger?.debug("SessionManager flushed", "SessionManager")

		if (!this.timer) {
			this.timer = setInterval(() => {
				this.syncSession()
			}, SessionManager.SYNC_INTERVAL)
		}
	}

	private async syncSession(force = false) {
		if (!force) {
			if (this.isSyncing) {
				return
			}

			if (Object.values(this.paths).every((item) => !item)) {
				return
			}

			if (!this.hasAnyBlobChanged()) {
				return
			}
		}

		if (process.env.KILO_DISABLE_SESSIONS) {
			return
		}

		this.isSyncing = true

		try {
			if (!this.platform || !this.sessionClient || !this.sessionPersistenceManager) {
				throw new Error("SessionManager used before initialization")
			}

			const rawPayload = this.readPaths()

			if (Object.values(rawPayload).every((item) => !item)) {
				this.isSyncing = false

				return
			}

			const basePayload: Omit<
				Parameters<NonNullable<typeof this.sessionClient>["create"]>[0],
				"created_on_platform"
			> = {}

			let gitInfo: Awaited<ReturnType<typeof this.getGitState>> | null = null

			try {
				gitInfo = await this.getGitState()

				if (gitInfo?.repoUrl) {
					basePayload.git_url = gitInfo.repoUrl
				}
			} catch (error) {
				this.logger?.debug("Could not get git state", "SessionManager", {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			if (!this.sessionId && this.currentTaskId) {
				const existingSessionId = this.sessionPersistenceManager.getSessionForTask(this.currentTaskId)

				if (existingSessionId) {
					this.sessionId = existingSessionId
				}
			}

			if (this.sessionId) {
				const gitUrlChanged = gitInfo?.repoUrl && gitInfo.repoUrl !== this.sessionGitUrl

				if (gitUrlChanged) {
					this.logger?.debug("Updating existing session", "SessionManager", { sessionId: this.sessionId })

					await this.sessionClient.update({
						session_id: this.sessionId,
						...basePayload,
					})

					this.sessionGitUrl = gitInfo?.repoUrl || null

					this.logger?.debug("Session updated successfully", "SessionManager", { sessionId: this.sessionId })
				}
			} else {
				this.logger?.debug("Creating new session", "SessionManager")

				if (rawPayload.uiMessagesPath) {
					const title = this.getFirstMessageText(rawPayload.uiMessagesPath as ClineMessage[], true)

					if (title) {
						basePayload.title = title
					}
				}

				const session = await this.sessionClient.create({
					...basePayload,
					created_on_platform: process.env.KILO_PLATFORM || this.platform,
				})

				this.sessionId = session.session_id
				this.sessionGitUrl = gitInfo?.repoUrl || null

				this.logger?.info("Session created successfully", "SessionManager", { sessionId: this.sessionId })

				this.sessionPersistenceManager.setLastSession(this.sessionId)

				this.onSessionCreated?.({
					timestamp: Date.now(),
					event: "session_created",
					sessionId: this.sessionId,
				})
			}

			if (this.currentTaskId) {
				this.sessionPersistenceManager.setSessionForTask(this.currentTaskId, this.sessionId)
			}

			const blobUploads: Array<Promise<void>> = []

			if (rawPayload.apiConversationHistoryPath && this.hasBlobChanged("apiConversationHistory")) {
				blobUploads.push(
					this.sessionClient
						.uploadBlob(this.sessionId, "api_conversation_history", rawPayload.apiConversationHistoryPath)
						.then(() => {
							this.markBlobSynced("apiConversationHistory")
							this.logger?.debug("Uploaded api_conversation_history blob", "SessionManager")
						})
						.catch((error) => {
							this.logger?.error("Failed to upload api_conversation_history blob", "SessionManager", {
								error: error instanceof Error ? error.message : String(error),
							})
						}),
				)
			}

			if (rawPayload.taskMetadataPath && this.hasBlobChanged("taskMetadata")) {
				blobUploads.push(
					this.sessionClient
						.uploadBlob(this.sessionId, "task_metadata", rawPayload.taskMetadataPath)
						.then(() => {
							this.markBlobSynced("taskMetadata")
							this.logger?.debug("Uploaded task_metadata blob", "SessionManager")
						})
						.catch((error) => {
							this.logger?.error("Failed to upload task_metadata blob", "SessionManager", {
								error: error instanceof Error ? error.message : String(error),
							})
						}),
				)
			}

			if (rawPayload.uiMessagesPath && this.hasBlobChanged("uiMessages")) {
				blobUploads.push(
					this.sessionClient
						.uploadBlob(this.sessionId, "ui_messages", rawPayload.uiMessagesPath)
						.then(() => {
							this.markBlobSynced("uiMessages")
							this.logger?.debug("Uploaded ui_messages blob", "SessionManager")
						})
						.catch((error) => {
							this.logger?.error("Failed to upload ui_messages blob", "SessionManager", {
								error: error instanceof Error ? error.message : String(error),
							})
						}),
				)
			}

			if (gitInfo) {
				const gitStateData = {
					head: gitInfo.head,
					patch: gitInfo.patch,
					branch: gitInfo.branch,
				}

				const gitStateHash = this.hashGitState(gitStateData)

				if (gitStateHash !== this.blobHashes.gitState) {
					this.blobHashes.gitState = gitStateHash

					if (this.hasBlobChanged("gitState")) {
						blobUploads.push(
							this.sessionClient
								.uploadBlob(this.sessionId, "git_state", gitStateData)
								.then(() => {
									this.markBlobSynced("gitState")
									this.logger?.debug("Uploaded git_state blob", "SessionManager")
								})
								.catch((error) => {
									this.logger?.error("Failed to upload git_state blob", "SessionManager", {
										error: error instanceof Error ? error.message : String(error),
									})
								}),
						)
					}
				}
			}

			await Promise.all(blobUploads)

			if (!this.sessionTitle && rawPayload.uiMessagesPath) {
				this.generateTitle(rawPayload.uiMessagesPath as ClineMessage[])
					.then((generatedTitle) => {
						if (generatedTitle) {
							return this.renameSession(generatedTitle)
						}

						return null
					})
					.catch((error) => {
						this.logger?.warn("Failed to generate session title", "SessionManager", {
							error: error instanceof Error ? error.message : String(error),
						})
					})
			}
		} catch (error) {
			this.logger?.error("Failed to sync session", "SessionManager", {
				error: error instanceof Error ? error.message : String(error),
				sessionId: this.sessionId,
				hasApiHistory: !!this.paths.apiConversationHistoryPath,
				hasUiMessages: !!this.paths.uiMessagesPath,
				hasTaskMetadata: !!this.paths.taskMetadataPath,
			})
		} finally {
			this.isSyncing = false
		}
	}

	private readPath(path: string) {
		try {
			const content = readFileSync(path, "utf-8")
			try {
				return JSON.parse(content)
			} catch {
				return undefined
			}
		} catch {
			return undefined
		}
	}

	private readPaths() {
		const contents: Partial<Record<keyof typeof this.paths, unknown>> = {}

		for (const [key, value] of Object.entries(this.paths)) {
			if (!value) {
				continue
			}

			const content = this.readPath(value)
			if (content !== undefined) {
				contents[key as keyof typeof this.paths] = content
			}
		}

		return contents
	}

	private async fetchBlobFromSignedUrl(url: string, urlType: string) {
		try {
			this.logger?.debug(`Fetching blob from signed URL`, "SessionManager", { url, urlType })

			const response = await fetch(url)

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const data = await response.json()

			this.logger?.debug(`Successfully fetched blob`, "SessionManager", { url, urlType })

			return data
		} catch (error) {
			this.logger?.error(`Failed to fetch blob from signed URL`, "SessionManager", {
				url,
				urlType,
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	private pathKeyToBlobKey(pathKey: keyof typeof defaultPaths) {
		switch (pathKey) {
			case "apiConversationHistoryPath":
				return "apiConversationHistory"
			case "uiMessagesPath":
				return "uiMessages"
			case "taskMetadataPath":
				return "taskMetadata"
			default:
				return null
		}
	}

	private updateBlobHash(blobKey: keyof typeof this.blobHashes) {
		this.blobHashes[blobKey] = crypto.randomUUID()
	}

	private hasBlobChanged(blobKey: keyof typeof this.blobHashes) {
		return this.blobHashes[blobKey] !== this.lastSyncedBlobHashes[blobKey]
	}

	private hasAnyBlobChanged() {
		return (
			this.hasBlobChanged("apiConversationHistory") ||
			this.hasBlobChanged("uiMessages") ||
			this.hasBlobChanged("taskMetadata") ||
			this.hasBlobChanged("gitState")
		)
	}

	private markBlobSynced(blobKey: keyof typeof this.blobHashes) {
		this.lastSyncedBlobHashes[blobKey] = this.blobHashes[blobKey]
	}

	private hashGitState(
		gitState: Pick<NonNullable<Awaited<ReturnType<typeof this.getGitState>>>, "head" | "patch" | "branch">,
	) {
		return createHash("sha256").update(JSON.stringify(gitState)).digest("hex")
	}

	private createDefaultBlobHashes() {
		return {
			apiConversationHistory: "",
			uiMessages: "",
			taskMetadata: "",
			gitState: "",
		}
	}

	private resetBlobHashes() {
		this.blobHashes = this.createDefaultBlobHashes()
		this.lastSyncedBlobHashes = this.createDefaultBlobHashes()
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
						rmSync(patchFile, { recursive: true, force: true })
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

		if (rawText.length <= 140) {
			return rawText
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

			if (cleanedSummary.length > 140) {
				cleanedSummary = cleanedSummary.substring(0, 137) + "..."
			}

			return cleanedSummary || rawText.substring(0, 137) + "..."
		} catch (error) {
			this.logger?.warn("Failed to generate title using LLM, falling back to truncation", "SessionManager", {
				error: error instanceof Error ? error.message : String(error),
			})

			return rawText.substring(0, 137) + "..."
		}
	}
}

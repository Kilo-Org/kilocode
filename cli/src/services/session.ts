import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "fs"
import { KiloCodePaths } from "../utils/paths"
import { SessionClient, SessionWithSignedUrls, ShareSessionOutput, CliSessionSharedState } from "./sessionClient"
import { logs } from "./logs.js"
import path from "path"
import { ensureDirSync } from "fs-extra"
import type { ExtensionService } from "./extension.js"
import type { ClineMessage, HistoryItem } from "@roo-code/types"
import simpleGit from "simple-git"
import { tmpdir } from "os"
import { createHash } from "crypto"
import type { createStore } from "jotai"
import { taskResumedViaContinueOrSessionAtom } from "../state/atoms/extension.js"

const defaultPaths = {
	apiConversationHistoryPath: null as null | string,
	uiMessagesPath: null as null | string,
	taskMetadataPath: null as null | string,
}

export class SessionService {
	static readonly SYNC_INTERVAL = 1000
	private static instance: SessionService | null = null

	static init(extensionService?: ExtensionService, store?: ReturnType<typeof createStore>, json?: boolean) {
		if (extensionService && store && json !== undefined && !SessionService.instance) {
			SessionService.instance = new SessionService(extensionService, store, json)

			logs.debug("Initialized SessionService", "SessionService")
		}

		const instance = SessionService.instance

		if (!instance) {
			throw new Error("SessionService not initialized")
		}

		instance.startTimer()

		return SessionService.instance!
	}

	private paths = { ...defaultPaths }
	public sessionId: string | null = null
	private workspaceDir: string | null = null
	private sessionTitle: string | null = null
	private sessionGitUrl: string | null = null

	private timer: NodeJS.Timeout | null = null
	private blobHashes = this.createDefaultBlobHashes()
	private lastSyncedBlobHashes = this.createDefaultBlobHashes()
	private isSyncing: boolean = false

	private constructor(
		private extensionService: ExtensionService,
		private store: ReturnType<typeof createStore>,
		private jsonMode: boolean,
	) {}

	setPath(key: keyof typeof defaultPaths, value: string) {
		this.paths[key] = value

		const blobKey = this.pathKeyToBlobKey(key)

		if (blobKey) {
			this.updateBlobHash(blobKey)
		}
	}

	setWorkspaceDirectory(dir: string): void {
		this.workspaceDir = dir
	}

	private saveLastSessionId(sessionId: string): void {
		if (!this.workspaceDir) {
			logs.warn("Cannot save last session ID: workspace directory not set", "SessionService")
			return
		}

		try {
			const lastSessionPath = KiloCodePaths.getLastSessionPath(this.workspaceDir)
			const data = {
				sessionId,
				timestamp: Date.now(),
			}
			writeFileSync(lastSessionPath, JSON.stringify(data, null, 2))
			logs.debug("Saved last session ID", "SessionService", { sessionId, path: lastSessionPath })
		} catch (error) {
			logs.warn("Failed to save last session ID", "SessionService", {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	private getLastSessionId(): string | null {
		if (!this.workspaceDir) {
			logs.warn("Cannot get last session ID: workspace directory not set", "SessionService")
			return null
		}

		try {
			const lastSessionPath = KiloCodePaths.getLastSessionPath(this.workspaceDir)
			if (!existsSync(lastSessionPath)) {
				return null
			}

			const content = readFileSync(lastSessionPath, "utf-8")
			const data = JSON.parse(content)

			if (data.sessionId && typeof data.sessionId === "string") {
				logs.debug("Retrieved last session ID", "SessionService", { sessionId: data.sessionId })
				return data.sessionId
			}

			return null
		} catch (error) {
			logs.warn("Failed to read last session ID", "SessionService", {
				error: error instanceof Error ? error.message : String(error),
			})
			return null
		}
	}

	async restoreLastSession(): Promise<boolean> {
		const lastSessionId = this.getLastSessionId()

		if (!lastSessionId) {
			logs.debug("No persisted session ID found", "SessionService")
			return false
		}

		logs.info("Found persisted session ID, attempting to restore", "SessionService", { sessionId: lastSessionId })

		try {
			await this.restoreSession(lastSessionId, true)

			logs.info("Successfully restored persisted session", "SessionService", { sessionId: lastSessionId })
			return true
		} catch (error) {
			logs.warn("Failed to restore persisted session", "SessionService", {
				error: error instanceof Error ? error.message : String(error),
				sessionId: lastSessionId,
			})
			return false
		}
	}

	async restoreSession(sessionId: string, rethrowError = false) {
		try {
			logs.info("Restoring session", "SessionService", { sessionId })

			// Set sessionId immediately to prevent race condition with syncSession timer
			// If restoration fails, we'll reset it in the catch block
			this.sessionId = sessionId
			this.resetBlobHashes()
			this.isSyncing = true

			const sessionClient = SessionClient.getInstance()
			const session = (await sessionClient.get({
				session_id: sessionId,
				include_blob_urls: true,
			})) as SessionWithSignedUrls

			if (!session) {
				logs.error("Failed to obtain session", "SessionService", { sessionId })

				throw new Error("Failed to obtain session")
			}

			this.sessionTitle = session.title

			const sessionDirectoryPath = path.join(KiloCodePaths.getTasksDir(), sessionId)

			ensureDirSync(sessionDirectoryPath)

			// Fetch and write each blob type from signed URLs
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
						logs.debug(`No signed URL for ${blobUrlField}`, "SessionService")
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
							// eliminate checkpoints for now
							fileContent = (fileContent as ClineMessage[]).filter(
								(message) => message.say !== "checkpoint_saved",
							)
						}

						const fullPath = path.join(sessionDirectoryPath, `${filename}.json`)

						writeFileSync(fullPath, JSON.stringify(fileContent, null, 2))

						logs.debug(`Wrote blob to file`, "SessionService", { fullPath })
					} else {
						logs.error(`Failed to process blob`, "SessionService", {
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

			// Send message to register the task in extension history
			await this.extensionService.sendWebviewMessage({
				type: "addTaskToHistory",
				historyItem,
			})

			logs.info("Task registered with extension", "SessionService", {
				sessionId,
				taskId: historyItem.id,
			})

			// Automatically switch to the restored task
			await this.extensionService.sendWebviewMessage({
				type: "showTaskWithId",
				text: sessionId,
			})

			logs.info("Switched to restored task", "SessionService", { sessionId })

			this.saveLastSessionId(sessionId)

			this.store.set(taskResumedViaContinueOrSessionAtom, true)

			logs.debug("Marked task as resumed after session restoration", "SessionService", { sessionId })
		} catch (error) {
			logs.error("Failed to restore session", "SessionService", {
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

	async shareSession(): Promise<ShareSessionOutput> {
		const sessionId = this.sessionId
		if (!sessionId) {
			throw new Error("No active session")
		}

		const sessionClient = SessionClient.getInstance()

		return await sessionClient.share({
			session_id: sessionId,
			shared_state: CliSessionSharedState.Public,
		})
	}

	async renameSession(newTitle: string): Promise<void> {
		const sessionId = this.sessionId
		if (!sessionId) {
			throw new Error("No active session")
		}

		const trimmedTitle = newTitle.trim()
		if (!trimmedTitle) {
			throw new Error("Session title cannot be empty")
		}

		const sessionClient = SessionClient.getInstance()

		await sessionClient.update({
			session_id: sessionId,
			title: trimmedTitle,
		})

		this.sessionTitle = trimmedTitle

		logs.info("Session renamed successfully", "SessionService", {
			sessionId,
			newTitle: trimmedTitle,
		})
	}

	async forkSession(shareId: string, rethrowError = false) {
		const sessionClient = SessionClient.getInstance()
		const { session_id } = await sessionClient.fork({ share_id: shareId })

		await this.restoreSession(session_id, rethrowError)
	}

	async destroy() {
		logs.debug("Destroying SessionService", "SessionService", {
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

		logs.debug("SessionService flushed", "SessionService")
	}

	private startTimer() {
		if (!this.timer) {
			this.timer = setInterval(() => {
				this.syncSession()
			}, SessionService.SYNC_INTERVAL)
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

		this.isSyncing = true

		try {
			const rawPayload = this.readPaths()

			if (Object.values(rawPayload).every((item) => !item)) {
				this.isSyncing = false

				return
			}

			const sessionClient = SessionClient.getInstance()

			const basePayload: Omit<Parameters<typeof sessionClient.create>[0], "created_on_platform"> = {}

			let gitInfo: Awaited<ReturnType<typeof this.getGitState>> | null = null

			try {
				gitInfo = await this.getGitState()

				if (gitInfo?.repoUrl) {
					basePayload.git_url = gitInfo.repoUrl
				}
			} catch (error) {
				logs.debug("Could not get git state", "SessionService", {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			if (this.sessionId) {
				const gitUrlChanged = gitInfo?.repoUrl && gitInfo.repoUrl !== this.sessionGitUrl

				if (gitUrlChanged) {
					logs.debug("Updating existing session", "SessionService", { sessionId: this.sessionId })

					await sessionClient.update({
						session_id: this.sessionId,
						...basePayload,
					})

					this.sessionGitUrl = gitInfo?.repoUrl || null

					logs.debug("Session updated successfully", "SessionService", { sessionId: this.sessionId })
				}
			} else {
				logs.debug("Creating new session", "SessionService")

				if (rawPayload.uiMessagesPath) {
					const title = this.getFirstMessageText(rawPayload.uiMessagesPath as ClineMessage[], true)

					if (title) {
						basePayload.title = title
					}
				}

				const session = await sessionClient.create({
					...basePayload,
					created_on_platform: process.env.KILO_PLATFORM || "cli",
				})

				this.sessionId = session.session_id
				this.sessionGitUrl = gitInfo?.repoUrl || null

				logs.info("Session created successfully", "SessionService", { sessionId: this.sessionId })

				this.saveLastSessionId(this.sessionId)

				if (this.jsonMode) {
					console.log(
						JSON.stringify({
							timestamp: Date.now(),
							event: "session_created",
							sessionId: this.sessionId,
						}),
					)
				}
			}

			const blobUploads: Array<Promise<void>> = []

			if (rawPayload.apiConversationHistoryPath && this.hasBlobChanged("apiConversationHistory")) {
				blobUploads.push(
					sessionClient
						.uploadBlob(this.sessionId, "api_conversation_history", rawPayload.apiConversationHistoryPath)
						.then(() => {
							this.markBlobSynced("apiConversationHistory")
							logs.debug("Uploaded api_conversation_history blob", "SessionService")
						})
						.catch((error) => {
							logs.error("Failed to upload api_conversation_history blob", "SessionService", {
								error: error instanceof Error ? error.message : String(error),
							})
						}),
				)
			}

			if (rawPayload.taskMetadataPath && this.hasBlobChanged("taskMetadata")) {
				blobUploads.push(
					sessionClient
						.uploadBlob(this.sessionId, "task_metadata", rawPayload.taskMetadataPath)
						.then(() => {
							this.markBlobSynced("taskMetadata")
							logs.debug("Uploaded task_metadata blob", "SessionService")
						})
						.catch((error) => {
							logs.error("Failed to upload task_metadata blob", "SessionService", {
								error: error instanceof Error ? error.message : String(error),
							})
						}),
				)
			}

			if (rawPayload.uiMessagesPath && this.hasBlobChanged("uiMessages")) {
				blobUploads.push(
					sessionClient
						.uploadBlob(this.sessionId, "ui_messages", rawPayload.uiMessagesPath)
						.then(() => {
							this.markBlobSynced("uiMessages")
							logs.debug("Uploaded ui_messages blob", "SessionService")
						})
						.catch((error) => {
							logs.error("Failed to upload ui_messages blob", "SessionService", {
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
							sessionClient
								.uploadBlob(this.sessionId, "git_state", gitStateData)
								.then(() => {
									this.markBlobSynced("gitState")
									logs.debug("Uploaded git_state blob", "SessionService")
								})
								.catch((error) => {
									logs.error("Failed to upload git_state blob", "SessionService", {
										error: error instanceof Error ? error.message : String(error),
									})
								}),
						)
					}
				}
			}

			await Promise.all(blobUploads)

			if (!this.sessionTitle && rawPayload.uiMessagesPath) {
				// Intentionally not awaiting as we don't want this to block
				this.generateTitle(rawPayload.uiMessagesPath as ClineMessage[])
					.then((generatedTitle) => {
						if (generatedTitle) {
							return this.renameSession(generatedTitle)
						}

						return null
					})
					.catch((error) => {
						logs.warn("Failed to generate session title", "SessionService", {
							error: error instanceof Error ? error.message : String(error),
						})
					})
			}
		} catch (error) {
			logs.error("Failed to sync session", "SessionService", {
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

	private async fetchBlobFromSignedUrl(url: string, urlType: string): Promise<unknown> {
		try {
			logs.debug(`Fetching blob from signed URL`, "SessionService", { url, urlType })

			const response = await fetch(url)

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const data = await response.json()

			logs.debug(`Successfully fetched blob`, "SessionService", { url, urlType })

			return data
		} catch (error) {
			logs.error(`Failed to fetch blob from signed URL`, "SessionService", {
				url,
				urlType,
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	private pathKeyToBlobKey(pathKey: keyof typeof defaultPaths): keyof typeof this.blobHashes | null {
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

	private hasBlobChanged(blobKey: keyof typeof this.blobHashes): boolean {
		return this.blobHashes[blobKey] !== this.lastSyncedBlobHashes[blobKey]
	}

	private hasAnyBlobChanged(): boolean {
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
	): string {
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

	private async executeGitRestore(gitState: { head: string; patch: string; branch: string }): Promise<void> {
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
					logs.debug(`Stashed current work`, "SessionService")
				} else {
					logs.debug(`No changes to stash`, "SessionService")
				}
			} catch (error) {
				logs.warn(`Failed to stash current work`, "SessionService", {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				const currentHead = await git.revparse(["HEAD"])

				if (currentHead.trim() === gitState.head.trim()) {
					logs.debug(`Already at target commit, skipping checkout`, "SessionService", {
						head: gitState.head.substring(0, 8),
					})
				} else {
					if (gitState.branch) {
						try {
							const branchCommit = await git.revparse([gitState.branch])

							if (branchCommit.trim() === gitState.head.trim()) {
								await git.checkout(gitState.branch)

								logs.debug(`Checked out to branch`, "SessionService", {
									branch: gitState.branch,
									head: gitState.head.substring(0, 8),
								})
							} else {
								await git.checkout(gitState.head)

								logs.debug(`Branch moved, checked out to commit (detached HEAD)`, "SessionService", {
									branch: gitState.branch,
									head: gitState.head.substring(0, 8),
								})
							}
						} catch {
							await git.checkout(gitState.head)

							logs.debug(`Branch not found, checked out to commit (detached HEAD)`, "SessionService", {
								branch: gitState.branch,
								head: gitState.head.substring(0, 8),
							})
						}
					} else {
						await git.checkout(gitState.head)

						logs.debug(`No branch info, checked out to commit (detached HEAD)`, "SessionService", {
							head: gitState.head.substring(0, 8),
						})
					}
				}
			} catch (error) {
				logs.warn(`Failed to checkout`, "SessionService", {
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

					logs.debug(`Applied patch`, "SessionService", {
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
				logs.warn(`Failed to apply patch`, "SessionService", {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				if (shouldPop) {
					await git.stash(["pop"])

					logs.debug(`Popped stash`, "SessionService")
				}
			} catch (error) {
				logs.warn(`Failed to pop stash`, "SessionService", {
					error: error instanceof Error ? error.message : String(error),
				})
			}

			logs.info(`Git state restored successfully`, "SessionService", {
				head: gitState.head.substring(0, 8),
			})
		} catch (error) {
			logs.error(`Failed to restore git state`, "SessionService", {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	getFirstMessageText(uiMessages: ClineMessage[], truncate = false): string | null {
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

	async generateTitle(uiMessages: ClineMessage[]): Promise<string | null> {
		const rawText = this.getFirstMessageText(uiMessages)

		if (!rawText) {
			return null
		}

		if (rawText.length <= 140) {
			return rawText
		}

		try {
			const prompt = `Summarize the following user request in 140 characters or less. Be concise and capture the main intent. Do not use quotes or add any prefix like "Summary:" - just provide the summary text directly. Your result will be used as the conversation title.

User request:
${rawText}

Summary:`

			const summary = await this.extensionService.requestSingleCompletion(prompt, 30000)

			// Clean up the response and ensure it's within 140 characters
			let cleanedSummary = summary.trim()

			// Remove any quotes that might have been added
			cleanedSummary = cleanedSummary.replace(/^["']|["']$/g, "")

			// Truncate if still too long
			if (cleanedSummary.length > 140) {
				cleanedSummary = cleanedSummary.substring(0, 137) + "..."
			}

			return cleanedSummary || rawText.substring(0, 137) + "..."
		} catch (error) {
			logs.warn("Failed to generate title using LLM, falling back to truncation", "SessionService", {
				error: error instanceof Error ? error.message : String(error),
			})

			// Fallback to simple truncation
			return rawText.substring(0, 137) + "..."
		}
	}
}

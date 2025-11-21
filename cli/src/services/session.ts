import { readFileSync, writeFileSync } from "fs"
import { KiloCodePaths } from "../utils/paths"
import { SessionClient, SessionWithSignedUrls, CliSessionSharedState, SetSharedStateOutput } from "./sessionClient"
import { logs } from "./logs.js"
import path from "path"
import { ensureDirSync } from "fs-extra"
import type { ExtensionService } from "./extension.js"
import type { ClineMessage, HistoryItem } from "@roo-code/types"
import { createStore } from "jotai"
import { sessionIdAtom } from "../state/atoms/session.js"
import simpleGit from "simple-git"

const defaultPaths = {
	apiConversationHistoryPath: null as null | string,
	uiMessagesPath: null as null | string,
	taskMetadataPath: null as null | string,
}

export class SessionService {
	private static instance: SessionService | null = null

	static init(extensionService?: ExtensionService, store?: ReturnType<typeof createStore>) {
		if ((!extensionService || !store) && !SessionService.instance) {
			throw new Error("extensionService and store required to init SessionService")
		}

		if (extensionService && store && !SessionService.instance) {
			SessionService.instance = new SessionService(extensionService, store)

			logs.debug("Initiated SessionService", "SessionService")
		}

		return SessionService.instance!
	}

	private paths = { ...defaultPaths }
	private _sessionId: string | null = null
	private workspaceDir: string | null = null

	get sessionId() {
		return this._sessionId
	}

	private set sessionId(sessionId: string | null) {
		this._sessionId = sessionId

		// Set the session ID in the atom for UI display
		this.store.set(sessionIdAtom, sessionId)
	}

	private timer: NodeJS.Timeout | null = null
	private lastSaveEvent: string = ""
	private lastSyncEvent: string = ""
	private isSyncing: boolean = false

	private constructor(
		private extensionService: ExtensionService,
		private store: ReturnType<typeof createStore>,
	) {
		this.startTimer()
	}

	private startTimer() {
		this.timer = setInterval(() => {
			this.syncSession()
		}, 1000)
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

	/**
	 * Fetch and parse content from a signed URL
	 */
	private async fetchBlobFromSignedUrl(url: string, blobType: string): Promise<unknown> {
		try {
			logs.debug(`Fetching blob from signed URL`, "SessionService", { blobType })

			const response = await fetch(url)

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const data = await response.json()

			logs.debug(`Successfully fetched blob`, "SessionService", { blobType })

			return data
		} catch (error) {
			logs.error(`Failed to fetch blob from signed URL`, "SessionService", {
				blobType,
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	async restoreSession(sessionId: string, rethrowError = false) {
		try {
			logs.info("Restoring session", "SessionService", { sessionId })

			// Set sessionId immediately to prevent race condition with syncSession timer
			// If restoration fails, we'll reset it in the catch block
			this.sessionId = sessionId
			this.lastSaveEvent = crypto.randomUUID()
			this.lastSyncEvent = this.lastSaveEvent

			const sessionClient = SessionClient.getInstance()
			const session = (await sessionClient.get({
				sessionId,
				includeBlobs: true,
			})) as SessionWithSignedUrls

			if (!session) {
				logs.error("Failed to obtain session", "SessionService", { sessionId })
				return
			}

			const sessionDirectoryPath = path.join(KiloCodePaths.getTasksDir(), sessionId)

			ensureDirSync(sessionDirectoryPath)

			// Fetch and write each blob type from signed URLs
			const blobUrlFields = [
				"api_conversation_history_blob_url",
				"ui_messages_blob_url",
				"task_metadata_blob_url",
			] as const

			// Fetch all blobs concurrently with error handling
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
					const url = session[blobUrlField]!
					return {
						fieldName: blobUrlField,
						result: await this.fetchBlobFromSignedUrl(url, blobUrlField)
							.then((content) => ({ success: true as const, content }))
							.catch((error) => ({
								success: false as const,
								error: error instanceof Error ? error.message : String(error),
							})),
					}
				})

			const results = await Promise.allSettled(fetchPromises)

			// Process settled results and write files for successful fetches
			for (const result of results) {
				if (result.status === "fulfilled") {
					const { fieldName, result: fetchResult } = result.value

					if (fetchResult.success) {
						let fileContent = fetchResult.content

						if (fieldName === "ui_messages_blob_url") {
							// eliminate checkpoints for now
							fileContent = (fileContent as ClineMessage[]).filter(
								(message) => message.say !== "checkpoint_saved",
							)
						}

						writeFileSync(
							path.join(sessionDirectoryPath, `${fieldName}.json`),
							JSON.stringify(fileContent, null, 2),
						)

						logs.debug(`Wrote blob to file`, "SessionService", { fileName: fieldName })
					} else {
						logs.error(`Failed to process blob`, "SessionService", {
							fileName: fieldName,
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
		} catch (error) {
			logs.error("Failed to restore session", "SessionService", {
				error: error instanceof Error ? error.message : String(error),
				sessionId,
			})

			this.sessionId = null

			if (rethrowError) {
				throw error
			}
		}
	}

	private async syncSession() {
		if (this.isSyncing) {
			return
		}

		if (Object.values(this.paths).every((item) => !item) || this.lastSaveEvent === this.lastSyncEvent) {
			return
		}

		this.isSyncing = true

		try {
			const rawPayload = this.readPaths()

			if (Object.values(rawPayload).every((item) => !item)) {
				return
			}

			const currentLastSaveEvent = this.lastSaveEvent
			const sessionClient = SessionClient.getInstance()

			const payload: Partial<Parameters<typeof sessionClient.update>[0]> = {
				api_conversation_history: rawPayload.apiConversationHistoryPath,
				ui_messages: rawPayload.uiMessagesPath,
				task_metadata: rawPayload.taskMetadataPath,
			}

			if (this.sessionId) {
				logs.debug("Updating existing session", "SessionService", { sessionId: this.sessionId })

				await sessionClient.update({
					sessionId: this.sessionId,
					...payload,
				})

				logs.debug("Session updated successfully", "SessionService", { sessionId: this.sessionId })
			} else {
				logs.debug("Creating new session", "SessionService")

				const session = await sessionClient.create(payload)

				this.sessionId = session.session_id

				logs.info("Session created successfully", "SessionService", { sessionId: this.sessionId })
			}

			this.lastSyncEvent = currentLastSaveEvent
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

	setPath(key: keyof typeof defaultPaths, value: string) {
		this.paths[key] = value

		this.lastSaveEvent = crypto.randomUUID()
	}

	/**
	 * Set the workspace directory for git operations.
	 * This should be called when the extension knows the workspace path,
	 * particularly important for parallel mode (git worktrees) compatibility.
	 */
	setWorkspaceDirectory(dir: string): void {
		this.workspaceDir = dir
	}

	async setSharedState(sharedState: CliSessionSharedState): Promise<SetSharedStateOutput> {
		const sessionId = this.sessionId
		if (!sessionId) {
			throw new Error("No active session")
		}

		const sessionClient = SessionClient.getInstance()

		if (sharedState === CliSessionSharedState.Private) {
			return await sessionClient.setSharedState({
				sessionId,
				sharedState: CliSessionSharedState.Private,
			})
		}

		// Use stored workspace directory, fallback to process.cwd() if not set
		const cwd = this.workspaceDir || process.cwd()
		const git = simpleGit(cwd)

		const remotes = await git.getRemotes(true)
		const repoUrl = remotes[0]?.refs?.fetch || remotes[0]?.refs?.push

		if (!repoUrl) {
			throw new Error("Not in a git repository or no remote configured")
		}

		const head = await git.revparse(["HEAD"])

		const patch = await git.diff(["HEAD"])

		return await sessionClient.setSharedState({
			sessionId,
			sharedState: CliSessionSharedState.Public,
			gitState: {
				repoUrl,
				head,
				patch,
			},
		})
	}

	async destroy() {
		logs.debug("Destroying SessionService", "SessionService", { sessionId: this.sessionId })

		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}

		await this.syncSession()

		this.paths = { ...defaultPaths }
		this.sessionId = null
		this.isSyncing = false

		logs.debug("SessionService destroyed", "SessionService")
	}
}

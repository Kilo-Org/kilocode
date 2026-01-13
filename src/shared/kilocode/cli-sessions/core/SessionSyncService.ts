import { promises as fs } from "fs"
import type { ClineMessage } from "@roo-code/types"
import type { ILogger } from "../types/ILogger.js"
import type { SessionClient } from "./SessionClient.js"
import type { SessionPersistenceManager } from "../utils/SessionPersistenceManager.js"
import type { SessionStateManager } from "./SessionStateManager.js"
import type { SessionTitleService } from "./SessionTitleService.js"
import type { GitStateService } from "./GitStateService.js"
import type { TokenValidationService } from "./TokenValidationService.js"
import type { SyncQueue } from "./SyncQueue.js"
import { LOG_SOURCES } from "../config.js"

/**
 * Message emitted when a session has been created.
 */
export interface SessionCreatedMessage {
	sessionId: string
	timestamp: number
	event: "session_created"
}

/**
 * Message emitted when a session has been synced to the cloud.
 * Contains timing information for tracking sync state and detecting stale data.
 */
export interface SessionSyncedMessage {
	sessionId: string
	/** The server-side updated_at timestamp (as Unix milliseconds) from the most recent sync operation */
	updatedAt: number
	/** The local timestamp (Unix milliseconds) when this sync event was emitted */
	timestamp: number
	event: "session_synced"
}

/**
 * Dependencies required by SessionSyncService.
 */
export interface SessionSyncServiceDependencies {
	sessionClient: SessionClient
	persistenceManager: SessionPersistenceManager
	stateManager: SessionStateManager
	titleService: SessionTitleService
	gitStateService: GitStateService
	tokenValidationService: TokenValidationService
	syncQueue: SyncQueue
	logger: ILogger
	platform: string
	version: number
	getOrganizationId: (taskId: string) => Promise<string | undefined>
	getMode: (taskId: string) => Promise<string | undefined>
	getModel: (taskId: string) => Promise<string | undefined>
	getParentTaskId: (taskId: string) => Promise<string | undefined>
	onSessionCreated?: (message: SessionCreatedMessage) => void
	onSessionSynced?: (message: SessionSyncedMessage) => void
}

/**
 * SessionSyncService - Handles queue-based session synchronization.
 *
 * This service is responsible for:
 * - Processing the sync queue
 * - Creating/updating sessions on the server
 * - Uploading blobs (conversation history, UI messages, metadata)
 * - Uploading git state
 * - Triggering title generation
 * - Emitting sync events
 *
 * Extracted from SessionManager as part of the refactoring effort to improve
 * maintainability and testability through separation of concerns.
 */
export class SessionSyncService {
	private readonly sessionClient: SessionClient
	private readonly persistenceManager: SessionPersistenceManager
	private readonly stateManager: SessionStateManager
	private readonly titleService: SessionTitleService
	private readonly gitStateService: GitStateService
	private readonly tokenValidationService: TokenValidationService
	private readonly syncQueue: SyncQueue
	private readonly logger: ILogger
	private readonly platform: string
	private readonly version: number
	private readonly getOrganizationId: (taskId: string) => Promise<string | undefined>
	private readonly getMode: (taskId: string) => Promise<string | undefined>
	private readonly getModel: (taskId: string) => Promise<string | undefined>
	private readonly getParentTaskId: (taskId: string) => Promise<string | undefined>
	private readonly onSessionCreated: (message: SessionCreatedMessage) => void
	private readonly onSessionSynced: (message: SessionSyncedMessage) => void

	private pendingSync: Promise<void> | null = null

	constructor(dependencies: SessionSyncServiceDependencies) {
		this.sessionClient = dependencies.sessionClient
		this.persistenceManager = dependencies.persistenceManager
		this.stateManager = dependencies.stateManager
		this.titleService = dependencies.titleService
		this.gitStateService = dependencies.gitStateService
		this.tokenValidationService = dependencies.tokenValidationService
		this.syncQueue = dependencies.syncQueue
		this.logger = dependencies.logger
		this.platform = dependencies.platform
		this.version = dependencies.version
		this.getOrganizationId = dependencies.getOrganizationId
		this.getMode = dependencies.getMode
		this.getModel = dependencies.getModel
		this.getParentTaskId = dependencies.getParentTaskId
		this.onSessionCreated = dependencies.onSessionCreated ?? (() => {})
		this.onSessionSynced = dependencies.onSessionSynced ?? (() => {})
	}

	/**
	 * Handles a file update by converting the path key to a blob key
	 * and enqueueing it for sync.
	 *
	 * @param taskId - The task ID the file belongs to
	 * @param key - The path key (e.g., 'apiConversationHistoryPath')
	 * @param value - The file path
	 */
	handleFileUpdate(taskId: string, key: string, value: string): void {
		const blobName = this.pathKeyToBlobKey(key)

		if (blobName) {
			this.syncQueue.enqueue({
				taskId,
				blobName,
				blobPath: value,
				timestamp: Date.now(),
			})
		}
	}

	/**
	 * Performs a sync operation, optionally forcing a new sync even if one is pending.
	 *
	 * When force = false: If a sync is already in progress, returns the existing promise
	 * to coalesce multiple callers onto the same sync operation.
	 *
	 * When force = true: Waits for any existing sync to complete first, then starts
	 * a fresh sync to ensure the queue is fully flushed. This prevents race conditions
	 * where concurrent syncs could process the same queue items.
	 *
	 * @param force - Whether to force a new sync after waiting for any pending sync
	 * @returns A promise that resolves when the sync is complete
	 */
	async doSync(force = false): Promise<void> {
		this.logger.debug("Doing sync", LOG_SOURCES.SESSION_SYNC)

		if (this.pendingSync) {
			this.logger.debug("Found pending sync", LOG_SOURCES.SESSION_SYNC)

			if (!force) {
				this.logger.debug("Not forced, returning pending sync", LOG_SOURCES.SESSION_SYNC)
				return this.pendingSync
			}

			// force = true: Wait for existing sync to complete first to prevent race conditions
			this.logger.debug("Forced, waiting for pending sync to complete", LOG_SOURCES.SESSION_SYNC)
			try {
				await this.pendingSync
			} catch {
				// Ignore errors from the previous sync - we'll start a fresh one
			}

			// After waiting, check if queue is empty - no need for another sync
			if (this.syncQueue.isEmpty) {
				this.logger.debug("Queue empty after pending sync, skipping forced sync", LOG_SOURCES.SESSION_SYNC)
				return
			}
		}

		this.logger.debug("Creating new sync", LOG_SOURCES.SESSION_SYNC)

		this.pendingSync = this.syncSession()

		const pendingSync = this.pendingSync

		void (async () => {
			try {
				await pendingSync
			} finally {
				if (this.pendingSync === pendingSync) {
					this.pendingSync = null

					this.logger.debug("Nulling pending sync after resolution", LOG_SOURCES.SESSION_SYNC)
				} else {
					this.logger.debug("Pending sync was replaced, not nulling", LOG_SOURCES.SESSION_SYNC)
				}
			}
		})()

		return this.pendingSync
	}

	/**
	 * Performs the actual session sync operation.
	 * This method processes all items in the queue, creating/updating sessions
	 * and uploading blobs as needed.
	 */
	private async syncSession(): Promise<void> {
		if (this.syncQueue.isEmpty) {
			return
		}

		if (process.env.KILO_DISABLE_SESSIONS) {
			this.logger.debug("Sessions disabled via KILO_DISABLE_SESSIONS, clearing queue", LOG_SOURCES.SESSION_SYNC)
			this.syncQueue.clear()
			return
		}

		const tokenValid = await this.tokenValidationService.isValid()

		if (tokenValid === null) {
			this.logger.debug("No token available for session sync, skipping", LOG_SOURCES.SESSION_SYNC)
			return
		}

		if (!tokenValid) {
			this.logger.debug("Token is invalid, skipping sync", LOG_SOURCES.SESSION_SYNC)
			return
		}

		const taskIds = this.syncQueue.getUniqueTaskIds()
		const lastItem = this.syncQueue.getLastItem()

		this.logger.debug("Starting session sync", LOG_SOURCES.SESSION_SYNC, {
			queueLength: this.syncQueue.length,
			taskCount: taskIds.size,
		})

		const gitInfo = await this.gitStateService.getGitState()

		for (const taskId of taskIds) {
			try {
				await this.syncTaskSession(taskId, gitInfo)
			} catch (error) {
				this.logger.error("Failed to sync session", LOG_SOURCES.SESSION_SYNC, {
					taskId,
					error: error instanceof Error ? error.message : String(error),
				})

				// Only invalidate cache for authentication errors
				if (this.isAuthenticationError(error)) {
					await this.tokenValidationService.invalidateCache()
				}
			}
		}

		if (lastItem) {
			const lastActiveSessionId = this.persistenceManager.getSessionForTask(lastItem.taskId) || null
			this.stateManager.setActiveSessionId(lastActiveSessionId)

			if (lastActiveSessionId) {
				this.persistenceManager.setLastSession(lastActiveSessionId)
			}
		}

		this.logger.debug("Session sync completed", LOG_SOURCES.SESSION_SYNC, {
			lastSessionId: this.stateManager.getActiveSessionId(),
			remainingQueueLength: this.syncQueue.length,
		})
	}

	/**
	 * Syncs a single task's session, creating or updating as needed.
	 *
	 * @param taskId - The task ID to sync
	 * @param gitInfo - The current git state (if available)
	 */
	private async syncTaskSession(
		taskId: string,
		gitInfo: Awaited<ReturnType<GitStateService["getGitState"]>>,
	): Promise<void> {
		const taskItems = this.syncQueue.getItemsForTask(taskId)

		this.logger.debug("Processing task", LOG_SOURCES.SESSION_SYNC, {
			taskId,
			itemCount: taskItems.length,
		})

		const basePayload: Partial<Parameters<NonNullable<typeof this.sessionClient>["create"]>[0]> = {}

		if (gitInfo?.repoUrl) {
			basePayload.git_url = gitInfo.repoUrl
		}

		let sessionId = this.persistenceManager.getSessionForTask(taskId)

		if (sessionId) {
			this.logger.debug("Found existing session for task", LOG_SOURCES.SESSION_SYNC, { taskId, sessionId })

			sessionId = await this.updateExistingSession(taskId, sessionId, basePayload, gitInfo)
		} else {
			this.logger.debug("Creating new session for task", LOG_SOURCES.SESSION_SYNC, { taskId })

			sessionId = await this.createNewSession(taskId, basePayload)
		}

		if (!sessionId) {
			this.logger.warn("No session ID available after create/get, skipping task", LOG_SOURCES.SESSION_SYNC, {
				taskId,
			})
			return
		}

		await this.uploadBlobs(taskId, sessionId, taskItems)
		await this.uploadGitState(taskId, sessionId, gitInfo)

		this.emitSessionSyncedEvent(sessionId)
	}

	/**
	 * Updates an existing session if git URL, mode, or model have changed.
	 *
	 * @param taskId - The task ID
	 * @param sessionId - The existing session ID
	 * @param basePayload - The base payload for the update
	 * @param gitInfo - The current git state
	 * @returns The session ID
	 */
	private async updateExistingSession(
		taskId: string,
		sessionId: string,
		basePayload: Partial<Parameters<NonNullable<typeof this.sessionClient>["create"]>[0]>,
		gitInfo: Awaited<ReturnType<GitStateService["getGitState"]>>,
	): Promise<string> {
		const gitUrlChanged = !!gitInfo?.repoUrl && gitInfo.repoUrl !== this.stateManager.getGitUrl(taskId)

		const currentMode = await this.getMode(taskId)
		const modeChanged = currentMode && currentMode !== this.stateManager.getMode(sessionId)

		const currentModel = await this.getModel(taskId)
		const modelChanged = currentModel && currentModel !== this.stateManager.getModel(sessionId)

		if (gitUrlChanged || modeChanged || modelChanged) {
			if (gitUrlChanged && gitInfo?.repoUrl) {
				this.logger.debug("Git URL changed, updating session", LOG_SOURCES.SESSION_SYNC, {
					sessionId,
					newGitUrl: gitInfo.repoUrl,
				})

				this.stateManager.setGitUrl(taskId, gitInfo.repoUrl)
			}

			if (modeChanged && currentMode) {
				this.logger.debug("Mode changed, updating session", LOG_SOURCES.SESSION_SYNC, {
					sessionId,
					newMode: currentMode,
					previousMode: this.stateManager.getMode(sessionId),
				})

				this.stateManager.setMode(sessionId, currentMode)
			}

			if (modelChanged && currentModel) {
				this.logger.debug("Model changed, updating session", LOG_SOURCES.SESSION_SYNC, {
					sessionId,
					newModel: currentModel,
					previousModel: this.stateManager.getModel(sessionId),
				})

				this.stateManager.setModel(sessionId, currentModel)
			}

			const updateResult = await this.sessionClient.update({
				session_id: sessionId,
				...basePayload,
				last_mode: currentMode,
				last_model: currentModel,
				version: this.version,
			})

			this.stateManager.updateTimestamp(sessionId, updateResult.updated_at)
		}

		return sessionId
	}

	/**
	 * Creates a new session for a task.
	 *
	 * @param taskId - The task ID
	 * @param basePayload - The base payload for the create
	 * @returns The new session ID
	 */
	private async createNewSession(
		taskId: string,
		basePayload: Partial<Parameters<NonNullable<typeof this.sessionClient>["create"]>[0]>,
	): Promise<string> {
		const currentMode = await this.getMode(taskId)
		const currentModel = await this.getModel(taskId)
		const parentTaskId = await this.getParentTaskId(taskId)

		const parentSessionId = parentTaskId ? this.persistenceManager.getSessionForTask(parentTaskId) : undefined

		const createdSession = await this.sessionClient.create({
			...basePayload,
			created_on_platform: this.platform,
			version: this.version,
			organization_id: await this.getOrganizationId(taskId),
			last_mode: currentMode,
			last_model: currentModel,
			parent_session_id: parentSessionId,
		})

		const sessionId = createdSession.session_id

		if (currentMode) {
			this.stateManager.setMode(sessionId, currentMode)
		}

		if (currentModel) {
			this.stateManager.setModel(sessionId, currentModel)
		}

		this.logger.info("Created new session", LOG_SOURCES.SESSION_SYNC, { taskId, sessionId })

		this.persistenceManager.setSessionForTask(taskId, createdSession.session_id)

		this.onSessionCreated({
			timestamp: Date.now(),
			event: "session_created",
			sessionId: createdSession.session_id,
		})

		return sessionId
	}

	/**
	 * Reads blob files asynchronously with caching to avoid redundant reads.
	 * @param items Queue items to read files for
	 * @returns Map of file path to parsed contents
	 */
	private async readBlobFiles(items: ReturnType<SyncQueue["getItemsForTask"]>): Promise<Map<string, unknown>> {
		const cache = new Map<string, unknown>()
		const uniquePaths = new Set(items.map((item) => item.blobPath))

		await Promise.all(
			Array.from(uniquePaths).map(async (path) => {
				try {
					const content = await fs.readFile(path, "utf-8")
					cache.set(path, JSON.parse(content))
				} catch (error) {
					// Log error but don't fail the entire batch
					this.logger.warn(`Failed to read blob file: ${path}`, LOG_SOURCES.SESSION_SYNC, {
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}),
		)

		return cache
	}

	/**
	 * Uploads blobs for a task's session.
	 *
	 * @param taskId - The task ID
	 * @param sessionId - The session ID
	 * @param taskItems - The queue items for this task
	 */
	private async uploadBlobs(
		taskId: string,
		sessionId: string,
		taskItems: ReturnType<SyncQueue["getItemsForTask"]>,
	): Promise<void> {
		const blobNames = new Set(taskItems.map((item) => item.blobName))
		const blobUploads: Promise<unknown>[] = []

		this.logger.debug("Uploading blobs for session", LOG_SOURCES.SESSION_SYNC, {
			sessionId,
			blobNames: Array.from(blobNames),
		})

		// Read all blob files asynchronously with caching
		const fileCache = await this.readBlobFiles(taskItems)

		for (const blobName of blobNames) {
			const lastBlobItem = this.syncQueue.getLastItemForBlob(taskId, blobName)

			if (!lastBlobItem) {
				this.logger.warn("Could not find blob item for task", LOG_SOURCES.SESSION_SYNC, {
					blobName,
					taskId,
				})
				continue
			}

			const fileContents = fileCache.get(lastBlobItem.blobPath)

			if (fileContents === undefined) {
				this.logger.warn("File contents not found in cache, skipping blob", LOG_SOURCES.SESSION_SYNC, {
					blobName,
					blobPath: lastBlobItem.blobPath,
				})
				continue
			}

			blobUploads.push(
				this.sessionClient
					.uploadBlob(
						sessionId,
						lastBlobItem.blobName as Parameters<typeof this.sessionClient.uploadBlob>[1],
						fileContents,
					)
					.then((result) => {
						this.logger.debug("Blob uploaded successfully", LOG_SOURCES.SESSION_SYNC, {
							sessionId,
							blobName,
						})

						// Track the updated_at timestamp from the upload using high-water mark
						this.stateManager.updateTimestamp(sessionId, result.updated_at)

						// Remove processed items from the queue
						this.syncQueue.removeProcessedItems(taskId, blobName, lastBlobItem.timestamp)
					})
					.catch((error) => {
						this.logger.error("Failed to upload blob", LOG_SOURCES.SESSION_SYNC, {
							sessionId,
							blobName,
							error: error instanceof Error ? error.message : String(error),
						})
					}),
			)

			// Trigger title generation for ui_messages if no title exists
			if (blobName === "ui_messages" && !this.stateManager.hasTitle(sessionId)) {
				this.logger.debug("Triggering session title generation", LOG_SOURCES.SESSION_SYNC, { sessionId })

				// Delegate title generation to the title service
				void this.titleService.generateAndUpdateTitle(sessionId, fileContents as ClineMessage[])
			}
		}

		await Promise.all(blobUploads)

		this.logger.debug("Completed blob uploads for task", LOG_SOURCES.SESSION_SYNC, {
			taskId,
			sessionId,
			uploadCount: blobUploads.length,
		})
	}

	/**
	 * Uploads git state for a session if it has changed.
	 *
	 * @param taskId - The task ID
	 * @param sessionId - The session ID
	 * @param gitInfo - The current git state
	 */
	private async uploadGitState(
		taskId: string,
		sessionId: string,
		gitInfo: Awaited<ReturnType<GitStateService["getGitState"]>>,
	): Promise<void> {
		if (!gitInfo) {
			return
		}

		const gitStateData = {
			head: gitInfo.head,
			patch: gitInfo.patch,
			branch: gitInfo.branch,
		}

		const gitStateHash = this.gitStateService.hashGitState(gitStateData)

		if (gitStateHash === this.stateManager.getGitHash(taskId)) {
			this.logger.debug("Git state unchanged, skipping upload", LOG_SOURCES.SESSION_SYNC, { sessionId })
			return
		}

		this.logger.debug("Git state changed, uploading", LOG_SOURCES.SESSION_SYNC, {
			sessionId,
			head: gitInfo.head?.substring(0, 8),
		})

		this.stateManager.setGitHash(taskId, gitStateHash)

		try {
			const result = await this.sessionClient.uploadBlob(sessionId, "git_state", gitStateData)
			// Track the updated_at timestamp from git state upload using high-water mark
			this.stateManager.updateTimestamp(sessionId, result.updated_at)
		} catch (error) {
			this.logger.error("Failed to upload git state", LOG_SOURCES.SESSION_SYNC, {
				sessionId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Emits a session synced event with the latest updated_at timestamp.
	 *
	 * @param sessionId - The session ID
	 */
	private emitSessionSyncedEvent(sessionId: string): void {
		const latestUpdatedAt = this.stateManager.getUpdatedAt(sessionId)

		if (latestUpdatedAt) {
			const updatedAtTimestamp = new Date(latestUpdatedAt).getTime()
			this.onSessionSynced({
				sessionId,
				updatedAt: updatedAtTimestamp,
				timestamp: Date.now(),
				event: "session_synced",
			})

			this.logger.debug("Emitted session_synced event", LOG_SOURCES.SESSION_SYNC, {
				sessionId,
				updatedAt: updatedAtTimestamp,
			})
		}
	}

	/**
	 * Converts a path key to a blob key.
	 *
	 * @param pathKey - The path key (e.g., 'apiConversationHistoryPath')
	 * @returns The blob key (e.g., 'api_conversation_history') or null if not recognized
	 */
	private pathKeyToBlobKey(pathKey: string): string | null {
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

	/**
	 * Determines if an error is an authentication error that should trigger cache invalidation.
	 *
	 * @param error - The error to check
	 * @returns True if the error is an authentication error, false otherwise
	 */
	private isAuthenticationError(error: unknown): boolean {
		if (error instanceof Error) {
			const message = error.message.toLowerCase()
			// Check for common auth error indicators
			if (
				message.includes("401") ||
				message.includes("403") ||
				message.includes("unauthorized") ||
				message.includes("authentication") ||
				message.includes("token")
			) {
				return true
			}
		}
		return false
	}
}

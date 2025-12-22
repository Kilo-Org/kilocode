import type { IPathProvider } from "../types/IPathProvider.js"
import type { ILogger } from "../types/ILogger.js"
import type { IExtensionMessenger } from "../types/IExtensionMessenger.js"
import type { ITaskDataProvider } from "../types/ITaskDataProvider.js"
import {
	SessionClient,
	type ListSessionsInput,
	type ListSessionsOutput,
	type GetSessionInput,
	type GetSessionOutput,
	type SearchSessionInput,
	type SearchSessionOutput,
	type DeleteSessionInput,
	type DeleteSessionOutput,
} from "./SessionClient.js"
import { TrpcClient, type TrpcClientDependencies } from "./TrpcClient.js"
import { SessionPersistenceManager } from "../utils/SessionPersistenceManager.js"
import { GitStateService } from "./GitStateService.js"
import { SessionStateManager } from "./SessionStateManager.js"
import { SyncQueue } from "./SyncQueue.js"
import { TokenValidationService } from "./TokenValidationService.js"
import { SessionTitleService, type SessionTitleGeneratedMessage } from "./SessionTitleService.js"
import { SessionLifecycleService } from "./SessionLifecycleService.js"
import {
	SessionSyncService,
	type SessionCreatedMessage,
	type SessionSyncedMessage,
} from "./SessionSyncService.js"
import { LOG_SOURCES } from "../config.js"

// Re-export types for external consumers
export type { SessionCreatedMessage, SessionSyncedMessage } from "./SessionSyncService.js"
export type { SessionTitleGeneratedMessage } from "./SessionTitleService.js"
export type {
	ListSessionsInput,
	ListSessionsOutput,
	GetSessionInput,
	GetSessionOutput,
	SearchSessionInput,
	SearchSessionOutput,
	DeleteSessionInput,
	DeleteSessionOutput,
} from "./SessionClient.js"

export interface SessionManagerDependencies extends TrpcClientDependencies {
	platform: string
	pathProvider: IPathProvider
	logger: ILogger
	extensionMessenger: IExtensionMessenger
	onSessionCreated: (message: SessionCreatedMessage) => void
	onSessionRestored: () => void
	onSessionSynced: (message: SessionSyncedMessage) => void
	onSessionTitleGenerated: (message: SessionTitleGeneratedMessage) => void
	getOrganizationId: (taskId: string) => Promise<string | undefined>
	getMode: (taskId: string) => Promise<string | undefined>
	getModel: (taskId: string) => Promise<string | undefined>
	getParentTaskId: (taskId: string) => Promise<string | undefined>
}

/**
 * SessionManager - Facade for CLI session management.
 *
 * This class serves as the main entry point for session operations,
 * delegating to specialized services for specific functionality:
 *
 * - SessionLifecycleService: Session CRUD operations (create, restore, share, fork, rename)
 * - SessionSyncService: Queue-based synchronization with the cloud
 * - SessionTitleService: LLM-based title generation
 * - SessionStateManager: Centralized state management
 * - TokenValidationService: Authentication token validation
 *
 * The facade pattern simplifies the API for consumers while maintaining
 * separation of concerns internally.
 */
export class SessionManager {
	/**
	 * 0 - No versioning, some sessions incomplete
	 * 1 - Initial version
	 * 2 - Added organization id, last mode and last model
	 * 3 - Added parent session id
	 */
	static readonly VERSION = 3

	private static instance: SessionManager | null = null

	static init(dependencies?: SessionManagerDependencies) {
		if (dependencies) {
			SessionManager.instance = new SessionManager(dependencies)
		}

		return SessionManager.instance
	}

	/**
	 * Gets the current session ID.
	 * Returns the active session ID or falls back to the last persisted session.
	 */
	public get sessionId() {
		return this.stateManager.getActiveSessionId() || this.persistenceManager.getLastSession()?.sessionId
	}

	// Internal services - private to enforce facade pattern
	private readonly logger: ILogger
	private readonly sessionClient: SessionClient
	private readonly stateManager: SessionStateManager
	private readonly persistenceManager: SessionPersistenceManager
	private readonly syncQueue: SyncQueue
	private readonly tokenValidationService: TokenValidationService
	private readonly titleService: SessionTitleService
	private readonly lifecycleService: SessionLifecycleService
	private readonly syncService: SessionSyncService
	private readonly gitStateService: GitStateService

	private constructor(dependencies: SessionManagerDependencies) {
		this.logger = dependencies.logger

		const trpcClient = new TrpcClient({
			getToken: dependencies.getToken,
		})

		this.sessionClient = new SessionClient(trpcClient)
		this.stateManager = new SessionStateManager()
		this.persistenceManager = new SessionPersistenceManager(dependencies.pathProvider, this.stateManager)
		this.tokenValidationService = new TokenValidationService({
			sessionClient: this.sessionClient,
			stateManager: this.stateManager,
			getToken: dependencies.getToken,
			logger: this.logger,
		})
		this.titleService = new SessionTitleService({
			sessionClient: this.sessionClient,
			stateManager: this.stateManager,
			extensionMessenger: dependencies.extensionMessenger,
			logger: this.logger,
			onSessionTitleGenerated: dependencies.onSessionTitleGenerated,
		})
		this.gitStateService = new GitStateService({
			logger: this.logger,
			getWorkspaceDir: () => this.stateManager.getWorkspaceDir(),
		})

		// Create SyncQueue without a handler - we'll set it after creating syncService
		// This avoids the circular dependency where syncQueue needs syncService.doSync()
		this.syncQueue = new SyncQueue()

		this.syncService = new SessionSyncService({
			sessionClient: this.sessionClient,
			persistenceManager: this.persistenceManager,
			stateManager: this.stateManager,
			titleService: this.titleService,
			gitStateService: this.gitStateService,
			tokenValidationService: this.tokenValidationService,
			syncQueue: this.syncQueue,
			logger: this.logger,
			platform: dependencies.platform,
			version: SessionManager.VERSION,
			getOrganizationId: dependencies.getOrganizationId,
			getMode: dependencies.getMode,
			getModel: dependencies.getModel,
			getParentTaskId: dependencies.getParentTaskId,
			onSessionCreated: dependencies.onSessionCreated,
			onSessionSynced: dependencies.onSessionSynced,
		})

		// Now that syncService is created, set the flush handler
		this.syncQueue.setFlushHandler(() => this.syncService.doSync())

		this.lifecycleService = new SessionLifecycleService({
			sessionClient: this.sessionClient,
			persistenceManager: this.persistenceManager,
			stateManager: this.stateManager,
			titleService: this.titleService,
			gitStateService: this.gitStateService,
			pathProvider: dependencies.pathProvider,
			extensionMessenger: dependencies.extensionMessenger,
			logger: this.logger,
			platform: dependencies.platform,
			version: SessionManager.VERSION,
			getOrganizationId: dependencies.getOrganizationId,
			getMode: dependencies.getMode,
			getModel: dependencies.getModel,
			onSessionRestored: dependencies.onSessionRestored,
		})

		this.logger.debug("Initialized SessionManager", LOG_SOURCES.SESSION_MANAGER)
	}

	/**
	 * Handles a file update by delegating to SessionSyncService.
	 */
	handleFileUpdate(taskId: string, key: string, value: string) {
		this.syncService.handleFileUpdate(taskId, key, value)
	}

	/**
	 * Sets the workspace directory for session operations.
	 */
	setWorkspaceDirectory(dir: string) {
		this.stateManager.setWorkspaceDir(dir)
	}

	/**
	 * Restores the last session from persistence.
	 * Delegates to SessionLifecycleService.
	 */
	async restoreLastSession(): Promise<boolean> {
		return this.lifecycleService.restoreLastSession()
	}

	/**
	 * Restores a session by ID from the cloud.
	 * Delegates to SessionLifecycleService.
	 */
	async restoreSession(sessionId: string, rethrowError = false): Promise<void> {
		return this.lifecycleService.restoreSession(sessionId, rethrowError)
	}

	/**
	 * Shares a session publicly.
	 * Delegates to SessionLifecycleService.
	 */
	async shareSession(sessionIdInput?: string) {
		return this.lifecycleService.shareSession(sessionIdInput)
	}

	/**
	 * Renames a session.
	 * Delegates to SessionLifecycleService.
	 */
	async renameSession(sessionId: string, newTitle: string): Promise<void> {
		return this.lifecycleService.renameSession(sessionId, newTitle)
	}

	/**
	 * Forks a session by share ID or session ID.
	 * Delegates to SessionLifecycleService.
	 */
	async forkSession(shareOrSessionId: string, rethrowError = false): Promise<void> {
		return this.lifecycleService.forkSession(shareOrSessionId, rethrowError)
	}

	/**
	 * Gets or creates a session for a task.
	 * Delegates to SessionLifecycleService.
	 */
	async getSessionFromTask(taskId: string, provider: ITaskDataProvider): Promise<string> {
		return this.lifecycleService.getOrCreateSessionForTask(taskId, provider)
	}

	/**
	 * Performs a sync operation.
	 * Delegates to SessionSyncService.
	 */
	async doSync(force = false): Promise<void> {
		return this.syncService.doSync(force)
	}

	// ============================================================
	// Session Query Methods - Facade for SessionClient operations
	// ============================================================

	/**
	 * Lists sessions with pagination support.
	 * @param input - Optional pagination parameters (cursor, limit)
	 * @returns List of sessions and pagination cursor
	 */
	async listSessions(input?: ListSessionsInput): Promise<ListSessionsOutput> {
		return this.sessionClient.list(input)
	}

	/**
	 * Gets a specific session by ID.
	 * @param input - Session ID and optional flag to include blob URLs
	 * @returns Session details
	 */
	async getSession(input: GetSessionInput): Promise<GetSessionOutput> {
		return this.sessionClient.get(input)
	}

	/**
	 * Searches sessions by title or ID.
	 * @param input - Search parameters (search string, limit, offset)
	 * @returns Search results with total count
	 */
	async searchSessions(input: SearchSessionInput): Promise<SearchSessionOutput> {
		return this.sessionClient.search(input)
	}

	/**
	 * Deletes a session by ID.
	 * @param input - Session ID to delete
	 * @returns Deletion result
	 */
	async deleteSession(input: DeleteSessionInput): Promise<DeleteSessionOutput> {
		return this.sessionClient.delete(input)
	}
}

import { SessionManager } from "../SessionManager"
import { SessionClient } from "../SessionClient"
import { TrpcClient } from "../TrpcClient"
import { SessionStateManager } from "../SessionStateManager"
import { SessionPersistenceManager } from "../../utils/SessionPersistenceManager"
import { TokenValidationService } from "../TokenValidationService"
import { SessionTitleService } from "../SessionTitleService"
import { SessionLifecycleService } from "../SessionLifecycleService"
import { SessionSyncService } from "../SessionSyncService"
import { GitStateService } from "../GitStateService"
import { SyncQueue } from "../SyncQueue"
import type { IPathProvider } from "../../types/IPathProvider"
import type { ILogger } from "../../types/ILogger"
import type { IExtensionMessenger } from "../../types/IExtensionMessenger"
import type { ITaskDataProvider } from "../../types/ITaskDataProvider"

vi.mock("../SessionClient")
vi.mock("../TrpcClient")
vi.mock("../SessionStateManager")
vi.mock("../../utils/SessionPersistenceManager")
vi.mock("../TokenValidationService")
vi.mock("../SessionTitleService")
vi.mock("../SessionLifecycleService")
vi.mock("../SessionSyncService")
vi.mock("../GitStateService")
vi.mock("../SyncQueue")

describe("SessionManager", () => {
	let mockSessionClient: any
	let mockTrpcClient: any
	let mockStateManager: any
	let mockPersistenceManager: any
	let mockTokenValidationService: any
	let mockTitleService: any
	let mockLifecycleService: any
	let mockSyncService: any
	let mockGitStateService: any
	let mockSyncQueue: any
	let mockPathProvider: IPathProvider
	let mockLogger: ILogger
	let mockExtensionMessenger: IExtensionMessenger
	let mockGetToken: any
	let mockOnSessionCreated: any
	let mockOnSessionRestored: any
	let mockOnSessionSynced: any
	let mockOnSessionTitleGenerated: any
	let mockGetOrganizationId: any
	let mockGetMode: any
	let mockGetModel: any
	let mockGetParentTaskId: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Reset singleton
		;(SessionManager as any).instance = null

		mockSessionClient = {
			list: vi.fn(),
			get: vi.fn(),
		}

		mockTrpcClient = {}

		mockStateManager = {
			getActiveSessionId: vi.fn(),
			setWorkspaceDir: vi.fn(),
		}

		mockPersistenceManager = {
			getLastSession: vi.fn(),
		}

		mockTokenValidationService = {}

		mockTitleService = {}

		mockLifecycleService = {
			restoreLastSession: vi.fn(),
			restoreSession: vi.fn(),
			shareSession: vi.fn(),
			renameSession: vi.fn(),
			forkSession: vi.fn(),
			getOrCreateSessionForTask: vi.fn(),
		}

		mockSyncService = {
			handleFileUpdate: vi.fn(),
			doSync: vi.fn(),
		}

		mockGitStateService = {}

		mockSyncQueue = {
			setFlushHandler: vi.fn(),
		}

		// Mock constructors
		vi.mocked(SessionClient).mockImplementation(() => mockSessionClient)
		vi.mocked(TrpcClient).mockImplementation(() => mockTrpcClient)
		vi.mocked(SessionStateManager).mockImplementation(() => mockStateManager)
		vi.mocked(SessionPersistenceManager).mockImplementation(() => mockPersistenceManager)
		vi.mocked(TokenValidationService).mockImplementation(() => mockTokenValidationService)
		vi.mocked(SessionTitleService).mockImplementation(() => mockTitleService)
		vi.mocked(SessionLifecycleService).mockImplementation(() => mockLifecycleService)
		vi.mocked(SessionSyncService).mockImplementation(() => mockSyncService)
		vi.mocked(GitStateService).mockImplementation(() => mockGitStateService)
		vi.mocked(SyncQueue).mockImplementation(() => mockSyncQueue)

		mockPathProvider = {
			getTasksDir: vi.fn().mockReturnValue("/mock/tasks"),
			getSessionFilePath: vi.fn(),
		}

		mockLogger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		}

		mockExtensionMessenger = {
			sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
			requestSingleCompletion: vi.fn().mockResolvedValue("Generated title"),
		}

		mockGetToken = vi.fn().mockReturnValue("mock-token")
		mockOnSessionCreated = vi.fn()
		mockOnSessionRestored = vi.fn()
		mockOnSessionSynced = vi.fn()
		mockOnSessionTitleGenerated = vi.fn()
		mockGetOrganizationId = vi.fn().mockResolvedValue("org-123")
		mockGetMode = vi.fn().mockResolvedValue("code")
		mockGetModel = vi.fn().mockResolvedValue("gpt-4")
		mockGetParentTaskId = vi.fn().mockResolvedValue(undefined)
	})

	describe("Singleton Pattern", () => {
		it("init creates instance with dependencies", () => {
			const dependencies = {
				platform: "test-platform",
				pathProvider: mockPathProvider,
				logger: mockLogger,
				extensionMessenger: mockExtensionMessenger,
				getToken: mockGetToken,
				onSessionCreated: mockOnSessionCreated,
				onSessionRestored: mockOnSessionRestored,
				onSessionSynced: mockOnSessionSynced,
				onSessionTitleGenerated: mockOnSessionTitleGenerated,
				getOrganizationId: mockGetOrganizationId,
				getMode: mockGetMode,
				getModel: mockGetModel,
				getParentTaskId: mockGetParentTaskId,
			}

			const instance = SessionManager.init(dependencies)

			expect(instance).toBeDefined()
			expect(SessionClient).toHaveBeenCalledWith(mockTrpcClient)
			expect(SessionStateManager).toHaveBeenCalled()
			expect(SessionPersistenceManager).toHaveBeenCalledWith(mockPathProvider, mockStateManager)
			expect(TokenValidationService).toHaveBeenCalled()
			expect(SessionTitleService).toHaveBeenCalled()
			expect(GitStateService).toHaveBeenCalled()
			expect(SyncQueue).toHaveBeenCalled()
			expect(SessionSyncService).toHaveBeenCalled()
			expect(SessionLifecycleService).toHaveBeenCalled()
			expect(mockSyncQueue.setFlushHandler).toHaveBeenCalled()
			expect(mockLogger.debug).toHaveBeenCalledWith("Initialized SessionManager", expect.any(String))
		})

		it("init returns existing instance when called without deps", () => {
			// First init with deps
			const dependencies = {
				platform: "test-platform",
				pathProvider: mockPathProvider,
				logger: mockLogger,
				extensionMessenger: mockExtensionMessenger,
				getToken: mockGetToken,
				onSessionCreated: mockOnSessionCreated,
				onSessionRestored: mockOnSessionRestored,
				onSessionSynced: mockOnSessionSynced,
				onSessionTitleGenerated: mockOnSessionTitleGenerated,
				getOrganizationId: mockGetOrganizationId,
				getMode: mockGetMode,
				getModel: mockGetModel,
				getParentTaskId: mockGetParentTaskId,
			}
			const firstInstance = SessionManager.init(dependencies)

			// Second init without deps
			const secondInstance = SessionManager.init()

			expect(secondInstance).toBe(firstInstance)
		})

		it("init returns null when no instance and no deps", () => {
			const result = SessionManager.init()

			expect(result).toBeNull()
		})
	})

	describe("sessionId Property", () => {
		beforeEach(() => {
			const dependencies = {
				platform: "test-platform",
				pathProvider: mockPathProvider,
				logger: mockLogger,
				extensionMessenger: mockExtensionMessenger,
				getToken: mockGetToken,
				onSessionCreated: mockOnSessionCreated,
				onSessionRestored: mockOnSessionRestored,
				onSessionSynced: mockOnSessionSynced,
				onSessionTitleGenerated: mockOnSessionTitleGenerated,
				getOrganizationId: mockGetOrganizationId,
				getMode: mockGetMode,
				getModel: mockGetModel,
				getParentTaskId: mockGetParentTaskId,
			}
			SessionManager.init(dependencies)
		})

		it("returns active session ID when available", () => {
			mockStateManager.getActiveSessionId.mockReturnValue("active-session-123")

			const result = (SessionManager.init() as any).sessionId

			expect(result).toBe("active-session-123")
		})

		it("falls back to last persisted session", () => {
			mockStateManager.getActiveSessionId.mockReturnValue(null)
			mockPersistenceManager.getLastSession.mockReturnValue({
				sessionId: "persisted-session-123",
				timestamp: 1234567890,
			})

			const result = (SessionManager.init() as any).sessionId

			expect(result).toBe("persisted-session-123")
		})

		it("returns undefined when no session", () => {
			mockStateManager.getActiveSessionId.mockReturnValue(null)
			mockPersistenceManager.getLastSession.mockReturnValue(undefined)

			const result = (SessionManager.init() as any).sessionId

			expect(result).toBeUndefined()
		})
	})

	describe("Delegation Methods", () => {
		let manager: any

		beforeEach(() => {
			const dependencies = {
				platform: "test-platform",
				pathProvider: mockPathProvider,
				logger: mockLogger,
				extensionMessenger: mockExtensionMessenger,
				getToken: mockGetToken,
				onSessionCreated: mockOnSessionCreated,
				onSessionRestored: mockOnSessionRestored,
				onSessionSynced: mockOnSessionSynced,
				onSessionTitleGenerated: mockOnSessionTitleGenerated,
				getOrganizationId: mockGetOrganizationId,
				getMode: mockGetMode,
				getModel: mockGetModel,
				getParentTaskId: mockGetParentTaskId,
			}
			manager = SessionManager.init(dependencies)
		})

		it("handleFileUpdate delegates to syncService", () => {
			manager.handleFileUpdate("task-123", "key", "value")

			expect(mockSyncService.handleFileUpdate).toHaveBeenCalledWith("task-123", "key", "value")
		})

		it("setWorkspaceDirectory delegates to stateManager", () => {
			manager.setWorkspaceDirectory("/workspace")

			expect(mockStateManager.setWorkspaceDir).toHaveBeenCalledWith("/workspace")
		})

		it("restoreLastSession delegates to lifecycleService", async () => {
			mockLifecycleService.restoreLastSession.mockResolvedValue(true)

			const result = await manager.restoreLastSession()

			expect(mockLifecycleService.restoreLastSession).toHaveBeenCalled()
			expect(result).toBe(true)
		})

		it("restoreSession delegates to lifecycleService", async () => {
			mockLifecycleService.restoreSession.mockResolvedValue(undefined)

			await manager.restoreSession("session-123")

			expect(mockLifecycleService.restoreSession).toHaveBeenCalledWith("session-123", false)
		})

		it("shareSession delegates to lifecycleService", async () => {
			mockLifecycleService.shareSession.mockResolvedValue({ share_id: "share-123" })

			const result = await manager.shareSession("session-123")

			expect(mockLifecycleService.shareSession).toHaveBeenCalledWith("session-123")
			expect(result).toEqual({ share_id: "share-123" })
		})

		it("renameSession delegates to lifecycleService", async () => {
			mockLifecycleService.renameSession.mockResolvedValue(undefined)

			await manager.renameSession("session-123", "New Title")

			expect(mockLifecycleService.renameSession).toHaveBeenCalledWith("session-123", "New Title")
		})

		it("forkSession delegates to lifecycleService", async () => {
			mockLifecycleService.forkSession.mockResolvedValue(undefined)

			await manager.forkSession("share-or-session-123")

			expect(mockLifecycleService.forkSession).toHaveBeenCalledWith("share-or-session-123", false)
		})

		it("getSessionFromTask delegates to lifecycleService", async () => {
			const mockProvider: ITaskDataProvider = {
				getTaskWithId: vi.fn(),
			}
			mockLifecycleService.getOrCreateSessionForTask.mockResolvedValue("session-123")

			const result = await manager.getSessionFromTask("task-123", mockProvider)

			expect(mockLifecycleService.getOrCreateSessionForTask).toHaveBeenCalledWith("task-123", mockProvider)
			expect(result).toBe("session-123")
		})

		it("doSync delegates to syncService", async () => {
			mockSyncService.doSync.mockResolvedValue(undefined)

			await manager.doSync(true)

			expect(mockSyncService.doSync).toHaveBeenCalledWith(true)
		})

		it("listSessions delegates to sessionClient", async () => {
			const mockResult = { sessions: [], cursor: null }
			mockSessionClient.list.mockResolvedValue(mockResult)

			const result = await manager.listSessions({ limit: 10 })

			expect(mockSessionClient.list).toHaveBeenCalledWith({ limit: 10 })
			expect(result).toEqual(mockResult)
		})

		it("getSession delegates to sessionClient", async () => {
			const mockResult = { session_id: "session-123", title: "Test" }
			mockSessionClient.get.mockResolvedValue(mockResult)

			const result = await manager.getSession({ session_id: "session-123" })

			expect(mockSessionClient.get).toHaveBeenCalledWith({ session_id: "session-123" })
			expect(result).toEqual(mockResult)
		})
	})

	describe("Service Initialization", () => {
		it("creates all required services", () => {
			const dependencies = {
				platform: "test-platform",
				pathProvider: mockPathProvider,
				logger: mockLogger,
				extensionMessenger: mockExtensionMessenger,
				getToken: mockGetToken,
				onSessionCreated: mockOnSessionCreated,
				onSessionRestored: mockOnSessionRestored,
				onSessionSynced: mockOnSessionSynced,
				onSessionTitleGenerated: mockOnSessionTitleGenerated,
				getOrganizationId: mockGetOrganizationId,
				getMode: mockGetMode,
				getModel: mockGetModel,
				getParentTaskId: mockGetParentTaskId,
			}

			SessionManager.init(dependencies)

			expect(SessionClient).toHaveBeenCalled()
			expect(SessionStateManager).toHaveBeenCalled()
			expect(SessionPersistenceManager).toHaveBeenCalled()
			expect(TokenValidationService).toHaveBeenCalled()
			expect(SessionTitleService).toHaveBeenCalled()
			expect(GitStateService).toHaveBeenCalled()
			expect(SyncQueue).toHaveBeenCalled()
			expect(SessionSyncService).toHaveBeenCalled()
			expect(SessionLifecycleService).toHaveBeenCalled()
		})

		it("sets flush handler on sync queue", () => {
			const dependencies = {
				platform: "test-platform",
				pathProvider: mockPathProvider,
				logger: mockLogger,
				extensionMessenger: mockExtensionMessenger,
				getToken: mockGetToken,
				onSessionCreated: mockOnSessionCreated,
				onSessionRestored: mockOnSessionRestored,
				onSessionSynced: mockOnSessionSynced,
				onSessionTitleGenerated: mockOnSessionTitleGenerated,
				getOrganizationId: mockGetOrganizationId,
				getMode: mockGetMode,
				getModel: mockGetModel,
				getParentTaskId: mockGetParentTaskId,
			}

			SessionManager.init(dependencies)

			expect(mockSyncQueue.setFlushHandler).toHaveBeenCalledWith(expect.any(Function))
		})

		it("logs initialization message", () => {
			const dependencies = {
				platform: "test-platform",
				pathProvider: mockPathProvider,
				logger: mockLogger,
				extensionMessenger: mockExtensionMessenger,
				getToken: mockGetToken,
				onSessionCreated: mockOnSessionCreated,
				onSessionRestored: mockOnSessionRestored,
				onSessionSynced: mockOnSessionSynced,
				onSessionTitleGenerated: mockOnSessionTitleGenerated,
				getOrganizationId: mockGetOrganizationId,
				getMode: mockGetMode,
				getModel: mockGetModel,
				getParentTaskId: mockGetParentTaskId,
			}

			SessionManager.init(dependencies)

			expect(mockLogger.debug).toHaveBeenCalledWith("Initialized SessionManager", expect.any(String))
		})
	})
})

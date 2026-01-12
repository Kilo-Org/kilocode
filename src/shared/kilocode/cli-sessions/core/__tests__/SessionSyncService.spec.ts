import { promises as fs } from "fs"
import { SessionSyncService } from "../SessionSyncService"
import type { ILogger } from "../../types/ILogger.js"

// Mock fs
vi.mock("fs", () => ({
	promises: {
		readFile: vi.fn(),
	},
}))

// Mock dependencies
const mockLogger: ILogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
}

const mockSessionClient = {
	create: vi.fn(),
	update: vi.fn(),
	uploadBlob: vi.fn(),
}

const mockPersistenceManager = {
	getSessionForTask: vi.fn(),
	setSessionForTask: vi.fn(),
	setLastSession: vi.fn(),
}

const mockStateManager = {
	getActiveSessionId: vi.fn(),
	setActiveSessionId: vi.fn(),
	getGitUrl: vi.fn(),
	setGitUrl: vi.fn(),
	getGitHash: vi.fn(),
	setGitHash: vi.fn(),
	hasTitle: vi.fn(),
	setMode: vi.fn(),
	getMode: vi.fn(),
	setModel: vi.fn(),
	getModel: vi.fn(),
	updateTimestamp: vi.fn(),
	getUpdatedAt: vi.fn(),
}

const mockTitleService = {
	generateAndUpdateTitle: vi.fn(),
}

const mockGitStateService = {
	getGitState: vi.fn(),
	hashGitState: vi.fn(),
}

const mockTokenValidationService = {
	isValid: vi.fn(),
	invalidateCache: vi.fn(),
}

let mockSyncQueueIsEmpty = true
const mockSyncQueue = {
	enqueue: vi.fn(),
	get isEmpty() {
		return mockSyncQueueIsEmpty
	},
	length: 0,
	clear: vi.fn(),
	getUniqueTaskIds: vi.fn(),
	getItemsForTask: vi.fn(),
	getLastItem: vi.fn(),
	getLastItemForBlob: vi.fn(),
	removeProcessedItems: vi.fn(),
}

const mockGetOrganizationId = vi.fn()
const mockGetMode = vi.fn()
const mockGetModel = vi.fn()
const mockGetParentTaskId = vi.fn()
const mockOnSessionCreated = vi.fn()
const mockOnSessionSynced = vi.fn()

describe("SessionSyncService", () => {
	let service: SessionSyncService

	beforeEach(() => {
		vi.clearAllMocks()

		service = new SessionSyncService({
			sessionClient: mockSessionClient as any,
			persistenceManager: mockPersistenceManager as any,
			stateManager: mockStateManager as any,
			titleService: mockTitleService as any,
			gitStateService: mockGitStateService as any,
			tokenValidationService: mockTokenValidationService as any,
			syncQueue: mockSyncQueue as any,
			logger: mockLogger,
			platform: "test-platform",
			version: 1,
			getOrganizationId: mockGetOrganizationId,
			getMode: mockGetMode,
			getModel: mockGetModel,
			getParentTaskId: mockGetParentTaskId,
			onSessionCreated: mockOnSessionCreated,
			onSessionSynced: mockOnSessionSynced,
		})
	})

	describe("handleFileUpdate", () => {
		it("converts apiConversationHistoryPath to api_conversation_history", () => {
			service.handleFileUpdate("task-1", "apiConversationHistoryPath", "/path/to/api.json")

			expect(mockSyncQueue.enqueue).toHaveBeenCalledWith({
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/api.json",
				timestamp: expect.any(Number),
			})
		})

		it("converts uiMessagesPath to ui_messages", () => {
			service.handleFileUpdate("task-1", "uiMessagesPath", "/path/to/ui.json")

			expect(mockSyncQueue.enqueue).toHaveBeenCalledWith({
				taskId: "task-1",
				blobName: "ui_messages",
				blobPath: "/path/to/ui.json",
				timestamp: expect.any(Number),
			})
		})

		it("converts taskMetadataPath to task_metadata", () => {
			service.handleFileUpdate("task-1", "taskMetadataPath", "/path/to/metadata.json")

			expect(mockSyncQueue.enqueue).toHaveBeenCalledWith({
				taskId: "task-1",
				blobName: "task_metadata",
				blobPath: "/path/to/metadata.json",
				timestamp: expect.any(Number),
			})
		})

		it("ignores unknown path keys", () => {
			service.handleFileUpdate("task-1", "unknownPath", "/path/to/unknown.json")

			expect(mockSyncQueue.enqueue).not.toHaveBeenCalled()
		})

		it("enqueues item with correct taskId, blobName, blobPath", () => {
			service.handleFileUpdate("task-123", "apiConversationHistoryPath", "/custom/path.json")

			expect(mockSyncQueue.enqueue).toHaveBeenCalledWith({
				taskId: "task-123",
				blobName: "api_conversation_history",
				blobPath: "/custom/path.json",
				timestamp: expect.any(Number),
			})
		})
	})

	describe("doSync", () => {
		it("returns existing pending sync when not forced", async () => {
			// Create a pending sync by starting one that won't complete immediately
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")

			// Track how many times syncSession is called by tracking token validation calls
			let tokenValidationCallCount = 0
			mockTokenValidationService.isValid.mockImplementation(async () => {
				tokenValidationCallCount++
				return true
			})

			const firstCall = service.doSync()
			const secondCall = service.doSync()

			await Promise.all([firstCall, secondCall])

			// If deduplication works, syncSession should only be called once
			expect(tokenValidationCallCount).toBe(1)
		})

		it("creates new sync when forced and no pending sync", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set())
			mockGitStateService.getGitState.mockResolvedValue(null)

			const result = service.doSync(true)

			expect(result).toBeInstanceOf(Promise)
		})

		it("waits for pending sync to complete when forced", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")

			// Track the order of operations
			const operationOrder: string[] = []
			let firstSyncResolve: () => void
			const firstSyncPromise = new Promise<void>((resolve) => {
				firstSyncResolve = resolve
			})

			let tokenValidationCallCount = 0
			mockTokenValidationService.isValid.mockImplementation(async () => {
				tokenValidationCallCount++
				operationOrder.push(`tokenValidation-${tokenValidationCallCount}`)
				if (tokenValidationCallCount === 1) {
					// First sync - wait for external signal
					await firstSyncPromise
				}
				return true
			})

			// Start first sync (will wait at token validation)
			const firstCall = service.doSync()

			// Start forced sync while first is pending
			const forcedCall = service.doSync(true)

			// Let the first sync complete
			firstSyncResolve!()

			await Promise.all([firstCall, forcedCall])

			// With force=true, the second call should wait for the first to complete,
			// then start a new sync (if queue is not empty)
			// So we expect 2 token validation calls (one for each sync)
			expect(tokenValidationCallCount).toBe(2)
			expect(operationOrder).toEqual(["tokenValidation-1", "tokenValidation-2"])
		})

		it("skips forced sync when queue is empty after pending sync completes", async () => {
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")

			let tokenValidationCallCount = 0
			let firstSyncResolve: () => void
			const firstSyncPromise = new Promise<void>((resolve) => {
				firstSyncResolve = resolve
			})

			// Start with non-empty queue
			mockSyncQueueIsEmpty = false

			mockTokenValidationService.isValid.mockImplementation(async () => {
				tokenValidationCallCount++
				if (tokenValidationCallCount === 1) {
					await firstSyncPromise
				}
				return true
			})

			// Start first sync
			const firstCall = service.doSync()

			// Start forced sync while first is pending
			const forcedCall = service.doSync(true)

			// Simulate queue becoming empty after first sync processes items
			mockSyncQueueIsEmpty = true

			// Let the first sync complete
			firstSyncResolve!()

			await Promise.all([firstCall, forcedCall])

			// The forced sync should skip because queue is empty after first sync
			expect(tokenValidationCallCount).toBe(1)
		})

		it("does not run concurrent syncs when forced", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")

			// Track concurrent execution
			let concurrentSyncs = 0
			let maxConcurrentSyncs = 0
			let firstSyncResolve: () => void
			const firstSyncPromise = new Promise<void>((resolve) => {
				firstSyncResolve = resolve
			})

			mockTokenValidationService.isValid.mockImplementation(async () => {
				concurrentSyncs++
				maxConcurrentSyncs = Math.max(maxConcurrentSyncs, concurrentSyncs)
				if (concurrentSyncs === 1) {
					await firstSyncPromise
				}
				concurrentSyncs--
				return true
			})

			// Start first sync
			const firstCall = service.doSync()

			// Start forced sync while first is pending
			const forcedCall = service.doSync(true)

			// Let the first sync complete
			firstSyncResolve!()

			await Promise.all([firstCall, forcedCall])

			// With the fix, syncs should run sequentially, not concurrently
			expect(maxConcurrentSyncs).toBe(1)
		})

		it("clears pending sync after completion", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set())
			mockGitStateService.getGitState.mockResolvedValue(null)

			await service.doSync()

			expect((service as any).pendingSync).toBeNull()
		})

		it("handles concurrent sync requests", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")

			// Track how many times syncSession is called by tracking token validation calls
			let tokenValidationCallCount = 0
			mockTokenValidationService.isValid.mockImplementation(async () => {
				tokenValidationCallCount++
				return true
			})

			const sync1 = service.doSync()
			const sync2 = service.doSync()

			await Promise.all([sync1, sync2])

			// If deduplication works, syncSession should only be called once
			expect(tokenValidationCallCount).toBe(1)
		})
	})

	describe("syncSession - Private Method via doSync", () => {
		it("returns early when queue is empty", async () => {
			mockSyncQueueIsEmpty = true

			await service.doSync()

			expect(mockTokenValidationService.isValid).not.toHaveBeenCalled()
		})

		it("clears queue when KILO_DISABLE_SESSIONS is set", async () => {
			process.env.KILO_DISABLE_SESSIONS = "1"
			mockSyncQueueIsEmpty = false

			await service.doSync()

			expect(mockSyncQueue.clear).toHaveBeenCalled()
			delete process.env.KILO_DISABLE_SESSIONS
		})

		it("skips sync when no token available", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(null)

			await service.doSync()

			expect(mockGitStateService.getGitState).not.toHaveBeenCalled()
		})

		it("skips sync when token is invalid", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(false)

			await service.doSync()

			expect(mockGitStateService.getGitState).not.toHaveBeenCalled()
		})

		it("processes all unique task IDs", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1", "task-2"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			mockGetMode.mockResolvedValue("code")
			mockGetModel.mockResolvedValue("gpt-4")
			mockSessionClient.create.mockResolvedValue({
				session_id: "session-1",
				updated_at: "2023-01-01T10:00:00Z",
			})

			await service.doSync()

			expect(mockSyncQueue.getItemsForTask).toHaveBeenCalledWith("task-1")
			expect(mockSyncQueue.getItemsForTask).toHaveBeenCalledWith("task-2")
		})

		it("updates active session ID after sync", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockSyncQueue.getLastItem.mockReturnValue({ taskId: "task-1" })
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")

			await service.doSync()

			expect(mockStateManager.setActiveSessionId).toHaveBeenCalledWith("session-1")
		})

		it("persists last session after sync", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockSyncQueue.getLastItem.mockReturnValue({ taskId: "task-1" })
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")

			await service.doSync()

			expect(mockPersistenceManager.setLastSession).toHaveBeenCalledWith("session-1")
		})

		it("invalidates token cache on auth error", async () => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")
			mockGetMode.mockResolvedValue("code")
			mockGetModel.mockResolvedValue("gpt-4")
			mockSessionClient.update.mockRejectedValue(new Error("401 Unauthorized"))

			await service.doSync()

			expect(mockTokenValidationService.invalidateCache).toHaveBeenCalled()
		})
	})

	describe("Session Creation/Update", () => {
		beforeEach(() => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockSyncQueue.getLastItem.mockReturnValue({ taskId: "task-1" })
		})

		it("creates new session when none exists", async () => {
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			mockGetOrganizationId.mockResolvedValue("org-1")
			mockGetMode.mockResolvedValue("code")
			mockGetModel.mockResolvedValue("gpt-4")
			mockGetParentTaskId.mockResolvedValue(undefined)
			mockSessionClient.create.mockResolvedValue({
				session_id: "new-session-1",
				updated_at: "2023-01-01T10:00:00Z",
			})

			await service.doSync()

			expect(mockSessionClient.create).toHaveBeenCalledWith({
				created_on_platform: "test-platform",
				version: 1,
				organization_id: "org-1",
				last_mode: "code",
				last_model: "gpt-4",
				parent_session_id: undefined,
			})
		})

		it("creates new session with parent session ID when parent task exists", async () => {
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockImplementation((taskId) => {
				if (taskId === "parent-task-1") return "parent-session-1"
				return undefined
			})
			mockGetOrganizationId.mockResolvedValue("org-1")
			mockGetMode.mockResolvedValue("code")
			mockGetModel.mockResolvedValue("gpt-4")
			mockGetParentTaskId.mockResolvedValue("parent-task-1")
			mockSessionClient.create.mockResolvedValue({
				session_id: "new-session-1",
				updated_at: "2023-01-01T10:00:00Z",
			})

			await service.doSync()

			expect(mockSessionClient.create).toHaveBeenCalledWith({
				created_on_platform: "test-platform",
				version: 1,
				organization_id: "org-1",
				last_mode: "code",
				last_model: "gpt-4",
				parent_session_id: "parent-session-1",
			})
		})

		it("creates new session with parent_session_id undefined when parent task has no session", async () => {
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockImplementation((taskId) => {
				// Parent task exists but has no session
				if (taskId === "parent-task-1") return undefined
				return undefined
			})
			mockGetOrganizationId.mockResolvedValue("org-1")
			mockGetMode.mockResolvedValue("code")
			mockGetModel.mockResolvedValue("gpt-4")
			mockGetParentTaskId.mockResolvedValue("parent-task-1")
			mockSessionClient.create.mockResolvedValue({
				session_id: "new-session-1",
				updated_at: "2023-01-01T10:00:00Z",
			})

			await service.doSync()

			expect(mockSessionClient.create).toHaveBeenCalledWith({
				created_on_platform: "test-platform",
				version: 1,
				organization_id: "org-1",
				last_mode: "code",
				last_model: "gpt-4",
				parent_session_id: undefined,
			})
		})

		it("updates existing session when git URL changes", async () => {
			mockGitStateService.getGitState.mockResolvedValue({
				repoUrl: "https://github.com/user/repo.git",
				head: "abc123",
				patch: "",
				branch: "main",
			})
			mockPersistenceManager.getSessionForTask.mockReturnValue("existing-session")
			mockStateManager.getGitUrl.mockReturnValue("https://github.com/old/repo.git")
			mockGetMode.mockResolvedValue("code")
			mockGetModel.mockResolvedValue("gpt-4")
			mockSessionClient.update.mockResolvedValue({
				updated_at: "2023-01-01T10:00:00Z",
			})

			await service.doSync()

			expect(mockStateManager.setGitUrl).toHaveBeenCalledWith("task-1", "https://github.com/user/repo.git")
			expect(mockSessionClient.update).toHaveBeenCalled()
		})

		it("updates existing session when mode changes", async () => {
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("existing-session")
			mockStateManager.getMode.mockReturnValue("architect")
			mockGetMode.mockResolvedValue("code")
			mockGetModel.mockResolvedValue("gpt-4")
			mockSessionClient.update.mockResolvedValue({
				updated_at: "2023-01-01T10:00:00Z",
			})

			await service.doSync()

			expect(mockStateManager.setMode).toHaveBeenCalledWith("existing-session", "code")
			expect(mockSessionClient.update).toHaveBeenCalled()
		})

		it("updates existing session when model changes", async () => {
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("existing-session")
			mockStateManager.getModel.mockReturnValue("gpt-3")
			mockGetMode.mockResolvedValue("code")
			mockGetModel.mockResolvedValue("gpt-4")
			mockSessionClient.update.mockResolvedValue({
				updated_at: "2023-01-01T10:00:00Z",
			})

			await service.doSync()

			expect(mockStateManager.setModel).toHaveBeenCalledWith("existing-session", "gpt-4")
			expect(mockSessionClient.update).toHaveBeenCalled()
		})

		it("emits session_created event on creation", async () => {
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			mockGetOrganizationId.mockResolvedValue("org-1")
			mockGetMode.mockResolvedValue("code")
			mockGetModel.mockResolvedValue("gpt-4")
			mockSessionClient.create.mockResolvedValue({
				session_id: "new-session-1",
				updated_at: "2023-01-01T10:00:00Z",
			})

			await service.doSync()

			expect(mockOnSessionCreated).toHaveBeenCalledWith({
				sessionId: "new-session-1",
				timestamp: expect.any(Number),
				event: "session_created",
			})
		})
	})

	describe("Blob Upload", () => {
		beforeEach(() => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getLastItem.mockReturnValue({ taskId: "task-1" })
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")
			// Reset uploadBlob mock to resolve normally (not hang)
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: "2023-01-01T10:00:00Z" })
		})

		it("reads blob files asynchronously", async () => {
			const mockItems = [{ taskId: "task-1", blobName: "ui_messages", blobPath: "/path/ui.json", timestamp: 123 }]
			mockSyncQueue.getItemsForTask.mockReturnValue(mockItems)
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ messages: [] }))

			await service.doSync()

			expect(fs.readFile).toHaveBeenCalledWith("/path/ui.json", "utf-8")
		})

		it("caches file contents to avoid redundant reads", async () => {
			const mockItems = [
				{ taskId: "task-1", blobName: "ui_messages", blobPath: "/path/ui.json", timestamp: 123 },
				{ taskId: "task-1", blobName: "api_conversation_history", blobPath: "/path/ui.json", timestamp: 124 },
			]
			mockSyncQueue.getItemsForTask.mockReturnValue(mockItems)
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ messages: [] }))

			await service.doSync()

			expect(fs.readFile).toHaveBeenCalledTimes(1) // Should cache and reuse
		})

		it("uploads blobs for each unique blob name", async () => {
			const mockItems = [
				{ taskId: "task-1", blobName: "ui_messages", blobPath: "/path/ui.json", timestamp: 123 },
				{ taskId: "task-1", blobName: "api_conversation_history", blobPath: "/path/api.json", timestamp: 124 },
			]
			mockSyncQueue.getItemsForTask.mockReturnValue(mockItems)
			mockSyncQueue.getLastItemForBlob.mockImplementation((taskId, blobName) => {
				return mockItems.find((item) => item.blobName === blobName)
			})
			vi.mocked(fs.readFile).mockImplementation(async (path) => {
				if (path === "/path/ui.json") return JSON.stringify({ ui: "data" })
				if (path === "/path/api.json") return JSON.stringify({ api: "data" })
				return "{}"
			})
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: "2023-01-01T10:00:00Z" })

			await service.doSync()

			expect(mockSessionClient.uploadBlob).toHaveBeenCalledTimes(2)
		})

		it("removes processed items after successful upload", async () => {
			const mockItems = [{ taskId: "task-1", blobName: "ui_messages", blobPath: "/path/ui.json", timestamp: 123 }]
			mockSyncQueue.getItemsForTask.mockReturnValue(mockItems)
			mockSyncQueue.getLastItemForBlob.mockReturnValue(mockItems[0])
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ messages: [] }))
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: "2023-01-01T10:00:00Z" })

			await service.doSync()

			expect(mockSyncQueue.removeProcessedItems).toHaveBeenCalledWith("task-1", "ui_messages", 123)
		})

		it("triggers title generation for ui_messages", async () => {
			const mockItems = [{ taskId: "task-1", blobName: "ui_messages", blobPath: "/path/ui.json", timestamp: 123 }]
			mockSyncQueue.getItemsForTask.mockReturnValue(mockItems)
			mockSyncQueue.getLastItemForBlob.mockReturnValue(mockItems[0])
			mockStateManager.hasTitle.mockReturnValue(false)
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify([{ role: "user", content: "test" }]))
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: "2023-01-01T10:00:00Z" })

			await service.doSync()

			expect(mockTitleService.generateAndUpdateTitle).toHaveBeenCalledWith("session-1", [
				{ role: "user", content: "test" },
			])
		})

		it("logs errors on upload failure", async () => {
			const mockItems = [{ taskId: "task-1", blobName: "ui_messages", blobPath: "/path/ui.json", timestamp: 123 }]
			mockSyncQueue.getItemsForTask.mockReturnValue(mockItems)
			mockSyncQueue.getLastItemForBlob.mockReturnValue(mockItems[0])
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ messages: [] }))
			mockSessionClient.uploadBlob.mockRejectedValue(new Error("Upload failed"))

			await service.doSync()

			expect(mockLogger.error).toHaveBeenCalledWith(
				"Failed to upload blob",
				expect.any(String),
				expect.objectContaining({
					sessionId: "session-1",
					blobName: "ui_messages",
					error: "Upload failed",
				}),
			)
		})
	})

	describe("Git State Upload", () => {
		beforeEach(() => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockSyncQueue.getLastItem.mockReturnValue({ taskId: "task-1" })
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")
		})

		it("skips upload when no git info", async () => {
			mockGitStateService.getGitState.mockResolvedValue(null)

			await service.doSync()

			expect(mockSessionClient.uploadBlob).not.toHaveBeenCalled()
		})

		it("skips upload when git state unchanged", async () => {
			const gitState = {
				repoUrl: "https://github.com/user/repo.git",
				head: "abc123",
				patch: "diff content",
				branch: "main",
			}
			mockGitStateService.getGitState.mockResolvedValue(gitState)
			mockGitStateService.hashGitState.mockReturnValue("hash123")
			mockStateManager.getGitHash.mockReturnValue("hash123")

			await service.doSync()

			expect(mockSessionClient.uploadBlob).not.toHaveBeenCalled()
		})

		it("uploads git state when changed", async () => {
			const gitState = {
				repoUrl: "https://github.com/user/repo.git",
				head: "abc123",
				patch: "diff content",
				branch: "main",
			}
			mockGitStateService.getGitState.mockResolvedValue(gitState)
			mockGitStateService.hashGitState.mockReturnValue("newhash123")
			mockStateManager.getGitHash.mockReturnValue("oldhash123")
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: "2023-01-01T10:00:00Z" })

			await service.doSync()

			expect(mockSessionClient.uploadBlob).toHaveBeenCalledWith("session-1", "git_state", {
				head: "abc123",
				patch: "diff content",
				branch: "main",
			})
		})

		it("updates git hash in state manager", async () => {
			const gitState = {
				repoUrl: "https://github.com/user/repo.git",
				head: "abc123",
				patch: "diff content",
				branch: "main",
			}
			mockGitStateService.getGitState.mockResolvedValue(gitState)
			mockGitStateService.hashGitState.mockReturnValue("newhash123")
			mockStateManager.getGitHash.mockReturnValue("oldhash123")
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: "2023-01-01T10:00:00Z" })

			await service.doSync()

			expect(mockStateManager.setGitHash).toHaveBeenCalledWith("task-1", "newhash123")
		})
	})

	describe("Event Emission", () => {
		beforeEach(() => {
			mockSyncQueueIsEmpty = false
			mockTokenValidationService.isValid.mockResolvedValue(true)
			mockSyncQueue.getUniqueTaskIds.mockReturnValue(new Set(["task-1"]))
			mockSyncQueue.getItemsForTask.mockReturnValue([])
			mockSyncQueue.getLastItem.mockReturnValue({ taskId: "task-1" })
			mockGitStateService.getGitState.mockResolvedValue(null)
			mockPersistenceManager.getSessionForTask.mockReturnValue("session-1")
		})

		it("emits session_synced event with correct data", async () => {
			const testTimestamp = "2023-01-01T10:00:00Z"
			mockStateManager.getUpdatedAt.mockReturnValue(testTimestamp)

			await service.doSync()

			expect(mockOnSessionSynced).toHaveBeenCalledWith({
				sessionId: "session-1",
				updatedAt: new Date(testTimestamp).getTime(),
				timestamp: expect.any(Number),
				event: "session_synced",
			})
		})

		it("includes updatedAt timestamp in event", async () => {
			const testTimestamp = "2023-12-25T15:30:45Z"
			mockStateManager.getUpdatedAt.mockReturnValue(testTimestamp)

			await service.doSync()

			const callArgs = mockOnSessionSynced.mock.calls[0][0]
			expect(callArgs.updatedAt).toBe(new Date(testTimestamp).getTime())
		})
	})
})

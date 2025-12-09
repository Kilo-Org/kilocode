import path from "path"
import { SessionManager, SessionManagerDependencies } from "../SessionManager"
import { SessionClient, CliSessionSharedState, SessionWithSignedUrls } from "../SessionClient"
import { SessionPersistenceManager } from "../../utils/SessionPersistenceManager"
import type { ITaskDataProvider } from "../../types/ITaskDataProvider"
import type { ClineMessage } from "@roo-code/types"
import { readFileSync, writeFileSync, mkdirSync } from "fs"

vi.mock("fs", () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	mkdtempSync: vi.fn(),
	rmSync: vi.fn(),
}))

vi.mock("simple-git", () => ({
	default: vi.fn(() => ({
		getRemotes: vi.fn().mockResolvedValue([{ refs: { fetch: "https://github.com/test/repo.git" } }]),
		revparse: vi.fn().mockResolvedValue("abc123def456"),
		raw: vi.fn().mockResolvedValue(""),
		diff: vi.fn().mockResolvedValue("diff content"),
		stash: vi.fn().mockResolvedValue(undefined),
		stashList: vi.fn().mockResolvedValue({ total: 0 }),
		checkout: vi.fn().mockResolvedValue(undefined),
		applyPatch: vi.fn().mockResolvedValue(undefined),
	})),
}))

vi.mock("../TrpcClient", () => ({
	TrpcClient: vi.fn().mockImplementation(() => ({
		endpoint: "https://api.kilocode.ai",
		getToken: vi.fn().mockResolvedValue("test-token"),
		request: vi.fn(),
	})),
}))

vi.mock("../SessionClient", () => ({
	SessionClient: vi.fn().mockImplementation(() => ({
		get: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		share: vi.fn(),
		fork: vi.fn(),
		uploadBlob: vi.fn(),
	})),
	CliSessionSharedState: {
		Public: "public",
	},
}))

vi.mock("../../utils/SessionPersistenceManager", () => ({
	SessionPersistenceManager: vi.fn().mockImplementation(() => ({
		setWorkspaceDir: vi.fn(),
		getLastSession: vi.fn(),
		setLastSession: vi.fn(),
		getSessionForTask: vi.fn(),
		setSessionForTask: vi.fn(),
	})),
}))

const MOCK_TASKS_DIR = path.join("mock", "user", ".kilocode", "tasks")

const createMockDependencies = (): SessionManagerDependencies => ({
	platform: "vscode",
	getToken: vi.fn().mockResolvedValue("test-token"),
	pathProvider: {
		getTasksDir: vi.fn().mockReturnValue(MOCK_TASKS_DIR),
		getSessionFilePath: vi.fn().mockImplementation((dir: string) => path.join(dir, ".kilocode", "session.json")),
	},
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
	extensionMessenger: {
		sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
		requestSingleCompletion: vi.fn().mockResolvedValue("Generated title"),
	},
	onSessionCreated: vi.fn(),
	onSessionRestored: vi.fn(),
})

describe("SessionManager", () => {
	let manager: SessionManager
	let mockDependencies: SessionManagerDependencies

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()

		mockDependencies = createMockDependencies()

		const privateInstance = (SessionManager as unknown as { instance: SessionManager }).instance
		if (privateInstance) {
			;(privateInstance as unknown as { timer: NodeJS.Timeout | null }).timer = null
			;(privateInstance as unknown as { sessionClient: SessionClient | undefined }).sessionClient = undefined
			;(
				privateInstance as unknown as { sessionPersistenceManager: SessionPersistenceManager | undefined }
			).sessionPersistenceManager = undefined
			;(privateInstance as unknown as { queue: unknown[] }).queue = []
		}

		manager = SessionManager.init(mockDependencies)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("init", () => {
		it("should return the singleton instance", () => {
			const instance1 = SessionManager.init()
			const instance2 = SessionManager.init()

			expect(instance1).toBe(instance2)
		})

		it("should initialize dependencies when provided", () => {
			expect(manager.sessionClient).toBeDefined()
			expect(manager.sessionPersistenceManager).toBeDefined()
		})

		it("should set up sync interval timer", () => {
			expect(vi.getTimerCount()).toBe(1)
		})

		it("should initialize pendingSync as null", () => {
			const pendingSync = (manager as unknown as { pendingSync: Promise<void> | null }).pendingSync
			expect(pendingSync).toBeNull()
		})
	})

	describe("sessionId", () => {
		it("should return null when no active session", () => {
			vi.mocked(manager.sessionPersistenceManager!.getLastSession).mockReturnValue(undefined)

			expect(manager.sessionId).toBeUndefined()
		})

		it("should return persisted session ID when available", () => {
			vi.mocked(manager.sessionPersistenceManager!.getLastSession).mockReturnValue({
				sessionId: "persisted-session-123",
				timestamp: Date.now(),
			})

			expect(manager.sessionId).toBe("persisted-session-123")
		})
	})

	describe("setWorkspaceDirectory", () => {
		it("should set workspace directory on persistence manager", () => {
			manager.setWorkspaceDirectory("/workspace/project")

			expect(manager.sessionPersistenceManager!.setWorkspaceDir).toHaveBeenCalledWith("/workspace/project")
		})
	})

	describe("handleFileUpdate", () => {
		it("should add api conversation history to queue", () => {
			manager.handleFileUpdate("task-123", "apiConversationHistoryPath", "/path/to/file.json")

			const queue = (manager as unknown as { queue: unknown[] }).queue
			expect(queue).toHaveLength(1)
			expect(queue[0]).toMatchObject({
				taskId: "task-123",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file.json",
			})
		})

		it("should add ui messages to queue", () => {
			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/ui.json")

			const queue = (manager as unknown as { queue: unknown[] }).queue
			expect(queue).toHaveLength(1)
			expect(queue[0]).toMatchObject({
				taskId: "task-123",
				blobName: "ui_messages",
			})
		})

		it("should add task metadata to queue", () => {
			manager.handleFileUpdate("task-123", "taskMetadataPath", "/path/to/metadata.json")

			const queue = (manager as unknown as { queue: unknown[] }).queue
			expect(queue).toHaveLength(1)
			expect(queue[0]).toMatchObject({
				taskId: "task-123",
				blobName: "task_metadata",
			})
		})

		it("should not add unknown path keys to queue", () => {
			manager.handleFileUpdate("task-123", "unknownPath", "/path/to/file.json")

			const queue = (manager as unknown as { queue: unknown[] }).queue
			expect(queue).toHaveLength(0)
		})
	})

	describe("restoreLastSession", () => {
		it("should return false when no persisted session exists", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getLastSession).mockReturnValue(undefined)

			const result = await manager.restoreLastSession()

			expect(result).toBe(false)
		})

		it("should return false when manager not initialized", async () => {
			;(manager as unknown as { sessionPersistenceManager: undefined }).sessionPersistenceManager = undefined

			const result = await manager.restoreLastSession()

			expect(result).toBe(false)
		})

		it("should attempt to restore persisted session", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getLastSession).mockReturnValue({
				sessionId: "session-to-restore",
				timestamp: Date.now(),
			})

			const mockSession: SessionWithSignedUrls = {
				session_id: "session-to-restore",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			}

			vi.mocked(manager.sessionClient!.get).mockResolvedValue(mockSession)

			const result = await manager.restoreLastSession()

			expect(result).toBe(true)
			expect(manager.sessionClient!.get).toHaveBeenCalledWith({
				session_id: "session-to-restore",
				include_blob_urls: true,
			})
		})

		it("should return false when restore fails", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getLastSession).mockReturnValue({
				sessionId: "session-to-restore",
				timestamp: Date.now(),
			})

			vi.mocked(manager.sessionClient!.get).mockRejectedValue(new Error("Network error"))

			const result = await manager.restoreLastSession()

			expect(result).toBe(false)
			expect(mockDependencies.logger.warn).toHaveBeenCalled()
		})
	})

	describe("restoreSession", () => {
		it("should throw error when manager not initialized and rethrowError is true", async () => {
			;(manager as unknown as { pathProvider: undefined }).pathProvider = undefined

			await expect(manager.restoreSession("session-123", true)).rejects.toThrow(
				"SessionManager used before initialization",
			)
		})

		it("should not throw error when manager not initialized and rethrowError is false", async () => {
			;(manager as unknown as { pathProvider: undefined }).pathProvider = undefined

			await expect(manager.restoreSession("session-123")).resolves.toBeUndefined()
			expect(mockDependencies.logger.error).toHaveBeenCalled()
		})

		it("should throw error when session not found", async () => {
			vi.mocked(manager.sessionClient!.get).mockResolvedValue(undefined as unknown as SessionWithSignedUrls)

			await expect(manager.restoreSession("session-123", true)).rejects.toThrow("Failed to obtain session")
		})

		it("should create session directory", async () => {
			const mockSession: SessionWithSignedUrls = {
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			}

			vi.mocked(manager.sessionClient!.get).mockResolvedValue(mockSession)

			await manager.restoreSession("session-123")

			expect(mkdirSync).toHaveBeenCalledWith(path.join(MOCK_TASKS_DIR, "session-123"), { recursive: true })
		})

		it("should send webview messages to register and show task", async () => {
			const mockSession: SessionWithSignedUrls = {
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			}

			vi.mocked(manager.sessionClient!.get).mockResolvedValue(mockSession)

			await manager.restoreSession("session-123")

			expect(mockDependencies.extensionMessenger.sendWebviewMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "addTaskToHistory",
				}),
			)
			expect(mockDependencies.extensionMessenger.sendWebviewMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "session-123",
			})
		})

		it("should call onSessionRestored callback", async () => {
			const mockSession: SessionWithSignedUrls = {
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			}

			vi.mocked(manager.sessionClient!.get).mockResolvedValue(mockSession)

			await manager.restoreSession("session-123")

			expect(mockDependencies.onSessionRestored).toHaveBeenCalled()
		})

		it("should persist task-to-session mapping when restoring session", async () => {
			const mockSession: SessionWithSignedUrls = {
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			}

			vi.mocked(manager.sessionClient!.get).mockResolvedValue(mockSession)

			await manager.restoreSession("session-123")

			expect(manager.sessionPersistenceManager!.setSessionForTask).toHaveBeenCalledWith(
				"session-123",
				"session-123",
			)
		})

		it("should fetch and write blobs when URLs are provided", async () => {
			const mockSession: SessionWithSignedUrls = {
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: "https://storage.example.com/api_history.json",
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			}

			vi.mocked(manager.sessionClient!.get).mockResolvedValue(mockSession)

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue([{ role: "user", content: "test" }]),
			})

			await manager.restoreSession("session-123")

			expect(global.fetch).toHaveBeenCalledWith("https://storage.example.com/api_history.json")
			expect(writeFileSync).toHaveBeenCalled()
		})

		it("should filter checkpoint_saved messages from ui_messages", async () => {
			const mockSession: SessionWithSignedUrls = {
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: "https://storage.example.com/ui_messages.json",
				git_state_blob_url: null,
			}

			vi.mocked(manager.sessionClient!.get).mockResolvedValue(mockSession)

			const uiMessages = [
				{ say: "text", text: "Hello" },
				{ say: "checkpoint_saved", text: "Checkpoint" },
				{ say: "text", text: "World" },
			]

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(uiMessages),
			})

			await manager.restoreSession("session-123")

			const writeCall = vi
				.mocked(writeFileSync)
				.mock.calls.find((call) => (call[0] as string).includes("ui_messages"))
			expect(writeCall).toBeDefined()
			const writtenContent = JSON.parse(writeCall![1] as string)
			expect(writtenContent).toHaveLength(2)
			expect(writtenContent.every((msg: ClineMessage) => msg.say !== "checkpoint_saved")).toBe(true)
		})
	})

	describe("shareSession", () => {
		it("should throw error when manager not initialized", async () => {
			;(manager as unknown as { sessionClient: undefined }).sessionClient = undefined

			await expect(manager.shareSession()).rejects.toThrow("SessionManager used before initialization")
		})

		it("should throw error when no active session", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getLastSession).mockReturnValue(undefined)

			await expect(manager.shareSession()).rejects.toThrow("No active session")
		})

		it("should share session with provided session ID", async () => {
			vi.mocked(manager.sessionClient!.share).mockResolvedValue({
				share_id: "share-123",
				session_id: "session-456",
			})

			const result = await manager.shareSession("session-456")

			expect(manager.sessionClient!.share).toHaveBeenCalledWith({
				session_id: "session-456",
				shared_state: CliSessionSharedState.Public,
			})
			expect(result).toEqual({ share_id: "share-123", session_id: "session-456" })
		})

		it("should use current session ID when not provided", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getLastSession).mockReturnValue({
				sessionId: "current-session",
				timestamp: Date.now(),
			})
			vi.mocked(manager.sessionClient!.share).mockResolvedValue({
				share_id: "share-123",
				session_id: "current-session",
			})

			await manager.shareSession()

			expect(manager.sessionClient!.share).toHaveBeenCalledWith({
				session_id: "current-session",
				shared_state: CliSessionSharedState.Public,
			})
		})
	})

	describe("renameSession", () => {
		it("should throw error when manager not initialized", async () => {
			;(manager as unknown as { sessionClient: undefined }).sessionClient = undefined

			await expect(manager.renameSession("session-123", "New Title")).rejects.toThrow(
				"SessionManager used before initialization",
			)
		})

		it("should throw error when session ID is empty", async () => {
			await expect(manager.renameSession("", "New Title")).rejects.toThrow("No active session")
		})

		it("should throw error when title is empty or whitespace", async () => {
			await expect(manager.renameSession("session-123", "   ")).rejects.toThrow("Session title cannot be empty")
		})

		it("should update session with trimmed title", async () => {
			vi.mocked(manager.sessionClient!.update).mockResolvedValue({
				session_id: "session-123",
				title: "New Title",
				updated_at: new Date().toISOString(),
			})

			await manager.renameSession("session-123", "  New Title  ")

			expect(manager.sessionClient!.update).toHaveBeenCalledWith({
				session_id: "session-123",
				title: "New Title",
			})
		})
	})

	describe("forkSession", () => {
		it("should throw error when manager not initialized", async () => {
			;(manager as unknown as { platform: undefined }).platform = undefined

			await expect(manager.forkSession("share-123")).rejects.toThrow("SessionManager used before initialization")
		})

		it("should fork session and restore it", async () => {
			vi.mocked(manager.sessionClient!.fork).mockResolvedValue({
				session_id: "forked-session-456",
			})

			const mockSession: SessionWithSignedUrls = {
				session_id: "forked-session-456",
				title: "Forked Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			}

			vi.mocked(manager.sessionClient!.get).mockResolvedValue(mockSession)

			await manager.forkSession("share-123")

			expect(manager.sessionClient!.fork).toHaveBeenCalledWith({
				share_or_session_id: "share-123",
				created_on_platform: "vscode",
			})
			expect(manager.sessionClient!.get).toHaveBeenCalledWith({
				session_id: "forked-session-456",
				include_blob_urls: true,
			})
		})
	})

	describe("getSessionFromTask", () => {
		let mockTaskDataProvider: ITaskDataProvider

		beforeEach(() => {
			mockTaskDataProvider = {
				getTaskWithId: vi.fn().mockResolvedValue({
					historyItem: { task: "Test task" },
					apiConversationHistoryFilePath: "/path/to/api_history.json",
					uiMessagesFilePath: "/path/to/ui_messages.json",
				}),
			}
		})

		it("should throw error when manager not initialized", async () => {
			;(manager as unknown as { platform: undefined }).platform = undefined

			await expect(manager.getSessionFromTask("task-123", mockTaskDataProvider)).rejects.toThrow(
				"SessionManager used before initialization",
			)
		})

		it("should return existing session ID when task is already mapped", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("existing-session-123")

			const result = await manager.getSessionFromTask("task-123", mockTaskDataProvider)

			expect(result).toBe("existing-session-123")
			expect(manager.sessionClient!.create).not.toHaveBeenCalled()
		})

		it("should create new session when task is not mapped", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.create).mockResolvedValue({
				session_id: "new-session-456",
				title: "Test task",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue()

			const result = await manager.getSessionFromTask("task-123", mockTaskDataProvider)

			expect(result).toBe("new-session-456")
			expect(manager.sessionClient!.create).toHaveBeenCalledWith({
				title: "Test task",
				created_on_platform: "vscode",
			})
			expect(manager.sessionPersistenceManager!.setSessionForTask).toHaveBeenCalledWith(
				"task-123",
				"new-session-456",
			)
		})

		it("should upload conversation blobs for new session", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([{ role: "user", content: "test" }]))
			vi.mocked(manager.sessionClient!.create).mockResolvedValue({
				session_id: "new-session-456",
				title: "Test task",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue()

			await manager.getSessionFromTask("task-123", mockTaskDataProvider)

			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"new-session-456",
				"api_conversation_history",
				expect.any(Array),
			)
			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"new-session-456",
				"ui_messages",
				expect.any(Array),
			)
		})
	})

	describe("getFirstMessageText", () => {
		it("should return null for empty messages array", () => {
			const result = manager.getFirstMessageText([])

			expect(result).toBeNull()
		})

		it("should return null when no message has text", () => {
			const messages: ClineMessage[] = [{ type: "say", say: "text" } as ClineMessage]

			const result = manager.getFirstMessageText(messages)

			expect(result).toBeNull()
		})

		it("should return first message text", () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "text", text: "Hello world" } as ClineMessage,
				{ type: "say", say: "text", text: "Second message" } as ClineMessage,
			]

			const result = manager.getFirstMessageText(messages)

			expect(result).toBe("Hello world")
		})

		it("should normalize whitespace in message text", () => {
			const messages: ClineMessage[] = [{ type: "say", say: "text", text: "Hello   \n\t  world" } as ClineMessage]

			const result = manager.getFirstMessageText(messages)

			expect(result).toBe("Hello world")
		})

		it("should truncate long messages when truncate is true", () => {
			const longText = "A".repeat(200)
			const messages: ClineMessage[] = [{ type: "say", say: "text", text: longText } as ClineMessage]

			const result = manager.getFirstMessageText(messages, true)

			expect(result).toHaveLength(140)
			expect(result?.endsWith("...")).toBe(true)
		})

		it("should not truncate short messages when truncate is true", () => {
			const messages: ClineMessage[] = [{ type: "say", say: "text", text: "Short message" } as ClineMessage]

			const result = manager.getFirstMessageText(messages, true)

			expect(result).toBe("Short message")
		})

		it("should skip messages without text and return first with text", () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "text" } as ClineMessage,
				{ type: "say", say: "text", text: "" } as ClineMessage,
				{ type: "say", say: "text", text: "Found it" } as ClineMessage,
			]

			const result = manager.getFirstMessageText(messages)

			expect(result).toBe("Found it")
		})
	})

	describe("generateTitle", () => {
		it("should return null for empty messages", async () => {
			const result = await manager.generateTitle([])

			expect(result).toBeNull()
		})

		it("should generate title using LLM", async () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "text", text: "Create a React component for user authentication" } as ClineMessage,
			]

			vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockResolvedValue(
				"React auth component",
			)

			const result = await manager.generateTitle(messages)

			expect(result).toBe("React auth component")
			expect(mockDependencies.extensionMessenger.requestSingleCompletion).toHaveBeenCalledWith(
				expect.stringContaining("Create a React component"),
				30000,
			)
		})

		it("should clean quotes from generated title", async () => {
			const messages: ClineMessage[] = [{ type: "say", say: "text", text: "Test message" } as ClineMessage]

			vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockResolvedValue('"Quoted title"')

			const result = await manager.generateTitle(messages)

			expect(result).toBe("Quoted title")
		})

		it("should truncate long generated titles", async () => {
			const messages: ClineMessage[] = [{ type: "say", say: "text", text: "Test message" } as ClineMessage]

			vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockResolvedValue("A".repeat(200))

			const result = await manager.generateTitle(messages)

			expect(result).toHaveLength(140)
			expect(result?.endsWith("...")).toBe(true)
		})

		it("should fall back to truncated message on LLM error", async () => {
			const longMessage = "B".repeat(200)
			const messages: ClineMessage[] = [{ type: "say", say: "text", text: longMessage } as ClineMessage]

			vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockRejectedValue(
				new Error("LLM error"),
			)

			const result = await manager.generateTitle(messages)

			expect(result).toHaveLength(140)
			expect(result?.endsWith("...")).toBe(true)
			expect(mockDependencies.logger.warn).toHaveBeenCalled()
		})

		it("should return raw text when short and LLM fails", async () => {
			const messages: ClineMessage[] = [{ type: "say", say: "text", text: "Short message" } as ClineMessage]

			vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockRejectedValue(
				new Error("LLM error"),
			)

			const result = await manager.generateTitle(messages)

			expect(result).toBe("Short message")
		})

		it("should fall back to raw text when extension messenger not initialized", async () => {
			;(manager as unknown as { extensionMessenger: undefined }).extensionMessenger = undefined

			const messages: ClineMessage[] = [{ type: "say", say: "text", text: "Test message" } as ClineMessage]

			const result = await manager.generateTitle(messages)

			expect(result).toBe("Test message")
		})
	})

	describe("destroy", () => {
		it("should return a promise", async () => {
			const syncSessionSpy = vi.spyOn(manager as unknown as { syncSession: () => Promise<void> }, "syncSession")
			syncSessionSpy.mockResolvedValue(undefined)

			const result = manager.destroy()

			expect(result).toBeInstanceOf(Promise)
		})

		it("should return existing pendingSync when one exists", async () => {
			const existingPromise = Promise.resolve()
			;(manager as unknown as { pendingSync: Promise<void> | null }).pendingSync = existingPromise

			const result = manager.destroy()

			expect(result).toBe(existingPromise)
		})

		it("should log debug message when destroying", async () => {
			const syncSessionSpy = vi.spyOn(manager as unknown as { syncSession: () => Promise<void> }, "syncSession")
			syncSessionSpy.mockResolvedValue(undefined)

			manager.destroy()

			expect(mockDependencies.logger.debug).toHaveBeenCalledWith("Destroying SessionManager", "SessionManager")
		})
	})

	describe("getGitState patch size limit", () => {
		it("should return patch when size is under the limit", async () => {
			const simpleGit = await import("simple-git")
			const smallPatch = "a".repeat(1000)

			const mockRaw = vi.fn().mockResolvedValue("")
			vi.mocked(simpleGit.default).mockReturnValue({
				getRemotes: vi.fn().mockResolvedValue([{ refs: { fetch: "https://github.com/test/repo.git" } }]),
				revparse: vi.fn().mockResolvedValue("abc123def456"),
				raw: mockRaw,
				diff: vi.fn().mockResolvedValue(smallPatch),
			} as unknown as ReturnType<typeof simpleGit.default>)

			const getGitState = (manager as unknown as { getGitState: () => Promise<{ patch?: string }> }).getGitState
			const result = await getGitState.call(manager)

			expect(result.patch).toBe(smallPatch)
		})

		it("should return empty string patch when size exceeds the limit", async () => {
			const simpleGit = await import("simple-git")
			const largePatch = "a".repeat(2 * 1024 * 1024)

			const mockRaw = vi.fn().mockResolvedValue("")
			vi.mocked(simpleGit.default).mockReturnValue({
				getRemotes: vi.fn().mockResolvedValue([{ refs: { fetch: "https://github.com/test/repo.git" } }]),
				revparse: vi.fn().mockResolvedValue("abc123def456"),
				raw: mockRaw,
				diff: vi.fn().mockResolvedValue(largePatch),
			} as unknown as ReturnType<typeof simpleGit.default>)

			const getGitState = (manager as unknown as { getGitState: () => Promise<{ patch?: string }> }).getGitState
			const result = await getGitState.call(manager)

			expect(result.patch).toBe("")
		})

		it("should log warning when patch exceeds size limit", async () => {
			const simpleGit = await import("simple-git")
			const largePatch = "a".repeat(2 * 1024 * 1024)

			const mockRaw = vi.fn().mockResolvedValue("")
			vi.mocked(simpleGit.default).mockReturnValue({
				getRemotes: vi.fn().mockResolvedValue([{ refs: { fetch: "https://github.com/test/repo.git" } }]),
				revparse: vi.fn().mockResolvedValue("abc123def456"),
				raw: mockRaw,
				diff: vi.fn().mockResolvedValue(largePatch),
			} as unknown as ReturnType<typeof simpleGit.default>)

			const getGitState = (manager as unknown as { getGitState: () => Promise<{ patch?: string }> }).getGitState
			await getGitState.call(manager)

			expect(mockDependencies.logger.warn).toHaveBeenCalledWith("Git patch too large", "SessionManager", {
				patchSize: largePatch.length,
				maxSize: SessionManager.MAX_PATCH_SIZE_BYTES,
			})
		})

		it("should return patch when size is exactly at the limit", async () => {
			const simpleGit = await import("simple-git")
			const exactLimitPatch = "a".repeat(1024 * 1024)

			const mockRaw = vi.fn().mockResolvedValue("")
			vi.mocked(simpleGit.default).mockReturnValue({
				getRemotes: vi.fn().mockResolvedValue([{ refs: { fetch: "https://github.com/test/repo.git" } }]),
				revparse: vi.fn().mockResolvedValue("abc123def456"),
				raw: mockRaw,
				diff: vi.fn().mockResolvedValue(exactLimitPatch),
			} as unknown as ReturnType<typeof simpleGit.default>)

			const getGitState = (manager as unknown as { getGitState: () => Promise<{ patch?: string }> }).getGitState
			const result = await getGitState.call(manager)

			expect(result.patch).toBe(exactLimitPatch)
		})

		it("should return empty string patch when size is one byte over the limit", async () => {
			const simpleGit = await import("simple-git")
			const overLimitPatch = "a".repeat(1024 * 1024 + 1)

			const mockRaw = vi.fn().mockResolvedValue("")
			vi.mocked(simpleGit.default).mockReturnValue({
				getRemotes: vi.fn().mockResolvedValue([{ refs: { fetch: "https://github.com/test/repo.git" } }]),
				revparse: vi.fn().mockResolvedValue("abc123def456"),
				raw: mockRaw,
				diff: vi.fn().mockResolvedValue(overLimitPatch),
			} as unknown as ReturnType<typeof simpleGit.default>)

			const getGitState = (manager as unknown as { getGitState: () => Promise<{ patch?: string }> }).getGitState
			const result = await getGitState.call(manager)

			expect(result.patch).toBe("")
		})
	})
})

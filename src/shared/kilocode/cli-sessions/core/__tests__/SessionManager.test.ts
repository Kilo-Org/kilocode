import { readFileSync, mkdirSync } from "fs"
import type { IPathProvider } from "../../types/IPathProvider"
import type { ILogger } from "../../types/ILogger"
import type { IExtensionMessenger } from "../../types/IExtensionMessenger"
import type { ITaskDataProvider } from "../../types/ITaskDataProvider"
import { SessionManager, SessionManagerDependencies } from "../SessionManager"
import { CliSessionSharedState } from "../SessionClient"
import type { ClineMessage } from "@roo-code/types"

vi.mock("fs", () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	mkdtempSync: vi.fn(),
	rmSync: vi.fn(),
}))

vi.mock("path", async () => {
	const actual = await vi.importActual("path")
	return {
		...actual,
		default: {
			...actual,
			join: vi.fn((...args: string[]) => args.join("/")),
		},
	}
})

vi.mock("simple-git", () => ({
	default: vi.fn(() => ({
		getRemotes: vi.fn(),
		revparse: vi.fn(),
		raw: vi.fn(),
		diff: vi.fn(),
		stash: vi.fn(),
		stashList: vi.fn(),
		checkout: vi.fn(),
		applyPatch: vi.fn(),
	})),
}))

vi.mock("os", () => ({
	tmpdir: vi.fn(() => "/tmp"),
}))

vi.mock("crypto", () => ({
	createHash: vi.fn(() => ({
		update: vi.fn().mockReturnThis(),
		digest: vi.fn().mockReturnValue("mock-hash"),
	})),
}))

vi.mock("../TrpcClient", () => ({
	TrpcClient: vi.fn().mockImplementation(() => ({
		endpoint: "https://api.example.com",
		getToken: vi.fn().mockResolvedValue("mock-token"),
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

function createMockPathProvider(): IPathProvider {
	return {
		getTasksDir: vi.fn().mockReturnValue("/home/user/.kilocode/tasks"),
		getSessionFilePath: vi
			.fn()
			.mockImplementation((workspaceDir: string) => `${workspaceDir}/.kilocode/session.json`),
	}
}

function createMockLogger(): ILogger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}
}

function createMockExtensionMessenger(): IExtensionMessenger {
	return {
		sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
		requestSingleCompletion: vi.fn().mockResolvedValue("Generated Title"),
	}
}

function createMockDependencies(): SessionManagerDependencies {
	return {
		platform: "vscode",
		pathProvider: createMockPathProvider(),
		logger: createMockLogger(),
		extensionMessenger: createMockExtensionMessenger(),
		getToken: vi.fn().mockResolvedValue("mock-token"),
		onSessionCreated: vi.fn(),
		onSessionRestored: vi.fn(),
	}
}

describe("SessionManager", () => {
	let sessionManager: SessionManager
	let mockDependencies: SessionManagerDependencies

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()

		mockDependencies = createMockDependencies()
		sessionManager = SessionManager.init(mockDependencies)
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

		it("should initialize with dependencies when provided", () => {
			const deps = createMockDependencies()
			const instance = SessionManager.init(deps)

			expect(instance).toBeDefined()
			expect(instance.sessionClient).toBeDefined()
			expect(instance.sessionPersistenceManager).toBeDefined()
		})

		it("should initialize timer property", () => {
			const deps = createMockDependencies()
			const instance = SessionManager.init(deps)

			expect(instance["timer"]).not.toBeNull()
		})
	})

	describe("setPath", () => {
		it("should set the apiConversationHistoryPath", () => {
			sessionManager.setPath("task-123", "apiConversationHistoryPath", "/path/to/api_conversation_history.json")

			expect(sessionManager["currentTaskId"]).toBe("task-123")
			expect(sessionManager["paths"].apiConversationHistoryPath).toBe("/path/to/api_conversation_history.json")
		})

		it("should set the uiMessagesPath", () => {
			sessionManager.setPath("task-123", "uiMessagesPath", "/path/to/ui_messages.json")

			expect(sessionManager["paths"].uiMessagesPath).toBe("/path/to/ui_messages.json")
		})

		it("should set the taskMetadataPath", () => {
			sessionManager.setPath("task-123", "taskMetadataPath", "/path/to/task_metadata.json")

			expect(sessionManager["paths"].taskMetadataPath).toBe("/path/to/task_metadata.json")
		})

		it("should update blob hash when path is set", () => {
			const initialHash = sessionManager["blobHashes"].apiConversationHistory

			sessionManager.setPath("task-123", "apiConversationHistoryPath", "/path/to/file.json")

			expect(sessionManager["blobHashes"].apiConversationHistory).not.toBe(initialHash)
		})
	})

	describe("setWorkspaceDirectory", () => {
		it("should set the workspace directory", () => {
			sessionManager.setWorkspaceDirectory("/workspace")

			expect(sessionManager["workspaceDir"]).toBe("/workspace")
		})

		it("should propagate workspace directory to persistence manager", () => {
			sessionManager.setWorkspaceDirectory("/workspace")

			expect(sessionManager.sessionPersistenceManager?.setWorkspaceDir).toHaveBeenCalledWith("/workspace")
		})
	})

	describe("restoreLastSession", () => {
		it("should return false when no persisted session exists", async () => {
			vi.mocked(sessionManager.sessionPersistenceManager!.getLastSession).mockReturnValue(undefined)

			const result = await sessionManager.restoreLastSession()

			expect(result).toBe(false)
		})

		it("should return false when persisted session has no sessionId", async () => {
			vi.mocked(sessionManager.sessionPersistenceManager!.getLastSession).mockReturnValue({
				sessionId: "",
				timestamp: Date.now(),
			})

			const result = await sessionManager.restoreLastSession()

			expect(result).toBe(false)
		})

		it("should attempt to restore session when persisted session exists", async () => {
			vi.mocked(sessionManager.sessionPersistenceManager!.getLastSession).mockReturnValue({
				sessionId: "session-123",
				timestamp: Date.now(),
			})
			vi.mocked(sessionManager.sessionClient!.get).mockResolvedValue({
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			})

			const result = await sessionManager.restoreLastSession()

			expect(result).toBe(true)
			expect(sessionManager.sessionClient!.get).toHaveBeenCalledWith({
				session_id: "session-123",
				include_blob_urls: true,
			})
		})

		it("should return false when restore fails", async () => {
			vi.mocked(sessionManager.sessionPersistenceManager!.getLastSession).mockReturnValue({
				sessionId: "session-123",
				timestamp: Date.now(),
			})
			vi.mocked(sessionManager.sessionClient!.get).mockRejectedValue(new Error("Network error"))

			const result = await sessionManager.restoreLastSession()

			expect(result).toBe(false)
		})
	})

	describe("restoreSession", () => {
		it("should throw error if SessionManager is not initialized", async () => {
			const uninitializedManager = SessionManager.init()
			uninitializedManager["pathProvider"] = undefined

			await expect(uninitializedManager.restoreSession("session-123", true)).rejects.toThrow(
				"SessionManager used before initialization",
			)
		})

		it("should set sessionId and reset blob hashes", async () => {
			vi.mocked(sessionManager.sessionClient!.get).mockResolvedValue({
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			})

			await sessionManager.restoreSession("session-123")

			expect(sessionManager.sessionId).toBe("session-123")
		})

		it("should throw error when session is not found", async () => {
			vi.mocked(sessionManager.sessionClient!.get).mockResolvedValue(undefined as never)

			await expect(sessionManager.restoreSession("session-123", true)).rejects.toThrow("Failed to obtain session")
		})

		it("should create session directory", async () => {
			vi.mocked(sessionManager.sessionClient!.get).mockResolvedValue({
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			})

			await sessionManager.restoreSession("session-123")

			expect(mkdirSync).toHaveBeenCalledWith("/home/user/.kilocode/tasks/session-123", { recursive: true })
		})

		it("should send webview messages to add task to history", async () => {
			vi.mocked(sessionManager.sessionClient!.get).mockResolvedValue({
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			})

			await sessionManager.restoreSession("session-123")

			expect(mockDependencies.extensionMessenger.sendWebviewMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "addTaskToHistory",
					historyItem: expect.objectContaining({
						id: "session-123",
						task: "Test Session",
					}),
				}),
			)
		})

		it("should send showTaskWithId message", async () => {
			vi.mocked(sessionManager.sessionClient!.get).mockResolvedValue({
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			})

			await sessionManager.restoreSession("session-123")

			expect(mockDependencies.extensionMessenger.sendWebviewMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "session-123",
			})
		})

		it("should call onSessionRestored callback", async () => {
			vi.mocked(sessionManager.sessionClient!.get).mockResolvedValue({
				session_id: "session-123",
				title: "Test Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			})

			await sessionManager.restoreSession("session-123")

			expect(mockDependencies.onSessionRestored).toHaveBeenCalled()
		})

		it("should reset session state on error when rethrowError is false", async () => {
			vi.mocked(sessionManager.sessionClient!.get).mockRejectedValue(new Error("Network error"))

			await sessionManager.restoreSession("session-123", false)

			expect(sessionManager.sessionId).toBeNull()
			expect(sessionManager["sessionTitle"]).toBeNull()
			expect(sessionManager["sessionGitUrl"]).toBeNull()
		})

		it("should rethrow error when rethrowError is true", async () => {
			vi.mocked(sessionManager.sessionClient!.get).mockRejectedValue(new Error("Network error"))

			await expect(sessionManager.restoreSession("session-123", true)).rejects.toThrow("Network error")
		})
	})

	describe("shareSession", () => {
		it("should throw error when no active session", async () => {
			sessionManager.sessionId = null

			await expect(sessionManager.shareSession()).rejects.toThrow("No active session")
		})

		it("should share the active session", async () => {
			sessionManager.sessionId = "session-123"
			vi.mocked(sessionManager.sessionClient!.share).mockResolvedValue({
				share_id: "share-456",
				session_id: "session-123",
			})

			const result = await sessionManager.shareSession()

			expect(sessionManager.sessionClient!.share).toHaveBeenCalledWith({
				session_id: "session-123",
				shared_state: CliSessionSharedState.Public,
			})
			expect(result).toEqual({
				share_id: "share-456",
				session_id: "session-123",
			})
		})

		it("should share a specific session when sessionId is provided", async () => {
			sessionManager.sessionId = "active-session"
			vi.mocked(sessionManager.sessionClient!.share).mockResolvedValue({
				share_id: "share-789",
				session_id: "specific-session",
			})

			await sessionManager.shareSession("specific-session")

			expect(sessionManager.sessionClient!.share).toHaveBeenCalledWith({
				session_id: "specific-session",
				shared_state: CliSessionSharedState.Public,
			})
		})
	})

	describe("renameSession", () => {
		it("should throw error when no active session", async () => {
			await expect(sessionManager.renameSession("", "New Title")).rejects.toThrow("No active session")
		})

		it("should throw error when title is empty", async () => {
			await expect(sessionManager.renameSession("session-123", "   ")).rejects.toThrow(
				"Session title cannot be empty",
			)
		})

		it("should rename the session", async () => {
			vi.mocked(sessionManager.sessionClient!.update).mockResolvedValue({
				session_id: "session-123",
				title: "New Title",
				updated_at: new Date().toISOString(),
			})

			await sessionManager.renameSession("session-123", "New Title")

			expect(sessionManager.sessionClient!.update).toHaveBeenCalledWith({
				session_id: "session-123",
				title: "New Title",
			})
			expect(sessionManager["sessionTitle"]).toBe("New Title")
		})

		it("should trim the title", async () => {
			vi.mocked(sessionManager.sessionClient!.update).mockResolvedValue({
				session_id: "session-123",
				title: "Trimmed Title",
				updated_at: new Date().toISOString(),
			})

			await sessionManager.renameSession("session-123", "  Trimmed Title  ")

			expect(sessionManager.sessionClient!.update).toHaveBeenCalledWith({
				session_id: "session-123",
				title: "Trimmed Title",
			})
		})
	})

	describe("forkSession", () => {
		it("should throw error if SessionManager is not initialized", async () => {
			sessionManager["platform"] = undefined

			await expect(sessionManager.forkSession("share-123")).rejects.toThrow(
				"SessionManager used before initialization",
			)
		})

		it("should fork the session and restore it", async () => {
			vi.mocked(sessionManager.sessionClient!.fork).mockResolvedValue({
				session_id: "forked-session-456",
			})
			vi.mocked(sessionManager.sessionClient!.get).mockResolvedValue({
				session_id: "forked-session-456",
				title: "Forked Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			})

			await sessionManager.forkSession("share-123")

			expect(sessionManager.sessionClient!.fork).toHaveBeenCalledWith({
				share_or_session_id: "share-123",
				created_on_platform: "vscode",
			})
			expect(sessionManager.sessionId).toBe("forked-session-456")
		})
	})

	describe("getSessionFromTask", () => {
		let mockTaskDataProvider: ITaskDataProvider

		beforeEach(() => {
			mockTaskDataProvider = {
				getTaskWithId: vi.fn().mockResolvedValue({
					historyItem: { task: "Test Task" },
					apiConversationHistoryFilePath: "/path/to/api.json",
					uiMessagesFilePath: "/path/to/ui.json",
				}),
			}
		})

		it("should throw error if SessionManager is not initialized", async () => {
			sessionManager["platform"] = undefined

			await expect(sessionManager.getSessionFromTask("task-123", mockTaskDataProvider)).rejects.toThrow(
				"SessionManager used before initialization",
			)
		})

		it("should return existing session if task is already mapped", async () => {
			vi.mocked(sessionManager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("existing-session")

			const result = await sessionManager.getSessionFromTask("task-123", mockTaskDataProvider)

			expect(result).toBe("existing-session")
			expect(sessionManager.sessionClient!.create).not.toHaveBeenCalled()
		})

		it("should create new session if task is not mapped", async () => {
			vi.mocked(sessionManager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([{ text: "Hello" }]))
			vi.mocked(sessionManager.sessionClient!.create).mockResolvedValue({
				session_id: "new-session-123",
				title: "Test Task",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})

			const result = await sessionManager.getSessionFromTask("task-123", mockTaskDataProvider)

			expect(result).toBe("new-session-123")
			expect(sessionManager.sessionClient!.create).toHaveBeenCalledWith(
				expect.objectContaining({
					title: "Test Task",
				}),
			)
		})

		it("should upload blobs after creating session", async () => {
			vi.mocked(sessionManager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([{ text: "Hello" }]))
			vi.mocked(sessionManager.sessionClient!.create).mockResolvedValue({
				session_id: "new-session-123",
				title: "Test Task",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})

			await sessionManager.getSessionFromTask("task-123", mockTaskDataProvider)

			expect(sessionManager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"new-session-123",
				"api_conversation_history",
				expect.anything(),
			)
			expect(sessionManager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"new-session-123",
				"ui_messages",
				expect.anything(),
			)
		})

		it("should persist task-session mapping", async () => {
			vi.mocked(sessionManager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([{ text: "Hello" }]))
			vi.mocked(sessionManager.sessionClient!.create).mockResolvedValue({
				session_id: "new-session-123",
				title: "Test Task",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})

			await sessionManager.getSessionFromTask("task-123", mockTaskDataProvider)

			expect(sessionManager.sessionPersistenceManager!.setSessionForTask).toHaveBeenCalledWith(
				"task-123",
				"new-session-123",
			)
		})
	})

	describe("destroy", () => {
		it("should clear the timer", async () => {
			const initialTimerCount = vi.getTimerCount()
			sessionManager["timer"] = setInterval(() => {}, 1000)

			await sessionManager.destroy()

			expect(sessionManager["timer"]).not.toBeNull()
		})

		it("should reset paths and session state", async () => {
			sessionManager.sessionId = "session-123"
			sessionManager["sessionTitle"] = "Test Session"

			await sessionManager.destroy()

			expect(sessionManager.sessionId).toBeNull()
			expect(sessionManager["sessionTitle"]).toBeNull()
		})

		it("should wait for sync to complete if syncing", async () => {
			sessionManager.sessionId = "session-123"
			sessionManager["isSyncing"] = true

			const destroyPromise = sessionManager.destroy()
			vi.advanceTimersByTime(2000)
			await destroyPromise

			expect(sessionManager["isSyncing"]).toBe(false)
		})

		it("should clear currentTaskId to prevent session ID clobbering across tasks", async () => {
			sessionManager.setPath("task-A", "apiConversationHistoryPath", "/path/to/taskA/api.json")
			sessionManager.sessionId = "session-A"
			vi.mocked(sessionManager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-A")
			vi.mocked(sessionManager.sessionClient!.create).mockResolvedValue({
				session_id: "session-B",
				title: "Task B",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})

			await sessionManager.destroy()

			expect(sessionManager["currentTaskId"]).toBeNull()
			expect(sessionManager.sessionId).toBeNull()

			sessionManager.setPath("task-B", "apiConversationHistoryPath", "/path/to/taskB/api.json")

			vi.mocked(sessionManager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)

			await sessionManager["syncSession"]()

			expect(sessionManager.sessionId).toBe("session-B")
			expect(sessionManager.sessionId).not.toBe("session-A")
		})
	})

	describe("getFirstMessageText", () => {
		it("should return null for empty messages array", () => {
			const result = sessionManager.getFirstMessageText([])

			expect(result).toBeNull()
		})

		it("should return null when no message has text", () => {
			const messages = [{ type: "say" }, { type: "ask" }] as ClineMessage[]

			const result = sessionManager.getFirstMessageText(messages)

			expect(result).toBeNull()
		})

		it("should return the first message with text", () => {
			const messages = [
				{ type: "say", text: "" },
				{ type: "say", text: "Hello World" },
				{ type: "say", text: "Second message" },
			] as ClineMessage[]

			const result = sessionManager.getFirstMessageText(messages)

			expect(result).toBe("Hello World")
		})

		it("should normalize whitespace in the message", () => {
			const messages = [{ type: "say", text: "Hello   World\n\nTest" }] as ClineMessage[]

			const result = sessionManager.getFirstMessageText(messages)

			expect(result).toBe("Hello World Test")
		})

		it("should truncate message when truncate is true and message exceeds 140 chars", () => {
			const longText = "A".repeat(200)
			const messages = [{ type: "say", text: longText }] as ClineMessage[]

			const result = sessionManager.getFirstMessageText(messages, true)

			expect(result).toHaveLength(140)
			expect(result?.endsWith("...")).toBe(true)
		})

		it("should not truncate message when truncate is true but message is under 140 chars", () => {
			const messages = [{ type: "say", text: "Short message" }] as ClineMessage[]

			const result = sessionManager.getFirstMessageText(messages, true)

			expect(result).toBe("Short message")
		})

		it("should return null for whitespace-only message", () => {
			const messages = [{ type: "say", text: "   \n\t   " }] as ClineMessage[]

			const result = sessionManager.getFirstMessageText(messages)

			expect(result).toBeNull()
		})
	})

	describe("generateTitle", () => {
		it("should return null for empty messages", async () => {
			const result = await sessionManager.generateTitle([])

			expect(result).toBeNull()
		})

		it("should return raw text if under 140 characters", async () => {
			const messages = [{ type: "say", text: "Short task description" }] as ClineMessage[]

			const result = await sessionManager.generateTitle(messages)

			expect(result).toBe("Short task description")
		})

		it("should use LLM to generate title for long messages", async () => {
			const longText = "A".repeat(200)
			const messages = [{ type: "say", text: longText }] as ClineMessage[]
			vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockResolvedValue("Short summary")

			const result = await sessionManager.generateTitle(messages)

			expect(mockDependencies.extensionMessenger.requestSingleCompletion).toHaveBeenCalled()
			expect(result).toBe("Short summary")
		})

		it("should remove quotes from generated title", async () => {
			const longText = "A".repeat(200)
			const messages = [{ type: "say", text: longText }] as ClineMessage[]
			vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockResolvedValue('"Quoted summary"')

			const result = await sessionManager.generateTitle(messages)

			expect(result).toBe("Quoted summary")
		})

		it("should truncate generated title if over 140 characters", async () => {
			const longText = "A".repeat(200)
			const messages = [{ type: "say", text: longText }] as ClineMessage[]
			vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockResolvedValue("B".repeat(200))

			const result = await sessionManager.generateTitle(messages)

			expect(result).toHaveLength(140)
			expect(result?.endsWith("...")).toBe(true)
		})

		it("should fallback to truncation on LLM error", async () => {
			const longText = "A".repeat(200)
			const messages = [{ type: "say", text: longText }] as ClineMessage[]
			vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockRejectedValue(
				new Error("LLM error"),
			)

			const result = await sessionManager.generateTitle(messages)

			expect(result).toHaveLength(140)
			expect(result?.startsWith("AAA")).toBe(true)
			expect(result?.endsWith("...")).toBe(true)
		})

		it("should fallback to truncation if extension messenger is not initialized", async () => {
			const longText = "A".repeat(200)
			const messages = [{ type: "say", text: longText }] as ClineMessage[]
			sessionManager["extensionMessenger"] = undefined

			const result = await sessionManager.generateTitle(messages)

			expect(result).toHaveLength(140)
			expect(result?.endsWith("...")).toBe(true)
		})
	})
})

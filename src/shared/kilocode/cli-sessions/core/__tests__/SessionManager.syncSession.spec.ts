import path from "path"
import { SessionManager, SessionManagerDependencies } from "../SessionManager"
import { SessionClient } from "../SessionClient"
import { SessionPersistenceManager } from "../../utils/SessionPersistenceManager"
import { readFileSync } from "fs"

const mockGit = {
	getRemotes: vi.fn().mockResolvedValue([{ refs: { fetch: "https://github.com/test/repo.git" } }]),
	revparse: vi.fn().mockResolvedValue("abc123def456"),
	raw: vi.fn().mockResolvedValue(""),
	diff: vi.fn().mockResolvedValue("diff content"),
	stash: vi.fn().mockResolvedValue(undefined),
	stashList: vi.fn().mockResolvedValue({ total: 0 }),
	checkout: vi.fn().mockResolvedValue(undefined),
	applyPatch: vi.fn().mockResolvedValue(undefined),
}

vi.mock("fs", () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	mkdtempSync: vi.fn(),
	rmSync: vi.fn(),
}))

vi.mock("simple-git", () => ({
	default: vi.fn(() => mockGit),
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
		create: vi.fn().mockResolvedValue({
			session_id: "default-session-id",
			title: "",
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			git_url: null,
			cloud_agent_session_id: null,
			created_on_platform: "vscode",
			organization_id: null,
			last_mode: null,
			last_model: null,
			version: SessionManager.VERSION,
		}),
		update: vi.fn().mockResolvedValue({
			session_id: "default-session-id",
			title: "",
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			git_url: null,
			cloud_agent_session_id: null,
			created_on_platform: "vscode",
			organization_id: null,
			last_mode: null,
			last_model: null,
			version: SessionManager.VERSION,
		}),
		share: vi.fn(),
		fork: vi.fn(),
		uploadBlob: vi.fn().mockResolvedValue({ updated_at: new Date().toISOString() }),
		tokenValid: vi.fn().mockResolvedValue(true),
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
	getOrganizationId: vi.fn().mockReturnValue(undefined),
	getMode: vi.fn().mockReturnValue(undefined),
	getModel: vi.fn().mockReturnValue(undefined),
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
	onSessionSynced: vi.fn(),
})

describe("SessionManager.syncSession", () => {
	let manager: SessionManager
	let mockDependencies: SessionManagerDependencies
	let originalEnv: string | undefined

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()

		originalEnv = process.env.KILO_DISABLE_SESSIONS
		delete process.env.KILO_DISABLE_SESSIONS

		mockDependencies = createMockDependencies()

		const privateInstance = (SessionManager as unknown as { instance: SessionManager }).instance
		if (privateInstance) {
			;(privateInstance as unknown as { sessionClient: SessionClient | undefined }).sessionClient = undefined
			;(
				privateInstance as unknown as { sessionPersistenceManager: SessionPersistenceManager | undefined }
			).sessionPersistenceManager = undefined
			;(privateInstance as unknown as { queue: unknown[] }).queue = []
			;(privateInstance as unknown as { taskGitUrls: Record<string, string> }).taskGitUrls = {}
			;(privateInstance as unknown as { taskGitHashes: Record<string, string> }).taskGitHashes = {}
			;(privateInstance as unknown as { sessionTitles: Record<string, string> }).sessionTitles = {}
			;(privateInstance as unknown as { lastActiveSessionId: string | null }).lastActiveSessionId = null
			;(privateInstance as unknown as { pendingSync: Promise<void> | null }).pendingSync = null
			;(privateInstance as unknown as { tokenValid: Record<string, boolean | undefined> }).tokenValid = {}
		}

		manager = SessionManager.init(mockDependencies)

		// Ensure uploadBlob mock returns valid value by default after init
		if (manager.sessionClient) {
			vi.mocked(manager.sessionClient.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
		}

		mockGit.getRemotes.mockResolvedValue([{ refs: { fetch: "https://github.com/test/repo.git" } }])
		mockGit.revparse.mockResolvedValue("abc123def456")
		mockGit.raw.mockResolvedValue("")
		mockGit.diff.mockResolvedValue("diff content")
	})

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.KILO_DISABLE_SESSIONS = originalEnv
		} else {
			delete process.env.KILO_DISABLE_SESSIONS
		}
		vi.useRealTimers()
	})

	const triggerSync = async () => {
		const syncSession = (manager as unknown as { syncSession: () => Promise<void> }).syncSession.bind(manager)
		await syncSession()
	}

	const getQueue = () => (manager as unknown as { queue: unknown[] }).queue

	const getPendingSync = () => (manager as unknown as { pendingSync: Promise<void> | null }).pendingSync

	const setPendingSync = (value: Promise<void> | null) => {
		;(manager as unknown as { pendingSync: Promise<void> | null }).pendingSync = value
	}

	describe("sync skipping conditions", () => {
		it("should return early when queue is empty", async () => {
			await triggerSync()

			expect(manager.sessionClient!.create).not.toHaveBeenCalled()
			expect(manager.sessionClient!.uploadBlob).not.toHaveBeenCalled()
		})

		it("should clear queue and return when KILO_DISABLE_SESSIONS is set", async () => {
			process.env.KILO_DISABLE_SESSIONS = "true"

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")
			expect(getQueue()).toHaveLength(1)

			await triggerSync()

			expect(getQueue()).toHaveLength(0)
			expect(mockDependencies.logger.debug).toHaveBeenCalledWith(
				"Sessions disabled via KILO_DISABLE_SESSIONS, clearing queue",
				"SessionManager",
			)

			delete process.env.KILO_DISABLE_SESSIONS
		})

		it("should log error and return when manager not initialized", async () => {
			;(manager as unknown as { platform: undefined }).platform = undefined
			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.logger.error).toHaveBeenCalledWith(
				"SessionManager used before initialization",
				"SessionManager",
			)
		})
	})

	describe("token validation", () => {
		const getTokenValidCache = () =>
			(manager as unknown as { tokenValid: Record<string, boolean | undefined> }).tokenValid

		const clearTokenValidCache = () => {
			const cache = getTokenValidCache()
			for (const key of Object.keys(cache)) {
				delete cache[key]
			}
		}

		it("should log and return when no token is available", async () => {
			vi.mocked(mockDependencies.getToken!).mockResolvedValue("")
			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.logger.debug).toHaveBeenCalledWith(
				"No token available for session sync, skipping",
				"SessionManager",
			)
			expect(manager.sessionClient!.tokenValid).not.toHaveBeenCalled()
			expect(manager.sessionClient!.uploadBlob).not.toHaveBeenCalled()
		})

		it("should check token validity on first sync", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
			vi.mocked(manager.sessionClient!.tokenValid).mockResolvedValue(true)

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(manager.sessionClient!.tokenValid).toHaveBeenCalled()
			expect(mockDependencies.logger.debug).toHaveBeenCalledWith("Checking token validity", "SessionManager")
			expect(mockDependencies.logger.debug).toHaveBeenCalledWith("Token validity checked", "SessionManager", {
				tokenValid: true,
			})
		})

		it("should skip sync when token is invalid", async () => {
			clearTokenValidCache()
			vi.mocked(manager.sessionClient!.tokenValid).mockResolvedValue(false)
			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.logger.debug).toHaveBeenCalledWith(
				"Token is invalid, skipping sync",
				"SessionManager",
			)
			expect(manager.sessionClient!.uploadBlob).not.toHaveBeenCalled()
		})

		it("should cache token validity and not re-check on subsequent syncs", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
			vi.mocked(manager.sessionClient!.tokenValid).mockResolvedValue(true)

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")
			await triggerSync()

			vi.mocked(manager.sessionClient!.tokenValid).mockClear()

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
			await triggerSync()

			expect(manager.sessionClient!.tokenValid).not.toHaveBeenCalled()
		})

		it("should re-check token validity when token changes", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
			vi.mocked(manager.sessionClient!.tokenValid).mockResolvedValue(true)

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")
			await triggerSync()

			vi.mocked(manager.sessionClient!.tokenValid).mockClear()
			vi.mocked(mockDependencies.getToken!).mockResolvedValue("new-token")

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
			await triggerSync()

			expect(manager.sessionClient!.tokenValid).toHaveBeenCalled()
		})

		it("should reset token validity cache on sync error", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
			vi.mocked(manager.sessionClient!.tokenValid).mockResolvedValue(true)

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")
			await triggerSync()

			vi.mocked(manager.sessionClient!.tokenValid).mockClear()

			vi.mocked(readFileSync).mockImplementation(() => {
				throw new Error("Read error")
			})

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
			await triggerSync()

			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file3.json")
			await triggerSync()

			expect(manager.sessionClient!.tokenValid).toHaveBeenCalled()
		})

		it("should not process queue items when token is invalid", async () => {
			clearTokenValidCache()
			vi.mocked(manager.sessionClient!.tokenValid).mockResolvedValue(false)

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")
			expect(getQueue()).toHaveLength(1)

			await triggerSync()

			expect(getQueue()).toHaveLength(1)
			expect(manager.sessionClient!.create).not.toHaveBeenCalled()
		})

		it("should handle token validity check failure gracefully", async () => {
			clearTokenValidCache()
			vi.mocked(manager.sessionClient!.tokenValid).mockRejectedValue(new Error("Network error"))

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.logger.error).toHaveBeenCalledWith(
				"Failed to check token validity",
				"SessionManager",
				{ error: "Network error" },
			)
			expect(manager.sessionClient!.uploadBlob).not.toHaveBeenCalled()
		})
	})

	describe("session creation", () => {
		it("should create new session when task has no existing session", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
			vi.mocked(manager.sessionClient!.create).mockResolvedValue({
				session_id: "new-session-123",
				title: "",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				git_url: null,
				cloud_agent_session_id: null,
				created_on_platform: "vscode",
				organization_id: null,
				last_mode: null,
				last_model: null,
				version: SessionManager.VERSION,
			})
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(manager.sessionClient!.create).toHaveBeenCalledWith({
				created_on_platform: "vscode",
				git_url: "https://github.com/test/repo.git",
				version: SessionManager.VERSION,
			})
			expect(manager.sessionPersistenceManager!.setSessionForTask).toHaveBeenCalledWith(
				"task-123",
				"new-session-123",
			)
		})

		it("should call onSessionCreated callback when new session is created", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
			vi.mocked(manager.sessionClient!.create).mockResolvedValue({
				session_id: "new-session-123",
				title: "",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				git_url: null,
				cloud_agent_session_id: null,
				created_on_platform: "vscode",
				organization_id: null,
				last_mode: null,
				last_model: null,
				version: SessionManager.VERSION,
			})
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.onSessionCreated).toHaveBeenCalledWith({
				timestamp: expect.any(Number),
				event: "session_created",
				sessionId: "new-session-123",
			})
		})

		it("should use existing session when task already has one", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("existing-session-456")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(manager.sessionClient!.create).not.toHaveBeenCalled()
			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"existing-session-456",
				"ui_messages",
				expect.any(Array),
			)
		})
	})

	describe("blob uploads", () => {
		beforeEach(() => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
		})

		it("should upload ui_messages blob", async () => {
			const uiMessages = [{ type: "say", say: "text", text: "Hello" }]
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(uiMessages))

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/ui_messages.json")

			await triggerSync()

			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith("session-123", "ui_messages", uiMessages)
		})

		it("should upload api_conversation_history blob", async () => {
			const apiHistory = [{ role: "user", content: "test" }]
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(apiHistory))

			manager.handleFileUpdate("task-123", "apiConversationHistoryPath", "/path/to/api_history.json")

			await triggerSync()

			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"session-123",
				"api_conversation_history",
				apiHistory,
			)
		})

		it("should upload task_metadata blob", async () => {
			const metadata = { tokensIn: 100, tokensOut: 200 }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(metadata))

			manager.handleFileUpdate("task-123", "taskMetadataPath", "/path/to/metadata.json")

			await triggerSync()

			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith("session-123", "task_metadata", metadata)
		})

		it("should upload only the latest blob when multiple updates for same blob type", async () => {
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([{ text: "latest" }]))

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")
			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file3.json")

			await triggerSync()

			const uiMessagesUploadCalls = vi
				.mocked(manager.sessionClient!.uploadBlob)
				.mock.calls.filter((call) => call[1] === "ui_messages")
			expect(uiMessagesUploadCalls).toHaveLength(1)
			expect(readFileSync).toHaveBeenCalledWith("/path/to/file3.json", "utf-8")
		})

		it("should upload multiple different blob types in single sync", async () => {
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/ui.json")
			manager.handleFileUpdate("task-123", "apiConversationHistoryPath", "/path/to/api.json")
			manager.handleFileUpdate("task-123", "taskMetadataPath", "/path/to/meta.json")

			await triggerSync()

			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"session-123",
				"ui_messages",
				expect.any(Array),
			)
			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"session-123",
				"api_conversation_history",
				expect.any(Array),
			)
			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith("session-123", "task_metadata", [])
		})

		it("should remove uploaded items from queue after successful upload", async () => {
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")
			expect(getQueue()).toHaveLength(1)

			await triggerSync()

			expect(getQueue()).toHaveLength(0)
		})

		it("should handle blob upload failure gracefully", async () => {
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockRejectedValue(new Error("Upload failed"))

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.logger.error).toHaveBeenCalledWith("Failed to upload blob", "SessionManager", {
				sessionId: "session-123",
				blobName: "ui_messages",
				error: "Upload failed",
			})
		})
	})

	describe("git state handling", () => {
		beforeEach(() => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
		})

		it("should upload git state when it changes", async () => {
			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith("session-123", "git_state", {
				head: "abc123def456",
				patch: "diff content",
				branch: "",
			})
		})

		it("should not upload git state when unchanged", async () => {
			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")
			await triggerSync()

			vi.mocked(manager.sessionClient!.uploadBlob).mockClear()

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
			await triggerSync()

			const gitStateUploadCalls = vi
				.mocked(manager.sessionClient!.uploadBlob)
				.mock.calls.filter((call) => call[1] === "git_state")
			expect(gitStateUploadCalls).toHaveLength(0)
		})

		it("should handle git state fetch failure gracefully", async () => {
			mockGit.getRemotes.mockRejectedValueOnce(new Error("Git error"))

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.logger.debug).toHaveBeenCalledWith(
				"Could not get git state",
				"SessionManager",
				expect.any(Object),
			)
		})
	})

	describe("git URL updates", () => {
		it("should update session when git URL changes", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
			vi.mocked(manager.sessionClient!.update).mockResolvedValue({
				session_id: "session-123",
				title: "",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				git_url: null,
				cloud_agent_session_id: null,
				created_on_platform: "vscode",
				organization_id: null,
				last_mode: null,
				last_model: null,
				version: SessionManager.VERSION,
			})

			const taskGitUrls = (manager as unknown as { taskGitUrls: Record<string, string> }).taskGitUrls
			taskGitUrls["task-123"] = "https://github.com/old/repo.git"

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(manager.sessionClient!.update).toHaveBeenCalledWith({
				session_id: "session-123",
				git_url: "https://github.com/test/repo.git",
			})
		})
	})

	describe("title generation", () => {
		beforeEach(() => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
		})

		it("should check for title generation when uploading ui_messages blob", async () => {
			const uiMessages = [{ type: "say", say: "text", text: "Create a login form" }]
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(uiMessages))
			vi.mocked(manager.sessionClient!.get).mockResolvedValue({
				session_id: "session-123",
				title: "",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				git_url: null,
				cloud_agent_session_id: null,
				created_on_platform: "vscode",
				organization_id: null,
				last_mode: null,
				last_model: null,
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
				version: SessionManager.VERSION,
			})
			vi.mocked(manager.sessionClient!.update).mockResolvedValue({
				session_id: "session-123",
				title: "Login form creation",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				git_url: null,
				cloud_agent_session_id: null,
				created_on_platform: "vscode",
				organization_id: null,
				last_mode: null,
				last_model: null,
				version: SessionManager.VERSION,
			})

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			vi.useRealTimers()
			await triggerSync()

			await new Promise((resolve) => setTimeout(resolve, 100))

			expect(manager.sessionClient!.get).toHaveBeenCalledWith({ session_id: "session-123" })
		})

		it("should use existing title when session already has one", async () => {
			const uiMessages = [{ type: "say", say: "text", text: "Create a login form" }]
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(uiMessages))
			vi.mocked(manager.sessionClient!.get).mockResolvedValue({
				session_id: "session-123",
				title: "Existing title",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				git_url: null,
				cloud_agent_session_id: null,
				created_on_platform: "vscode",
				organization_id: null,
				last_mode: null,
				last_model: null,
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
				version: SessionManager.VERSION,
			})

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			vi.useRealTimers()
			await triggerSync()

			await new Promise((resolve) => setTimeout(resolve, 100))

			expect(mockDependencies.extensionMessenger.requestSingleCompletion).not.toHaveBeenCalled()
		})
	})

	describe("multiple tasks handling", () => {
		it("should process multiple tasks in single sync", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask)
				.mockReturnValueOnce("session-1")
				.mockReturnValueOnce("session-2")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

			manager.handleFileUpdate("task-1", "uiMessagesPath", "/path/to/file1.json")
			manager.handleFileUpdate("task-2", "uiMessagesPath", "/path/to/file2.json")

			await triggerSync()

			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"session-1",
				"ui_messages",
				expect.any(Array),
			)
			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"session-2",
				"ui_messages",
				expect.any(Array),
			)
		})

		it("should update lastActiveSessionId to the last task's session", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask)
				.mockReturnValueOnce("session-1")
				.mockReturnValueOnce("session-2")
				.mockReturnValueOnce("session-2")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

			manager.handleFileUpdate("task-1", "uiMessagesPath", "/path/to/file1.json")
			manager.handleFileUpdate("task-2", "uiMessagesPath", "/path/to/file2.json")

			await triggerSync()

			expect(manager.sessionPersistenceManager!.setLastSession).toHaveBeenCalledWith("session-2")
		})
	})

	describe("error handling", () => {
		it("should continue processing other tasks when one fails", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask)
				.mockReturnValueOnce("session-1")
				.mockReturnValueOnce("session-2")

			vi.mocked(readFileSync)
				.mockImplementationOnce(() => {
					throw new Error("Read error for task 1")
				})
				.mockReturnValueOnce(JSON.stringify([]))

			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

			manager.handleFileUpdate("task-1", "uiMessagesPath", "/path/to/file1.json")
			manager.handleFileUpdate("task-2", "uiMessagesPath", "/path/to/file2.json")

			await triggerSync()

			expect(mockDependencies.logger.error).toHaveBeenCalledWith(
				"Failed to sync session",
				"SessionManager",
				expect.objectContaining({ taskId: "task-1" }),
			)
			expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith(
				"session-2",
				"ui_messages",
				expect.any(Array),
			)
		})

		it("should warn when no session ID available after create/get", async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
			vi.mocked(manager.sessionClient!.create).mockResolvedValue({
				session_id: "",
				title: "",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				git_url: null,
				cloud_agent_session_id: null,
				created_on_platform: "vscode",
				organization_id: null,
				last_mode: null,
				last_model: null,
				version: SessionManager.VERSION,
			})

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.logger.warn).toHaveBeenCalledWith(
				"No session ID available after create/get, skipping task",
				"SessionManager",
				{ taskId: "task-123" },
			)
		})
	})

	describe("race conditions", () => {
		describe("title generation race conditions", () => {
			beforeEach(() => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })
			})

			it("should not trigger multiple title generations for the same session", async () => {
				const uiMessages = [{ type: "say", say: "text", text: "Create a login form" }]
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify(uiMessages))

				let getCallCount = 0
				vi.mocked(manager.sessionClient!.get).mockImplementation(async () => {
					getCallCount++
					await new Promise((resolve) => setTimeout(resolve, 50))
					return {
						session_id: "session-123",
						title: "",
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						git_url: null,
						cloud_agent_session_id: null,
						created_on_platform: "vscode",
						organization_id: null,
						last_mode: null,
						last_model: null,
						api_conversation_history_blob_url: null,
						task_metadata_blob_url: null,
						ui_messages_blob_url: null,
						git_state_blob_url: null,
						version: SessionManager.VERSION,
					}
				})
				vi.mocked(manager.sessionClient!.update).mockResolvedValue({
					session_id: "session-123",
					title: "Generated title",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					git_url: null,
					cloud_agent_session_id: null,
					created_on_platform: "vscode",
					organization_id: null,
					last_mode: null,
					last_model: null,
					version: SessionManager.VERSION,
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")

				vi.useRealTimers()
				await triggerSync()

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
				await triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 200))

				expect(getCallCount).toBe(1)
			})

			it("should handle title generation failure without affecting subsequent syncs", async () => {
				const uiMessages = [{ type: "say", say: "text", text: "Create a login form" }]
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify(uiMessages))
				vi.mocked(manager.sessionClient!.get).mockRejectedValueOnce(new Error("Network error"))
				vi.mocked(manager.sessionClient!.update).mockResolvedValue({
					session_id: "session-123",
					title: "Create a login form",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					git_url: null,
					cloud_agent_session_id: null,
					created_on_platform: "vscode",
					organization_id: null,
					last_mode: null,
					last_model: null,
					version: SessionManager.VERSION,
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

				vi.useRealTimers()
				await triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 100))

				expect(mockDependencies.logger.error).toHaveBeenCalledWith(
					"Failed to generate session title",
					"SessionManager",
					expect.objectContaining({
						sessionId: "session-123",
						error: "Network error",
					}),
				)

				expect(manager.sessionClient!.update).toHaveBeenCalledWith({
					session_id: "session-123",
					title: "Create a login form",
				})

				const sessionTitles = (manager as unknown as { sessionTitles: Record<string, string> }).sessionTitles
				expect(sessionTitles["session-123"]).toBe("Create a login form")

				vi.mocked(manager.sessionClient!.get).mockResolvedValue({
					session_id: "session-123",
					title: "",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					git_url: null,
					cloud_agent_session_id: null,
					created_on_platform: "vscode",
					organization_id: null,
					last_mode: null,
					last_model: null,
					api_conversation_history_blob_url: null,
					task_metadata_blob_url: null,
					ui_messages_blob_url: null,
					git_state_blob_url: null,
					version: SessionManager.VERSION,
				})
				vi.mocked(manager.sessionClient!.update).mockResolvedValue({
					session_id: "session-123",
					title: "Generated title",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					git_url: null,
					cloud_agent_session_id: null,
					created_on_platform: "vscode",
					organization_id: null,
					last_mode: null,
					last_model: null,
					version: SessionManager.VERSION,
				})

				sessionTitles["session-123"] = ""

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
				await triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 100))

				expect(manager.sessionClient!.get).toHaveBeenCalledTimes(2)
			})

			it("should handle renameSession failure when falling back to local title", async () => {
				const uiMessages = [{ type: "say", say: "text", text: "Create a login form" }]
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify(uiMessages))
				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

				vi.mocked(manager.sessionClient!.get).mockResolvedValueOnce({
					session_id: "session-123",
					title: "",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					git_url: null,
					cloud_agent_session_id: null,
					created_on_platform: "vscode",
					organization_id: null,
					last_mode: null,
					last_model: null,
					api_conversation_history_blob_url: null,
					task_metadata_blob_url: null,
					ui_messages_blob_url: null,
					git_state_blob_url: null,
					version: SessionManager.VERSION,
				})

				vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockRejectedValueOnce(
					new Error("LLM generation failed"),
				)

				let updateCallCount = 0
				vi.mocked(manager.sessionClient!.update).mockImplementation(async (params) => {
					updateCallCount++
					if (params && "title" in params) {
						throw new Error("Update failed")
					}
					return {
						session_id: params?.session_id || "session-123",
						title: "",
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						git_url: null,
						cloud_agent_session_id: null,
						created_on_platform: "vscode",
						organization_id: null,
						last_mode: null,
						last_model: null,
						version: SessionManager.VERSION,
					}
				})

				const taskGitUrls = (manager as unknown as { taskGitUrls: Record<string, string> }).taskGitUrls
				taskGitUrls["task-123"] = "https://github.com/test/repo.git"

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

				vi.useRealTimers()
				await triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 100))

				expect(mockDependencies.logger.error).toHaveBeenCalledWith(
					"Failed to generate session title",
					"SessionManager",
					expect.objectContaining({
						sessionId: "session-123",
					}),
				)

				expect(mockDependencies.logger.error).toHaveBeenCalledWith(
					"Failed to update session title using local title",
					"SessionManager",
					expect.objectContaining({
						sessionId: "session-123",
						error: "Update failed",
					}),
				)
			})

			it("should not call renameSession when local title is empty", async () => {
				const uiMessages = [{ type: "say", say: "text" }]
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify(uiMessages))
				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

				vi.mocked(manager.sessionClient!.get).mockResolvedValueOnce({
					session_id: "session-123",
					title: "",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					git_url: null,
					cloud_agent_session_id: null,
					created_on_platform: "vscode",
					organization_id: null,
					last_mode: null,
					last_model: null,
					api_conversation_history_blob_url: null,
					task_metadata_blob_url: null,
					ui_messages_blob_url: null,
					git_state_blob_url: null,
					version: SessionManager.VERSION,
				})

				vi.mocked(mockDependencies.extensionMessenger.requestSingleCompletion).mockRejectedValueOnce(
					new Error("LLM generation failed"),
				)

				const updateMock = vi.mocked(manager.sessionClient!.update)
				updateMock.mockClear()

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

				vi.useRealTimers()
				await triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 100))

				expect(mockDependencies.logger.error).toHaveBeenCalledWith(
					"Failed to generate session title",
					"SessionManager",
					expect.objectContaining({
						sessionId: "session-123",
					}),
				)

				const updateCallsWithTitle = updateMock.mock.calls.filter((call) => call[0] && "title" in call[0])
				expect(updateCallsWithTitle).toHaveLength(0)
			})

			it("should set pending title marker to prevent concurrent title generation", async () => {
				const uiMessages = [{ type: "say", say: "text", text: "Create a login form" }]
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify(uiMessages))

				let titleDuringGet: string | undefined
				vi.mocked(manager.sessionClient!.get).mockImplementation(async () => {
					const sessionTitles = (manager as unknown as { sessionTitles: Record<string, string> })
						.sessionTitles
					titleDuringGet = sessionTitles["session-123"]
					return {
						session_id: "session-123",
						title: "",
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						git_url: null,
						cloud_agent_session_id: null,
						created_on_platform: "vscode",
						organization_id: null,
						last_mode: null,
						last_model: null,
						api_conversation_history_blob_url: null,
						task_metadata_blob_url: null,
						ui_messages_blob_url: null,
						git_state_blob_url: null,
						version: SessionManager.VERSION,
					}
				})
				vi.mocked(manager.sessionClient!.update).mockResolvedValue({
					session_id: "session-123",
					title: "Generated title",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					git_url: null,
					cloud_agent_session_id: null,
					created_on_platform: "vscode",
					organization_id: null,
					last_mode: null,
					last_model: null,
					version: SessionManager.VERSION,
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

				vi.useRealTimers()
				await triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 100))

				expect(titleDuringGet).toBe("Pending title")
			})
		})

		describe("concurrent sync attempts", () => {
			it("should prevent concurrent syncs via pendingSync", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

				let uploadStarted = false
				let uploadCompleted = false
				vi.mocked(manager.sessionClient!.uploadBlob).mockImplementation(async () => {
					uploadStarted = true
					await new Promise((resolve) => setTimeout(resolve, 100))
					uploadCompleted = true
					return { updated_at: new Date().toISOString() }
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

				vi.useRealTimers()
				const sync1 = triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 10))
				expect(uploadStarted).toBe(true)
				expect(uploadCompleted).toBe(false)

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
				const sync2 = triggerSync()

				await Promise.all([sync1, sync2])

				// In the event-based approach, the second sync should return the existing pending sync
				expect(sync2).toBeInstanceOf(Promise)
			})

			it("should process queued items after blocked sync completes", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
				vi.mocked(manager.sessionClient!.uploadBlob).mockImplementation(async () => {
					await new Promise((resolve) => setTimeout(resolve, 50))
					return { updated_at: new Date().toISOString() }
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")

				vi.useRealTimers()
				const sync1 = triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 10))

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
				await triggerSync()

				await sync1

				// In the event-based approach, the queue should be empty after sync completes
				expect(getQueue()).toHaveLength(0)

				await triggerSync()

				expect(getQueue()).toHaveLength(0)
			})
		})

		describe("queue modification during sync", () => {
			it("should handle items added to queue during sync", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

				let syncInProgress = false
				vi.mocked(manager.sessionClient!.uploadBlob).mockImplementation(async () => {
					syncInProgress = true
					await new Promise((resolve) => setTimeout(resolve, 50))
					syncInProgress = false
					return { updated_at: new Date().toISOString() }
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")

				vi.useRealTimers()
				const syncPromise = triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 10))
				expect(syncInProgress).toBe(true)

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")

				await syncPromise

				expect(getQueue()).toHaveLength(1)
			})

			it("should only remove items with timestamp <= uploaded item timestamp", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

				const uploadTimestamps: number[] = []
				vi.mocked(manager.sessionClient!.uploadBlob).mockImplementation(async () => {
					uploadTimestamps.push(Date.now())
					await new Promise((resolve) => setTimeout(resolve, 30))
					return { updated_at: new Date().toISOString() }
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")

				vi.useRealTimers()
				const syncPromise = triggerSync()

				await new Promise((resolve) => setTimeout(resolve, 10))

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")

				await syncPromise

				const queue = getQueue() as { timestamp: number }[]
				expect(queue.length).toBe(1)
				expect(queue[0].timestamp).toBeGreaterThan(uploadTimestamps[0])
			})
		})

		describe("session creation race conditions", () => {
			it("should handle rapid session creation requests for same task", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

				let createCallCount = 0
				vi.mocked(manager.sessionClient!.create).mockImplementation(async () => {
					createCallCount++
					await new Promise((resolve) => setTimeout(resolve, 50))
					return {
						session_id: `session-${createCallCount}`,
						title: "",
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						git_url: null,
						cloud_agent_session_id: null,
						created_on_platform: "vscode",
						organization_id: null,
						last_mode: null,
						last_model: null,
						version: SessionManager.VERSION,
					}
				})
				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")

				vi.useRealTimers()
				await triggerSync()

				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-1")

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
				await triggerSync()

				expect(createCallCount).toBe(1)
			})

			it("should handle multiple tasks creating sessions simultaneously", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue(undefined)
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

				const createdSessions: string[] = []
				vi.mocked(manager.sessionClient!.create).mockImplementation(async () => {
					const sessionId = `session-${createdSessions.length + 1}`
					createdSessions.push(sessionId)
					await new Promise((resolve) => setTimeout(resolve, 20))
					return {
						session_id: sessionId,
						title: "",
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						git_url: null,
						cloud_agent_session_id: null,
						created_on_platform: "vscode",
						organization_id: null,
						last_mode: null,
						last_model: null,
						version: SessionManager.VERSION,
					}
				})
				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

				manager.handleFileUpdate("task-1", "uiMessagesPath", "/path/to/file1.json")
				manager.handleFileUpdate("task-2", "uiMessagesPath", "/path/to/file2.json")

				vi.useRealTimers()
				await triggerSync()

				expect(createdSessions).toHaveLength(2)
				expect(manager.sessionPersistenceManager!.setSessionForTask).toHaveBeenCalledWith("task-1", "session-1")
				expect(manager.sessionPersistenceManager!.setSessionForTask).toHaveBeenCalledWith("task-2", "session-2")
			})
		})

		describe("git state race conditions", () => {
			it("should handle git state changes during sync", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

				let gitCallCount = 0
				mockGit.revparse.mockImplementation(async () => {
					gitCallCount++
					return `commit-${gitCallCount}`
				})
				mockGit.diff.mockImplementation(async () => {
					return `diff-${gitCallCount}`
				})

				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

				vi.useRealTimers()
				await triggerSync()

				expect(manager.sessionClient!.uploadBlob).toHaveBeenCalledWith("session-123", "git_state", {
					head: "commit-1",
					patch: "diff-1",
					branch: "",
				})
			})

			it("should use consistent git state hash for deduplication", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

				mockGit.revparse.mockResolvedValue("same-commit")
				mockGit.diff.mockResolvedValue("same-diff")

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file1.json")
				await triggerSync()

				const gitStateUploads1 = vi
					.mocked(manager.sessionClient!.uploadBlob)
					.mock.calls.filter((call) => call[1] === "git_state")
				expect(gitStateUploads1).toHaveLength(1)

				vi.mocked(manager.sessionClient!.uploadBlob).mockClear()

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file2.json")
				await triggerSync()

				const gitStateUploads2 = vi
					.mocked(manager.sessionClient!.uploadBlob)
					.mock.calls.filter((call) => call[1] === "git_state")
				expect(gitStateUploads2).toHaveLength(0)
			})
		})

		describe("sessionUpdatedAt high-water mark", () => {
			beforeEach(() => {
				// Reset mocks that were set by global beforeEach
				vi.mocked(manager.sessionClient!.uploadBlob).mockReset()

				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
				// Clear sessionUpdatedAt from previous tests
				const sessionUpdatedAt = (manager as unknown as { sessionUpdatedAt: Record<string, string> })
					.sessionUpdatedAt
				delete sessionUpdatedAt["session-123"]
				// Disable git state uploads by pre-setting the hash to match
				const taskGitHashes = (manager as unknown as { taskGitHashes: Record<string, string> }).taskGitHashes
				taskGitHashes["task-123"] = "fixed-hash-to-skip-git-upload"
				// Pre-set git URL to prevent update calls that would set timestamps
				const taskGitUrls = (manager as unknown as { taskGitUrls: Record<string, string> }).taskGitUrls
				taskGitUrls["task-123"] = "https://github.com/test/repo.git"
				// Pre-set session title to prevent title generation (which would call update and set timestamp)
				const sessionTitles = (manager as unknown as { sessionTitles: Record<string, string> }).sessionTitles
				sessionTitles["session-123"] = "Existing title"
			})

			it("should track the highest timestamp when multiple uploads complete", async () => {
				// Return timestamps based on blob type to simulate concurrent uploads
				vi.mocked(manager.sessionClient!.uploadBlob).mockImplementation(async (_sessionId, blobType) => {
					switch (blobType) {
						case "ui_messages":
							return { updated_at: "2024-01-01T10:00:00.000Z" }
						case "api_conversation_history":
							return { updated_at: "2024-01-01T12:00:00.000Z" } // This is the highest
						case "task_metadata":
							return { updated_at: "2024-01-01T11:00:00.000Z" }
						default:
							return { updated_at: "2024-01-01T08:00:00.000Z" }
					}
				})

				// Queue multiple blob types to trigger multiple uploads
				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/ui.json")
				manager.handleFileUpdate("task-123", "apiConversationHistoryPath", "/path/to/api.json")
				manager.handleFileUpdate("task-123", "taskMetadataPath", "/path/to/meta.json")

				await triggerSync()

				const sessionUpdatedAt = (manager as unknown as { sessionUpdatedAt: Record<string, string> })
					.sessionUpdatedAt
				expect(sessionUpdatedAt["session-123"]).toBe("2024-01-01T12:00:00.000Z")
			})

			it("should not overwrite with older timestamp when newer already exists", async () => {
				// Pre-set a newer timestamp
				const sessionUpdatedAt = (manager as unknown as { sessionUpdatedAt: Record<string, string> })
					.sessionUpdatedAt
				sessionUpdatedAt["session-123"] = "2024-01-01T15:00:00.000Z"

				// Upload returns an older timestamp
				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({
					updated_at: "2024-01-01T10:00:00.000Z",
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/ui.json")

				await triggerSync()

				// Should still have the newer timestamp
				expect(sessionUpdatedAt["session-123"]).toBe("2024-01-01T15:00:00.000Z")
			})

			it("should update timestamp when newer value arrives", async () => {
				// Pre-set an older timestamp
				const sessionUpdatedAt = (manager as unknown as { sessionUpdatedAt: Record<string, string> })
					.sessionUpdatedAt
				sessionUpdatedAt["session-123"] = "2024-01-01T10:00:00.000Z"

				// Upload returns a newer timestamp
				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({
					updated_at: "2024-01-01T15:00:00.000Z",
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/ui.json")

				await triggerSync()

				// Should have the newer timestamp
				expect(sessionUpdatedAt["session-123"]).toBe("2024-01-01T15:00:00.000Z")
			})

			it("should handle concurrent uploads with race conditions correctly", async () => {
				const sessionUpdatedAt = (manager as unknown as { sessionUpdatedAt: Record<string, string> })
					.sessionUpdatedAt

				// Simulate concurrent uploads completing in different order with explicit timestamps
				vi.mocked(manager.sessionClient!.uploadBlob).mockImplementation(async (_sessionId, blobType) => {
					// Return different timestamps based on blob type to simulate race conditions
					switch (blobType) {
						case "ui_messages":
							return { updated_at: "2024-01-01T10:00:00.000Z" } // oldest
						case "api_conversation_history":
							return { updated_at: "2024-01-01T15:00:00.000Z" } // newest
						case "task_metadata":
							return { updated_at: "2024-01-01T12:00:00.000Z" } // middle
						default:
							return { updated_at: "2024-01-01T08:00:00.000Z" }
					}
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/ui.json")
				manager.handleFileUpdate("task-123", "apiConversationHistoryPath", "/path/to/api.json")
				manager.handleFileUpdate("task-123", "taskMetadataPath", "/path/to/meta.json")

				await triggerSync()

				// High-water mark should keep the highest timestamp
				expect(sessionUpdatedAt["session-123"]).toBe("2024-01-01T15:00:00.000Z")
			})

			it("should track high-water mark for git state uploads", async () => {
				// Clear git hash to allow git state upload for this test
				const taskGitHashes = (manager as unknown as { taskGitHashes: Record<string, string> }).taskGitHashes
				delete taskGitHashes["task-123"]

				const sessionUpdatedAt = (manager as unknown as { sessionUpdatedAt: Record<string, string> })
					.sessionUpdatedAt

				// Set initial timestamp from blob upload
				vi.mocked(manager.sessionClient!.uploadBlob).mockImplementation(async (_sessionId, blobType) => {
					if (blobType === "git_state") {
						// Git state upload returns newer timestamp
						return { updated_at: "2024-01-01T18:00:00.000Z" }
					}
					// Other uploads return older timestamp
					return { updated_at: "2024-01-01T10:00:00.000Z" }
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/ui.json")

				await triggerSync()

				// Git state upload should update to the highest timestamp
				expect(sessionUpdatedAt["session-123"]).toBe("2024-01-01T18:00:00.000Z")
			})
		})

		describe("pendingSync tracking", () => {
			it("should clear pendingSync after sync completes via direct call", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
				vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

				setPendingSync(null)
				expect(getPendingSync()).toBeNull()

				await triggerSync()

				expect(getPendingSync()).toBeNull()
			})

			it("should set pendingSync during sync execution via doSync", async () => {
				vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))

				let pendingSyncDuringUpload: Promise<void> | null = null
				vi.mocked(manager.sessionClient!.uploadBlob).mockImplementation(async () => {
					pendingSyncDuringUpload = getPendingSync()
					return { updated_at: new Date().toISOString() }
				})

				manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

				await manager.doSync()

				expect(pendingSyncDuringUpload).toBeInstanceOf(Promise)
			})
		})
	})

	describe("doSync", () => {
		it("should not create new sync when pendingSync exists and not forced", async () => {
			let resolveExisting: () => void
			const existingPromise = new Promise<void>((resolve) => {
				resolveExisting = resolve
			})
			;(manager as unknown as { pendingSync: Promise<void> | null }).pendingSync = existingPromise

			manager.doSync()

			expect(mockDependencies.logger.debug).toHaveBeenCalledWith("Found pending sync", "SessionManager")
			expect(mockDependencies.logger.debug).toHaveBeenCalledWith(
				"Not forced, returning pending sync",
				"SessionManager",
			)
			expect(mockDependencies.logger.debug).not.toHaveBeenCalledWith("Creating new sync", "SessionManager")

			resolveExisting!()
			await existingPromise
		})

		it("should create new sync when forced despite pending sync", async () => {
			let resolveExisting: () => void
			const existingPromise = new Promise<void>((resolve) => {
				resolveExisting = resolve
			})
			;(manager as unknown as { pendingSync: Promise<void> | null }).pendingSync = existingPromise

			manager.doSync(true)

			expect(mockDependencies.logger.debug).toHaveBeenCalledWith("Found pending sync", "SessionManager")
			expect(mockDependencies.logger.debug).toHaveBeenCalledWith(
				"Forced, syncing despite pending sync",
				"SessionManager",
			)
			expect(mockDependencies.logger.debug).toHaveBeenCalledWith("Creating new sync", "SessionManager")

			resolveExisting!()
			await existingPromise
		})

		it("should create new sync when no pending sync exists", async () => {
			;(manager as unknown as { pendingSync: Promise<void> | null }).pendingSync = null

			const result = manager.doSync()

			expect(mockDependencies.logger.debug).toHaveBeenCalledWith("Creating new sync", "SessionManager")
			expect(result).toBeInstanceOf(Promise)

			await result
		})

		it("should set pendingSync when creating new sync", async () => {
			;(manager as unknown as { pendingSync: Promise<void> | null }).pendingSync = null

			manager.doSync()

			const pendingSync = (manager as unknown as { pendingSync: Promise<void> | null }).pendingSync
			expect(pendingSync).not.toBeNull()
			expect(pendingSync).toBeInstanceOf(Promise)

			await pendingSync
		})

		it("should log debug messages during sync", async () => {
			;(manager as unknown as { pendingSync: Promise<void> | null }).pendingSync = null

			await manager.doSync()

			expect(mockDependencies.logger.debug).toHaveBeenCalledWith("Doing sync", "SessionManager")
			expect(mockDependencies.logger.debug).toHaveBeenCalledWith("Creating new sync", "SessionManager")
		})
	})

	describe("onSessionSynced callback", () => {
		beforeEach(() => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({
				updated_at: "2024-01-15T10:30:00.000Z",
			})
			const taskGitUrls = (manager as unknown as { taskGitUrls: Record<string, string> }).taskGitUrls
			taskGitUrls["task-123"] = "https://github.com/test/repo.git"
			const taskGitHashes = (manager as unknown as { taskGitHashes: Record<string, string> }).taskGitHashes
			taskGitHashes["task-123"] = "fixed-hash-to-skip-git-upload"
			const sessionTitles = (manager as unknown as { sessionTitles: Record<string, string> }).sessionTitles
			sessionTitles["session-123"] = "Existing title"
			const sessionUpdatedAt = (manager as unknown as { sessionUpdatedAt: Record<string, string> })
				.sessionUpdatedAt
			delete sessionUpdatedAt["session-123"]
		})

		it("should emit onSessionSynced callback after successful sync", async () => {
			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.onSessionSynced).toHaveBeenCalledWith({
				sessionId: "session-123",
				updatedAt: new Date("2024-01-15T10:30:00.000Z").getTime(),
				timestamp: expect.any(Number),
				event: "session_synced",
			})
		})

		it("should emit onSessionSynced with the highest timestamp from multiple uploads", async () => {
			vi.mocked(manager.sessionClient!.uploadBlob).mockImplementation(async (_sessionId, blobType) => {
				switch (blobType) {
					case "ui_messages":
						return { updated_at: "2024-01-15T10:00:00.000Z" }
					case "api_conversation_history":
						return { updated_at: "2024-01-15T12:00:00.000Z" }
					default:
						return { updated_at: "2024-01-15T08:00:00.000Z" }
				}
			})

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/ui.json")
			manager.handleFileUpdate("task-123", "apiConversationHistoryPath", "/path/to/api.json")

			await triggerSync()

			expect(mockDependencies.onSessionSynced).toHaveBeenCalledWith({
				sessionId: "session-123",
				updatedAt: new Date("2024-01-15T12:00:00.000Z").getTime(),
				timestamp: expect.any(Number),
				event: "session_synced",
			})
		})

		it("should not emit onSessionSynced when no timestamp is available", async () => {
			const sessionUpdatedAt = (manager as unknown as { sessionUpdatedAt: Record<string, string> })
				.sessionUpdatedAt
			delete sessionUpdatedAt["session-123"]

			vi.mocked(manager.sessionClient!.uploadBlob).mockRejectedValue(new Error("Upload failed"))

			manager.handleFileUpdate("task-123", "uiMessagesPath", "/path/to/file.json")

			await triggerSync()

			expect(mockDependencies.onSessionSynced).not.toHaveBeenCalled()
		})
	})

	describe("automatic sync trigger", () => {
		it(`should trigger sync when queue exceeds ${SessionManager.QUEUE_FLUSH_THRESHOLD} items`, async () => {
			vi.mocked(manager.sessionPersistenceManager!.getSessionForTask).mockReturnValue("session-123")
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify([]))
			vi.mocked(manager.sessionClient!.uploadBlob).mockResolvedValue({ updated_at: new Date().toISOString() })

			const doSyncSpy = vi.spyOn(manager, "doSync")

			for (let i = 0; i < SessionManager.QUEUE_FLUSH_THRESHOLD; i++) {
				manager.handleFileUpdate(`task-${i}`, "uiMessagesPath", `/path/to/file${i}.json`)
			}

			expect(doSyncSpy).not.toHaveBeenCalled()

			manager.handleFileUpdate("task-6", "uiMessagesPath", "/path/to/file6.json")

			expect(doSyncSpy).toHaveBeenCalled()
		})
	})
})

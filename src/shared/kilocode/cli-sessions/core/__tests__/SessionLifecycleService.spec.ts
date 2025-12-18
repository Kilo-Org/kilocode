import { SessionLifecycleService } from "../SessionLifecycleService"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import path from "path"
import { fetchSignedBlob } from "../../utils/fetchBlobFromSignedUrl"
import type { IPathProvider } from "../../types/IPathProvider"
import type { ILogger } from "../../types/ILogger"
import type { IExtensionMessenger } from "../../types/IExtensionMessenger"
import type { ITaskDataProvider } from "../../types/ITaskDataProvider"

vi.mock("../../utils/fetchBlobFromSignedUrl")

vi.mock("fs", () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
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

vi.mock("../../utils/fetchBlobFromSignedUrl", () => ({
	fetchSignedBlob: vi.fn(),
}))

describe("SessionLifecycleService", () => {
	let service: SessionLifecycleService
	let mockSessionClient: any
	let mockPersistenceManager: any
	let mockStateManager: any
	let mockTitleService: any
	let mockGitStateService: any
	let mockPathProvider: IPathProvider
	let mockExtensionMessenger: IExtensionMessenger
	let mockLogger: ILogger
	let mockGetOrganizationId: any
	let mockGetMode: any
	let mockGetModel: any
	let mockOnSessionRestored: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockSessionClient = {
			get: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			list: vi.fn(),
			search: vi.fn(),
			share: vi.fn(),
			fork: vi.fn(),
			delete: vi.fn(),
			uploadBlob: vi.fn(),
			tokenValid: vi.fn(),
			isTokenValidLocally: vi.fn(),
		}

		mockPersistenceManager = {
			getLastSession: vi.fn(),
			setLastSession: vi.fn(),
			getTaskSessionMap: vi.fn(),
			setTaskSessionMap: vi.fn(),
			getSessionForTask: vi.fn(),
			setSessionForTask: vi.fn(),
		}

		mockStateManager = {
			getActiveSessionId: vi.fn(),
			setActiveSessionId: vi.fn(),
			isSessionVerified: vi.fn(),
			markSessionVerified: vi.fn(),
			clearSessionVerified: vi.fn(),
			getGitUrl: vi.fn(),
			setGitUrl: vi.fn(),
			getGitHash: vi.fn(),
			setGitHash: vi.fn(),
			hasTitle: vi.fn(),
			setTitle: vi.fn(),
			getTitle: vi.fn(),
			getUpdatedAt: vi.fn(),
			updateTimestamp: vi.fn(),
			getMode: vi.fn(),
			setMode: vi.fn(),
			getModel: vi.fn(),
			setModel: vi.fn(),
			getTokenValidity: vi.fn(),
			setTokenValidity: vi.fn(),
			clearTokenValidity: vi.fn(),
			getWorkspaceDir: vi.fn(),
			setWorkspaceDir: vi.fn(),
			reset: vi.fn(),
		}

		mockTitleService = {
			getFirstMessageText: vi.fn(),
			generateTitle: vi.fn(),
			updateTitle: vi.fn(),
			generateAndUpdateTitle: vi.fn(),
		}

		mockGitStateService = {
			hashGitState: vi.fn(),
			getGitState: vi.fn(),
			executeGitRestore: vi.fn(),
		}

		mockPathProvider = {
			getTasksDir: vi.fn().mockReturnValue("/mock/tasks"),
			getSessionFilePath: vi.fn(),
		}

		mockExtensionMessenger = {
			sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
			requestSingleCompletion: vi.fn().mockResolvedValue("Generated title"),
		}

		mockLogger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		}

		mockGetOrganizationId = vi.fn().mockResolvedValue("org-123")
		mockGetMode = vi.fn().mockResolvedValue("code")
		mockGetModel = vi.fn().mockResolvedValue("gpt-4")
		mockOnSessionRestored = vi.fn()

		service = new SessionLifecycleService({
			sessionClient: mockSessionClient,
			persistenceManager: mockPersistenceManager,
			stateManager: mockStateManager,
			titleService: mockTitleService,
			gitStateService: mockGitStateService,
			pathProvider: mockPathProvider,
			extensionMessenger: mockExtensionMessenger,
			logger: mockLogger,
			platform: "test-platform",
			version: 1,
			getOrganizationId: mockGetOrganizationId,
			getMode: mockGetMode,
			getModel: mockGetModel,
			onSessionRestored: mockOnSessionRestored,
		})

		// Spy on service methods for internal calls
		vi.spyOn(service, "restoreSession")
	})

	describe("restoreLastSession", () => {
		it("returns false when no persisted session", async () => {
			mockPersistenceManager.getLastSession.mockReturnValue(undefined)

			const result = await service.restoreLastSession()

			expect(result).toBe(false)
			expect(mockLogger.debug).toHaveBeenCalledWith("No persisted session ID found", expect.any(String))
		})

		it("calls restoreSession with persisted session ID", async () => {
			mockPersistenceManager.getLastSession.mockReturnValue({ sessionId: "session-123", timestamp: 1234567890 })
			vi.mocked(service.restoreSession).mockResolvedValue(undefined)

			const result = await service.restoreLastSession()

			expect(result).toBe(true)
			expect(service.restoreSession).toHaveBeenCalledWith("session-123", true)
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Successfully restored persisted session",
				expect.any(String),
				{
					sessionId: "session-123",
				},
			)
		})

		it("returns true on successful restore", async () => {
			mockPersistenceManager.getLastSession.mockReturnValue({ sessionId: "session-123", timestamp: 1234567890 })
			;(service.restoreSession as any).mockResolvedValue(undefined)

			const result = await service.restoreLastSession()

			expect(result).toBe(true)
		})

		it("returns false on restore failure", async () => {
			mockPersistenceManager.getLastSession.mockReturnValue({ sessionId: "session-123", timestamp: 1234567890 })
			vi.mocked(service.restoreSession).mockRejectedValue(new Error("Restore failed"))

			const result = await service.restoreLastSession()

			expect(result).toBe(false)
			expect(mockLogger.warn).toHaveBeenCalledWith("Failed to restore persisted session", expect.any(String), {
				error: "Restore failed",
			})
		})

		it("logs appropriate messages", async () => {
			mockPersistenceManager.getLastSession.mockReturnValue({ sessionId: "session-123", timestamp: 1234567890 })
			;(service.restoreSession as any).mockResolvedValue(undefined)

			await service.restoreLastSession()

			expect(mockLogger.info).toHaveBeenCalledWith(
				"Found persisted session ID, attempting to restore",
				expect.any(String),
				{
					sessionId: "session-123",
				},
			)
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Successfully restored persisted session",
				expect.any(String),
				{
					sessionId: "session-123",
				},
			)
		})
	})

	describe("restoreSession", () => {
		const mockSession = {
			session_id: "session-123",
			title: "Test Session",
			version: 1,
			created_at: "2023-01-01T00:00:00Z",
			api_conversation_history_blob_url: "https://api.example.com",
			ui_messages_blob_url: "https://ui.example.com",
			task_metadata_blob_url: "https://task.example.com",
			git_state_blob_url: "https://git.example.com",
		}

		beforeEach(() => {
			// Default mock returns proper data structures for each blob type
			vi.mocked(fetchSignedBlob).mockImplementation((url) => {
				if (url === "https://api.example.com") {
					return Promise.resolve([{ role: "user", content: "test" }])
				}
				if (url === "https://ui.example.com") {
					return Promise.resolve([{ say: "user_input", text: "test" }])
				}
				if (url === "https://task.example.com") {
					return Promise.resolve({ test: "metadata" })
				}
				if (url === "https://git.example.com") {
					return Promise.resolve({ repoUrl: "https://github.com/test/repo", head: "main", patch: "" })
				}
				return Promise.resolve({ test: "data" })
			})
			vi.mocked(path.join).mockImplementation((...args) => args.join("/"))
		})

		it("fetches session with blob URLs", async () => {
			mockSessionClient.get.mockResolvedValue(mockSession)

			await service.restoreSession("session-123")

			expect(mockSessionClient.get).toHaveBeenCalledWith({
				session_id: "session-123",
				include_blob_urls: true,
			})
		})

		it("throws error when session not found", async () => {
			mockSessionClient.get.mockResolvedValue(undefined)

			await expect(service.restoreSession("session-123", true)).rejects.toThrow("Failed to obtain session")
			expect(mockLogger.error).toHaveBeenCalledWith("Failed to obtain session", expect.any(String), {
				sessionId: "session-123",
			})
		})

		it("logs warning on version mismatch", async () => {
			const mismatchedSession = { ...mockSession, version: 2 }
			mockSessionClient.get.mockResolvedValue(mismatchedSession)

			await service.restoreSession("session-123")

			expect(mockLogger.warn).toHaveBeenCalledWith("Session version mismatch", expect.any(String), {
				sessionId: "session-123",
				expectedVersion: 1,
				actualVersion: 2,
			})
		})

		it("creates session directory", async () => {
			mockSessionClient.get.mockResolvedValue(mockSession)

			await service.restoreSession("session-123")

			expect(mkdirSync).toHaveBeenCalledWith("/mock/tasks/session-123", { recursive: true })
		})

		it("fetches and writes blob files", async () => {
			mockSessionClient.get.mockResolvedValue(mockSession)

			await service.restoreSession("session-123")

			expect(fetchSignedBlob).toHaveBeenCalledTimes(4)
			expect(writeFileSync).toHaveBeenCalledTimes(3) // git_state is handled separately
		})

		it("filters checkpoint_saved messages from ui_messages", async () => {
			const uiMessagesWithCheckpoint = [
				{ say: "user_input", text: "hello" },
				{ say: "checkpoint_saved", text: "checkpoint" },
				{ say: "assistant_reply", text: "hi there" },
			]
			vi.mocked(fetchSignedBlob).mockImplementation((url) => {
				if (url === "https://ui.example.com") {
					return Promise.resolve(uiMessagesWithCheckpoint)
				}
				return Promise.resolve({ test: "data" })
			})

			mockSessionClient.get.mockResolvedValue(mockSession)

			await service.restoreSession("session-123")

			const writeCall = vi
				.mocked(writeFileSync)
				.mock.calls.find((call) => (call[0] as string).includes("ui_messages.json"))
			expect(writeCall).toBeDefined()
			const writtenContent = JSON.parse(writeCall![1] as string)
			expect(writtenContent).toEqual([
				{ say: "user_input", text: "hello" },
				{ say: "assistant_reply", text: "hi there" },
			])
		})

		it("executes git restore for git_state blob", async () => {
			const gitState = { repoUrl: "https://github.com/test/repo", head: "main", patch: "diff content" }
			vi.mocked(fetchSignedBlob).mockImplementation((url) => {
				if (url === "https://api.example.com") {
					return Promise.resolve([{ role: "user", content: "test" }])
				}
				if (url === "https://ui.example.com") {
					return Promise.resolve([{ say: "user_input", text: "test" }])
				}
				if (url === "https://task.example.com") {
					return Promise.resolve({ test: "metadata" })
				}
				if (url === "https://git.example.com") {
					return Promise.resolve(gitState)
				}
				return Promise.resolve({ test: "data" })
			})

			mockSessionClient.get.mockResolvedValue(mockSession)

			await service.restoreSession("session-123")

			expect(mockGitStateService.executeGitRestore).toHaveBeenCalledWith(gitState)
		})

		it("creates history item and registers with extension", async () => {
			mockSessionClient.get.mockResolvedValue(mockSession)

			await service.restoreSession("session-123")

			expect(mockExtensionMessenger.sendWebviewMessage).toHaveBeenCalledWith({
				type: "addTaskToHistory",
				historyItem: expect.objectContaining({
					id: "session-123",
					task: "Test Session",
					ts: expect.any(Number),
				}),
			})
		})

		it("updates state manager with session ID", async () => {
			mockSessionClient.get.mockResolvedValue(mockSession)

			await service.restoreSession("session-123")

			expect(mockStateManager.setActiveSessionId).toHaveBeenCalledWith("session-123")
			expect(mockStateManager.markSessionVerified).toHaveBeenCalledWith("session-123")
		})

		it("persists session as last session", async () => {
			mockSessionClient.get.mockResolvedValue(mockSession)

			await service.restoreSession("session-123")

			expect(mockPersistenceManager.setLastSession).toHaveBeenCalledWith("session-123")
		})

		it("calls onSessionRestored callback", async () => {
			mockSessionClient.get.mockResolvedValue(mockSession)

			await service.restoreSession("session-123")

			expect(mockOnSessionRestored).toHaveBeenCalled()
		})

		it("rethrows error when rethrowError is true", async () => {
			mockSessionClient.get.mockRejectedValue(new Error("API Error"))

			await expect(service.restoreSession("session-123", true)).rejects.toThrow("API Error")
		})

		it("swallows error when rethrowError is false", async () => {
			mockSessionClient.get.mockRejectedValue(new Error("API Error"))

			await expect(service.restoreSession("session-123", false)).resolves.not.toThrow()
			expect(mockLogger.error).toHaveBeenCalledWith("Failed to restore session", expect.any(String), {
				error: "API Error",
				sessionId: "session-123",
			})
		})

		describe("empty session handling", () => {
			it("creates empty JSON files when session has no blob URLs", async () => {
				const emptySession = {
					session_id: "session-123",
					title: "Empty Session",
					version: 1,
					created_at: "2023-01-01T00:00:00Z",
					api_conversation_history_blob_url: undefined,
					ui_messages_blob_url: undefined,
					task_metadata_blob_url: undefined,
					git_state_blob_url: undefined,
				}
				mockSessionClient.get.mockResolvedValue(emptySession)

				await service.restoreSession("session-123")

				// Should create empty ui_messages.json
				expect(writeFileSync).toHaveBeenCalledWith(
					"/mock/tasks/session-123/ui_messages.json",
					JSON.stringify([], null, 2),
				)

				// Should create empty api_conversation_history.json
				expect(writeFileSync).toHaveBeenCalledWith(
					"/mock/tasks/session-123/api_conversation_history.json",
					JSON.stringify([], null, 2),
				)

				// Should log debug messages about creating empty files
				expect(mockLogger.debug).toHaveBeenCalledWith(
					"Created empty ui_messages.json for session without messages",
					expect.any(String),
					{ sessionId: "session-123" },
				)
				expect(mockLogger.debug).toHaveBeenCalledWith(
					"Created empty api_conversation_history.json for session without history",
					expect.any(String),
					{ sessionId: "session-123" },
				)
			})

			it("restores empty session successfully and calls onSessionRestored", async () => {
				const emptySession = {
					session_id: "session-123",
					title: "Empty Session",
					version: 1,
					created_at: "2023-01-01T00:00:00Z",
					api_conversation_history_blob_url: undefined,
					ui_messages_blob_url: undefined,
					task_metadata_blob_url: undefined,
					git_state_blob_url: undefined,
				}
				mockSessionClient.get.mockResolvedValue(emptySession)

				await service.restoreSession("session-123")

				// Should proceed with restore
				expect(mockOnSessionRestored).toHaveBeenCalled()
				expect(mockStateManager.setActiveSessionId).toHaveBeenCalledWith("session-123")
				expect(mockPersistenceManager.setLastSession).toHaveBeenCalledWith("session-123")
			})

			it("creates empty ui_messages.json only when ui_messages_blob_url is missing", async () => {
				const sessionWithApiHistory = {
					session_id: "session-123",
					title: "Session With API History",
					version: 1,
					created_at: "2023-01-01T00:00:00Z",
					api_conversation_history_blob_url: "https://api.example.com",
					ui_messages_blob_url: undefined,
					task_metadata_blob_url: undefined,
					git_state_blob_url: undefined,
				}
				mockSessionClient.get.mockResolvedValue(sessionWithApiHistory)

				await service.restoreSession("session-123")

				// Should create empty ui_messages.json
				expect(writeFileSync).toHaveBeenCalledWith(
					"/mock/tasks/session-123/ui_messages.json",
					JSON.stringify([], null, 2),
				)

				// Should NOT create empty api_conversation_history.json (it has a blob URL)
				const apiHistoryCalls = vi
					.mocked(writeFileSync)
					.mock.calls.filter(
						(call) =>
							(call[0] as string).includes("api_conversation_history.json") &&
							call[1] === JSON.stringify([], null, 2),
					)
				expect(apiHistoryCalls).toHaveLength(0)
			})

			it("creates empty api_conversation_history.json only when api_conversation_history_blob_url is missing", async () => {
				const sessionWithUiMessages = {
					session_id: "session-123",
					title: "Session With UI Messages",
					version: 1,
					created_at: "2023-01-01T00:00:00Z",
					api_conversation_history_blob_url: undefined,
					ui_messages_blob_url: "https://ui.example.com",
					task_metadata_blob_url: undefined,
					git_state_blob_url: undefined,
				}
				mockSessionClient.get.mockResolvedValue(sessionWithUiMessages)

				await service.restoreSession("session-123")

				// Should create empty api_conversation_history.json
				expect(writeFileSync).toHaveBeenCalledWith(
					"/mock/tasks/session-123/api_conversation_history.json",
					JSON.stringify([], null, 2),
				)

				// Should NOT create empty ui_messages.json (it has a blob URL)
				const uiMessagesCalls = vi
					.mocked(writeFileSync)
					.mock.calls.filter(
						(call) =>
							(call[0] as string).includes("ui_messages.json") && call[1] === JSON.stringify([], null, 2),
					)
				expect(uiMessagesCalls).toHaveLength(0)
			})
		})
	})

	describe("shareSession", () => {
		it("uses provided session ID", async () => {
			mockSessionClient.share.mockResolvedValue({ share_id: "share-123" })

			const result = await service.shareSession("session-123")

			expect(mockSessionClient.share).toHaveBeenCalledWith({
				session_id: "session-123",
				shared_state: expect.any(String),
			})
			expect(result).toEqual({ share_id: "share-123" })
		})

		it("uses active session ID when not provided", async () => {
			mockStateManager.getActiveSessionId.mockReturnValue("active-session-123")
			mockSessionClient.share.mockResolvedValue({ share_id: "share-123" })

			await service.shareSession()

			expect(mockSessionClient.share).toHaveBeenCalledWith({
				session_id: "active-session-123",
				shared_state: expect.any(String),
			})
		})

		it("throws error when no active session", async () => {
			mockStateManager.getActiveSessionId.mockReturnValue(null)

			await expect(service.shareSession()).rejects.toThrow("No active session")
		})
	})

	describe("renameSession", () => {
		it("throws error for empty session ID", async () => {
			await expect(service.renameSession("", "New Title")).rejects.toThrow("No active session")
		})

		it("delegates to titleService.updateTitle", async () => {
			mockTitleService.updateTitle.mockResolvedValue(undefined)

			await service.renameSession("session-123", "New Title")

			expect(mockTitleService.updateTitle).toHaveBeenCalledWith("session-123", "New Title")
		})

		it("logs success message", async () => {
			mockTitleService.updateTitle.mockResolvedValue(undefined)

			await service.renameSession("session-123", "New Title")

			expect(mockLogger.info).toHaveBeenCalledWith("Session renamed successfully", expect.any(String), {
				sessionId: "session-123",
				newTitle: "New Title",
			})
		})
	})

	describe("forkSession", () => {
		it("calls sessionClient.fork with correct params", async () => {
			mockSessionClient.fork.mockResolvedValue({ session_id: "forked-session-123" })
			vi.mocked(service.restoreSession).mockResolvedValue(undefined)

			await service.forkSession("share-or-session-123")

			expect(mockSessionClient.fork).toHaveBeenCalledWith({
				share_or_session_id: "share-or-session-123",
				created_on_platform: "test-platform",
			})
		})

		it("calls restoreSession with forked session ID", async () => {
			mockSessionClient.fork.mockResolvedValue({ session_id: "forked-session-123" })
			vi.mocked(service.restoreSession).mockResolvedValue(undefined)

			await service.forkSession("share-or-session-123")

			expect(service.restoreSession).toHaveBeenCalledWith("forked-session-123", false)
		})

		it("passes rethrowError to restoreSession", async () => {
			mockSessionClient.fork.mockResolvedValue({ session_id: "forked-session-123" })
			vi.mocked(service.restoreSession).mockResolvedValue(undefined)

			await service.forkSession("share-or-session-123", true)

			expect(service.restoreSession).toHaveBeenCalledWith("forked-session-123", true)
		})
	})

	describe("getOrCreateSessionForTask", () => {
		const mockProvider: ITaskDataProvider = {
			getTaskWithId: vi.fn().mockResolvedValue({
				historyItem: { task: "Test task" },
				apiConversationHistoryFilePath: "/mock/api.json",
				uiMessagesFilePath: "/mock/ui.json",
			}),
		}

		beforeEach(() => {
			vi.mocked(readFileSync).mockImplementation((path) => {
				if (path === "/mock/api.json") return JSON.stringify([{ role: "user", content: "hello" }])
				if (path === "/mock/ui.json") return JSON.stringify([{ say: "user_input", text: "hello" }])
				return "{}"
			})
		})

		it("returns existing session when verified", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue("existing-session-123")
			mockStateManager.isSessionVerified.mockReturnValue(true)

			const result = await service.getOrCreateSessionForTask("task-123", mockProvider)

			expect(result).toBe("existing-session-123")
			expect(mockLogger.debug).toHaveBeenCalledWith("Session already verified (cached)", expect.any(String), {
				taskId: "task-123",
				sessionId: "existing-session-123",
			})
		})

		it("verifies session existence when not cached", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue("existing-session-123")
			mockStateManager.isSessionVerified.mockReturnValue(false)
			mockSessionClient.get.mockResolvedValue({ session_id: "existing-session-123" })

			await service.getOrCreateSessionForTask("task-123", mockProvider)

			expect(mockSessionClient.get).toHaveBeenCalledWith({
				session_id: "existing-session-123",
				include_blob_urls: false,
			})
			expect(mockStateManager.markSessionVerified).toHaveBeenCalledWith("existing-session-123")
		})

		it("creates new session when verification fails", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue("existing-session-123")
			mockStateManager.isSessionVerified.mockReturnValue(false)
			mockSessionClient.get.mockRejectedValue(new Error("Session not found"))
			mockSessionClient.create.mockResolvedValue({ session_id: "new-session-123" })
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: new Date().toISOString() })

			const result = await service.getOrCreateSessionForTask("task-123", mockProvider)

			expect(result).toBe("new-session-123")
			expect(mockSessionClient.create).toHaveBeenCalled()
		})

		it("creates new session when no existing session", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			mockSessionClient.create.mockResolvedValue({ session_id: "new-session-123" })
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: new Date().toISOString() })

			const result = await service.getOrCreateSessionForTask("task-123", mockProvider)

			expect(result).toBe("new-session-123")
			expect(mockSessionClient.create).toHaveBeenCalledWith({
				title: "Test task",
				created_on_platform: "test-platform",
				version: 1,
				organization_id: "org-123",
				last_mode: "code",
				last_model: "gpt-4",
			})
		})

		it("reads task data from provider", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			mockSessionClient.create.mockResolvedValue({ session_id: "new-session-123" })
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: new Date().toISOString() })

			await service.getOrCreateSessionForTask("task-123", mockProvider)

			expect(mockProvider.getTaskWithId).toHaveBeenCalledWith("task-123")
			expect(readFileSync).toHaveBeenCalledWith("/mock/api.json", "utf8")
			expect(readFileSync).toHaveBeenCalledWith("/mock/ui.json", "utf8")
		})

		it("uploads conversation blobs for new session", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			mockSessionClient.create.mockResolvedValue({ session_id: "new-session-123" })
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: new Date().toISOString() })

			await service.getOrCreateSessionForTask("task-123", mockProvider)

			expect(mockSessionClient.uploadBlob).toHaveBeenCalledWith("new-session-123", "api_conversation_history", [
				{ role: "user", content: "hello" },
			])
			expect(mockSessionClient.uploadBlob).toHaveBeenCalledWith("new-session-123", "ui_messages", [
				{ say: "user_input", text: "hello" },
			])
		})

		it("persists task-session mapping", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			mockSessionClient.create.mockResolvedValue({ session_id: "new-session-123" })
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: new Date().toISOString() })

			await service.getOrCreateSessionForTask("task-123", mockProvider)

			expect(mockPersistenceManager.setSessionForTask).toHaveBeenCalledWith("task-123", "new-session-123")
		})

		it("marks session as verified", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			mockSessionClient.create.mockResolvedValue({ session_id: "new-session-123" })
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: new Date().toISOString() })

			await service.getOrCreateSessionForTask("task-123", mockProvider)

			expect(mockStateManager.markSessionVerified).toHaveBeenCalledWith("new-session-123")
		})

		it("sets mode and model in state manager", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			mockSessionClient.create.mockResolvedValue({ session_id: "new-session-123" })
			mockSessionClient.uploadBlob.mockResolvedValue({ updated_at: new Date().toISOString() })

			await service.getOrCreateSessionForTask("task-123", mockProvider)

			expect(mockStateManager.setMode).toHaveBeenCalledWith("new-session-123", "code")
			expect(mockStateManager.setModel).toHaveBeenCalledWith("new-session-123", "gpt-4")
		})

		it("throws error on failure", async () => {
			mockPersistenceManager.getSessionForTask.mockReturnValue(undefined)
			vi.mocked(mockProvider.getTaskWithId).mockRejectedValue(new Error("Provider error"))

			await expect(service.getOrCreateSessionForTask("task-123", mockProvider)).rejects.toThrow("Provider error")
			expect(mockLogger.error).toHaveBeenCalledWith(
				"Failed to get or create session from task",
				expect.any(String),
				{
					taskId: "task-123",
					error: "Provider error",
				},
			)
		})
	})
})

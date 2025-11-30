import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { SessionService } from "../session.js"
import { SessionClient } from "../sessionClient.js"
import type { ExtensionService } from "../extension.js"
import type { ClineMessage } from "@roo-code/types"
import type { SimpleGit, RemoteWithRefs } from "simple-git"

// Mock fs module
vi.mock("fs", () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	existsSync: vi.fn(),
}))

// Mock fs-extra module
vi.mock("fs-extra", () => ({
	ensureDirSync: vi.fn(),
}))

vi.mock("../sessionClient.js")
vi.mock("../logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

// Mock KiloCodePaths
vi.mock("../../utils/paths.js", () => ({
	KiloCodePaths: {
		getTasksDir: vi.fn(() => "/mock/tasks/dir"),
		getLastSessionPath: vi.fn((workspace: string) => `/mock/workspace/${workspace}/last-session.json`),
	},
}))

// Mock simple-git
vi.mock("simple-git")

// Import after mocking
import { readFileSync, writeFileSync, existsSync } from "fs"
import { ensureDirSync } from "fs-extra"
import { logs } from "../logs.js"
import simpleGit from "simple-git"
import { createStore } from "jotai"

describe("SessionService", () => {
	let service: SessionService
	let mockSessionClient: SessionClient
	let mockCreate: ReturnType<typeof vi.fn>
	let mockUpdate: ReturnType<typeof vi.fn>
	let mockGet: ReturnType<typeof vi.fn>
	let mockExtensionService: ExtensionService
	let mockSendWebviewMessage: ReturnType<typeof vi.fn>
	let mockRequestSingleCompletion: ReturnType<typeof vi.fn>
	let mockGit: Partial<SimpleGit>
	let mockStore: ReturnType<typeof createStore>

	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()

		// Reset the singleton instance before each test
		// @ts-expect-error - Accessing private static property for testing
		SessionService.instance = null

		// Mock ExtensionService
		mockSendWebviewMessage = vi.fn().mockResolvedValue(undefined)
		mockRequestSingleCompletion = vi.fn()
		mockExtensionService = {
			sendWebviewMessage: mockSendWebviewMessage,
			requestSingleCompletion: mockRequestSingleCompletion,
		} as unknown as ExtensionService

		// Mock Jotai store
		mockStore = {
			get: vi.fn(),
			set: vi.fn(),
			sub: vi.fn(),
		} as unknown as ReturnType<typeof createStore>

		// Mock SessionClient methods
		mockCreate = vi.fn()
		mockUpdate = vi.fn()
		mockGet = vi.fn()
		mockSessionClient = {
			create: mockCreate,
			update: mockUpdate,
			get: mockGet,
		} as unknown as SessionClient

		// Mock SessionClient.getInstance to return our mock
		vi.spyOn(SessionClient, "getInstance").mockReturnValue(mockSessionClient)

		// Set up default git mocks for all tests - make git fail by default
		// (as if not in a git repository). Tests that need git will set up their own mocks.
		mockGit = {
			getRemotes: vi.fn().mockRejectedValue(new Error("not a git repository")),
			revparse: vi.fn().mockRejectedValue(new Error("not a git repository")),
			raw: vi.fn().mockRejectedValue(new Error("not a git repository")),
			diff: vi.fn().mockRejectedValue(new Error("not a git repository")),
		}
		vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

		service = SessionService.init(mockExtensionService, mockStore, false)
	})

	afterEach(async () => {
		if (service) {
			await service.destroy()
		}
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	describe("init", () => {
		it("should throw error when called without extensionService on first init", () => {
			// @ts-expect-error - Accessing private static property for testing
			SessionService.instance = null

			expect(() => SessionService.init()).toThrow("SessionService not initialized")
		})

		it("should return same instance on multiple calls", () => {
			const instance1 = SessionService.init(mockExtensionService, mockStore, false)
			const instance2 = SessionService.init()
			expect(instance1).toBe(instance2)
		})

		it("should be a singleton", () => {
			// @ts-expect-error - Accessing private static property for testing
			expect(SessionService.instance).not.toBeNull()
		})

		it("should accept extensionService parameter", () => {
			// @ts-expect-error - Accessing private static property for testing
			SessionService.instance = null

			const instance = SessionService.init(mockExtensionService, mockStore, false)
			expect(instance).toBeInstanceOf(SessionService)
			expect(vi.mocked(logs.debug)).toHaveBeenCalledWith("Initialized SessionService", "SessionService")
		})
	})

	describe("readPath", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		it("should read and parse JSON file", () => {
			const jsonContent = JSON.stringify({ key: "value" })
			vi.mocked(readFileSync).mockReturnValueOnce(jsonContent)

			// @ts-expect-error - Testing private method
			const result = service.readPath("/path/to/file.json")

			expect(readFileSync).toHaveBeenCalledWith("/path/to/file.json", "utf-8")
			expect(result).toEqual({ key: "value" })
		})

		it("should return undefined for non-JSON files", () => {
			const textContent = "plain text content"
			vi.mocked(readFileSync).mockReturnValueOnce(textContent)

			// @ts-expect-error - Testing private method
			const result = service.readPath("/path/to/file.txt")

			expect(readFileSync).toHaveBeenCalledWith("/path/to/file.txt", "utf-8")
			expect(result).toBeUndefined()
		})

		it("should return undefined when file read fails", () => {
			vi.mocked(readFileSync).mockImplementationOnce(() => {
				throw new Error("File not found")
			})

			// @ts-expect-error - Testing private method
			const result = service.readPath("/path/to/nonexistent.json")

			expect(result).toBeUndefined()
		})

		it("should return undefined when JSON parse fails", () => {
			const invalidJson = "{invalid json"
			vi.mocked(readFileSync).mockReturnValueOnce(invalidJson)

			// @ts-expect-error - Testing private method
			const result = service.readPath("/path/to/invalid.json")

			expect(result).toBeUndefined()
		})
	})

	describe("readPaths", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		it("should read all configured paths", () => {
			const mockData1 = { data: "api" }
			const mockData2 = { data: "ui" }
			const mockData3 = { data: "metadata" }

			vi.mocked(readFileSync)
				.mockReturnValueOnce(JSON.stringify(mockData1))
				.mockReturnValueOnce(JSON.stringify(mockData2))
				.mockReturnValueOnce(JSON.stringify(mockData3))

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")
			service.setPath("uiMessagesPath", "/path/to/ui.json")
			service.setPath("taskMetadataPath", "/path/to/metadata.json")

			// @ts-expect-error - Testing private method
			const result = service.readPaths()

			expect(result).toEqual({
				apiConversationHistoryPath: mockData1,
				uiMessagesPath: mockData2,
				taskMetadataPath: mockData3,
			})
		})

		it("should skip null paths", () => {
			const mockData = { data: "api" }
			vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(mockData))

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// @ts-expect-error - Testing private method
			const result = service.readPaths()

			expect(result).toEqual({
				apiConversationHistoryPath: mockData,
			})
			expect(readFileSync).toHaveBeenCalledTimes(1)
		})

		it("should skip paths with undefined content", () => {
			vi.mocked(readFileSync).mockImplementationOnce(() => {
				throw new Error("File not found")
			})

			service.setPath("apiConversationHistoryPath", "/path/to/nonexistent.json")

			// @ts-expect-error - Testing private method
			const result = service.readPaths()

			expect(result).toEqual({})
		})

		it("should return empty object when no paths configured", () => {
			// @ts-expect-error - Testing private method
			const result = service.readPaths()

			expect(result).toEqual({})
			expect(readFileSync).not.toHaveBeenCalled()
		})
	})

	describe("syncSession", () => {
		it("should not sync when no paths configured", async () => {
			vi.advanceTimersByTime(1000)

			expect(mockCreate).not.toHaveBeenCalled()
			expect(mockUpdate).not.toHaveBeenCalled()
		})

		it("should create new session on first sync", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(mockData))

			mockCreate.mockResolvedValueOnce({
				session_id: "new-session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			const mockUploadBlob = vi.fn().mockResolvedValue({
				session_id: "new-session-id",
				updated_at: "2025-01-01T00:00:00Z",
			})
			mockSessionClient.uploadBlob = mockUploadBlob

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Trigger sync via timer
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledWith({
				created_on_platform: "cli",
			})
			expect(mockUploadBlob).toHaveBeenCalledWith("new-session-id", "api_conversation_history", mockData)
			expect(mockUpdate).not.toHaveBeenCalled()
		})

		it("should update existing session when git URL changes", async () => {
			vi.mocked(readFileSync)
				.mockReturnValueOnce(JSON.stringify({ messages: ["first"] }))
				.mockReturnValueOnce(JSON.stringify({ messages: ["first", "second"] }))

			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			mockUpdate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				updated_at: "2025-01-01T00:01:00Z",
			})

			const mockUploadBlob = vi.fn().mockResolvedValue({
				session_id: "session-id",
				updated_at: "2025-01-01T00:00:00Z",
			})
			mockSessionClient.uploadBlob = mockUploadBlob

			// Set up git mocks for first sync
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "https://github.com/user/repo.git",
					},
				},
			])
			mockGit.revparse = vi.fn().mockResolvedValue("abc123")
			mockGit.raw = vi.fn().mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "ls-files") {
					return Promise.resolve("")
				}
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				return Promise.resolve("")
			})
			mockGit.diff = vi.fn().mockResolvedValue("some diff")

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// First sync - creates session with git URL
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledWith({
				created_on_platform: "cli",
				git_url: "https://github.com/user/repo.git",
			})

			// Change git URL to trigger update
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/new-repo.git",
						push: "https://github.com/user/new-repo.git",
					},
				},
			])

			// Modify path to trigger new sync
			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Second sync - updates session because git URL changed
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockUpdate).toHaveBeenCalledWith({
				session_id: "session-id",
				git_url: "https://github.com/user/new-repo.git",
			})
			expect(mockUploadBlob).toHaveBeenCalledWith("session-id", "api_conversation_history", {
				messages: ["first", "second"],
			})
		})

		it("should not sync when no blob has changed", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			const mockUploadBlob = vi.fn().mockResolvedValue({
				session_id: "session-id",
				updated_at: "2025-01-01T00:00:00Z",
			})
			mockSessionClient.uploadBlob = mockUploadBlob

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// First sync
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledTimes(1)
			expect(mockUploadBlob).toHaveBeenCalledTimes(1)

			// Clear mocks to check second sync
			vi.clearAllMocks()

			// Second timer tick without setPath - should not sync
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).not.toHaveBeenCalled()
			expect(mockUpdate).not.toHaveBeenCalled()
			expect(mockUploadBlob).not.toHaveBeenCalled()
		})

		it("should not sync when all file reads return undefined", async () => {
			vi.mocked(readFileSync).mockImplementation(() => {
				throw new Error("File not found")
			})

			service.setPath("apiConversationHistoryPath", "/path/to/nonexistent.json")

			await vi.advanceTimersByTimeAsync(1000)

			expect(mockCreate).not.toHaveBeenCalled()
			expect(mockUpdate).not.toHaveBeenCalled()
		})

		it("should sync with multiple paths", async () => {
			const mockData1 = { api: "data" }
			const mockData2 = [{ ts: 1000, type: "say", say: "text", text: "test message" }]
			const mockData3 = { task: "data" }

			vi.mocked(readFileSync)
				.mockReturnValueOnce(JSON.stringify(mockData1))
				.mockReturnValueOnce(JSON.stringify(mockData2))
				.mockReturnValueOnce(JSON.stringify(mockData3))

			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			const mockUploadBlob = vi.fn().mockResolvedValue({
				session_id: "session-id",
				updated_at: "2025-01-01T00:00:00Z",
			})
			mockSessionClient.uploadBlob = mockUploadBlob

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")
			service.setPath("uiMessagesPath", "/path/to/ui.json")
			service.setPath("taskMetadataPath", "/path/to/metadata.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledWith({
				created_on_platform: "cli",
				title: "test message",
			})
			expect(mockUploadBlob).toHaveBeenCalledWith("session-id", "api_conversation_history", mockData1)
			expect(mockUploadBlob).toHaveBeenCalledWith("session-id", "ui_messages", mockData2)
			expect(mockUploadBlob).toHaveBeenCalledWith("session-id", "task_metadata", mockData3)
		})
	})

	describe("setPath", () => {
		it("should set path and trigger blob hash update", () => {
			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// @ts-expect-error - Accessing private property for testing
			expect(service.paths.apiConversationHistoryPath).toBe("/path/to/api.json")
			// @ts-expect-error - Accessing private property for testing
			expect(service.blobHashes.apiConversationHistory).toBeTruthy()
		})

		it("should update blob hash with unique values on each call", () => {
			service.setPath("apiConversationHistoryPath", "/path/to/api.json")
			// @ts-expect-error - Accessing private property for testing
			const firstHash = service.blobHashes.apiConversationHistory

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")
			// @ts-expect-error - Accessing private property for testing
			const secondHash = service.blobHashes.apiConversationHistory

			expect(firstHash).not.toBe(secondHash)
		})
	})

	describe("destroy", () => {
		it("should clear timer", async () => {
			const clearIntervalSpy = vi.spyOn(global, "clearInterval")

			await service.destroy()

			expect(clearIntervalSpy).toHaveBeenCalled()
		})

		it("should flush session before destroying", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			const mockUploadBlob = vi.fn().mockResolvedValue({
				session_id: "session-id",
				updated_at: "2025-01-01T00:00:00Z",
			})
			mockSessionClient.uploadBlob = mockUploadBlob

			// Set up git mocks
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "https://github.com/user/repo.git",
					},
				},
			])
			mockGit.revparse = vi.fn().mockResolvedValue("abc123")
			mockGit.raw = vi.fn().mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "ls-files") {
					return Promise.resolve("")
				}
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				return Promise.resolve("")
			})
			mockGit.diff = vi.fn().mockResolvedValue("some diff")

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Wait for initial sync to create the session
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledTimes(1)

			// Clear mocks to isolate destroy behavior
			vi.clearAllMocks()

			// Change git URL to trigger update during destroy
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/new-repo.git",
						push: "https://github.com/user/new-repo.git",
					},
				},
			])

			// Set a new path to trigger sync during destroy
			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			mockUpdate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				updated_at: "2025-01-01T00:01:00Z",
			})

			await service.destroy()

			// Should have called update because git URL changed
			expect(mockUpdate).toHaveBeenCalledWith({
				session_id: "session-id",
				git_url: "https://github.com/user/new-repo.git",
			})
			expect(mockUploadBlob).toHaveBeenCalledWith("session-id", "api_conversation_history", mockData)
		})

		it("should reset paths to default", async () => {
			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// @ts-expect-error - Accessing private property for testing
			expect(service.paths.apiConversationHistoryPath).toBe("/path/to/api.json")

			await service.destroy()

			// @ts-expect-error - Accessing private property for testing
			expect(service.paths.apiConversationHistoryPath).toBeNull()
		})

		it("should reset sessionId", async () => {
			// Set up a session
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Wait for session creation
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			await service.destroy()

			expect(service.sessionId).toBeNull()
		})

		it("should allow timer to be cleared multiple times safely", async () => {
			await service.destroy()
			await expect(service.destroy()).resolves.not.toThrow()
		})
	})

	describe("timer behavior", () => {
		it("should start timer on construction", () => {
			const setIntervalSpy = vi.spyOn(global, "setInterval")

			// Create new instance to test construction
			// @ts-expect-error - Reset for testing
			SessionService.instance = null
			SessionService.init(mockExtensionService, mockStore, false)

			expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), SessionService.SYNC_INTERVAL)
		})

		it("should call syncSession at SYNC_INTERVAL", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			mockCreate.mockResolvedValue({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			// Set up git mocks for first sync
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "https://github.com/user/repo.git",
					},
				},
			])
			mockGit.revparse = vi.fn().mockResolvedValue("abc123")
			mockGit.raw = vi.fn().mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "ls-files") {
					return Promise.resolve("")
				}
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				return Promise.resolve("")
			})
			mockGit.diff = vi.fn().mockResolvedValue("some diff")

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// First tick
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)
			expect(mockCreate).toHaveBeenCalledTimes(1)

			// Change git URL to trigger update
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/new-repo.git",
						push: "https://github.com/user/new-repo.git",
					},
				},
			])

			// Trigger new save event
			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Second tick - should call update because git URL changed
			mockUpdate.mockResolvedValue({
				session_id: "session-id",
				title: "",
				updated_at: "2025-01-01T00:01:00Z",
			})

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)
			expect(mockUpdate).toHaveBeenCalledTimes(1)
		})
	})

	describe("error handling", () => {
		it("should handle API errors gracefully and continue syncing", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// First call fails
			mockCreate.mockRejectedValueOnce(new Error("Network error"))

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// First sync attempt - should fail but not throw
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledTimes(1)
			expect(vi.mocked(logs.error)).toHaveBeenCalledWith(
				"Failed to sync session",
				"SessionService",
				expect.objectContaining({
					error: "Network error",
				}),
			)

			// Second call succeeds
			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			// Trigger new save event to force new sync
			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Second sync attempt - should succeed
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledTimes(2)
			expect(vi.mocked(logs.info)).toHaveBeenCalledWith(
				"Session created successfully",
				"SessionService",
				expect.objectContaining({
					sessionId: "session-id",
				}),
			)
		})

		it("should handle update failures gracefully", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			// Set up git mocks for first sync
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "https://github.com/user/repo.git",
					},
				},
			])
			mockGit.revparse = vi.fn().mockResolvedValue("abc123")
			mockGit.raw = vi.fn().mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "ls-files") {
					return Promise.resolve("")
				}
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				return Promise.resolve("")
			})
			mockGit.diff = vi.fn().mockResolvedValue("some diff")

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// First sync - creates session
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledTimes(1)

			// Change git URL to trigger update
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/new-repo.git",
						push: "https://github.com/user/new-repo.git",
					},
				},
			])

			// Update fails
			mockUpdate.mockRejectedValueOnce(new Error("Update failed"))

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Second sync - update fails but doesn't throw
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockUpdate).toHaveBeenCalledTimes(1)
			expect(vi.mocked(logs.error)).toHaveBeenCalledWith(
				"Failed to sync session",
				"SessionService",
				expect.objectContaining({
					error: "Update failed",
					sessionId: "session-id",
				}),
			)
		})

		it("should complete destroy even when final sync fails", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// Set up git mocks for first sync
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "https://github.com/user/repo.git",
					},
				},
			])
			mockGit.revparse = vi.fn().mockResolvedValue("abc123")
			mockGit.raw = vi.fn().mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "ls-files") {
					return Promise.resolve("")
				}
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				return Promise.resolve("")
			})
			mockGit.diff = vi.fn().mockResolvedValue("some diff")

			// Create a session first
			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			const mockUploadBlob = vi.fn().mockResolvedValue({
				session_id: "session-id",
				updated_at: "2025-01-01T00:00:00Z",
			})
			mockSessionClient.uploadBlob = mockUploadBlob

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Wait for initial sync to complete
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			// Clear mocks to isolate destroy behavior
			vi.clearAllMocks()

			// Change git URL to trigger update during destroy
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/new-repo.git",
						push: "https://github.com/user/new-repo.git",
					},
				},
			])

			// Set a new path to trigger sync during destroy
			service.setPath("apiConversationHistoryPath", "/path/to/api2.json")

			// Make the update during destroy fail
			mockUpdate.mockRejectedValueOnce(new Error("Sync failed during destroy"))

			// Destroy should complete without throwing, even though sync fails
			await expect(service.destroy()).resolves.not.toThrow()

			// syncSession logs the error (not destroy, since syncSession catches internally)
			expect(vi.mocked(logs.error)).toHaveBeenCalledWith(
				"Failed to sync session",
				"SessionService",
				expect.objectContaining({
					error: "Sync failed during destroy",
					sessionId: "session-id",
				}),
			)

			// Verify destroy completed successfully - check for flushed message instead
			expect(vi.mocked(logs.debug)).toHaveBeenCalledWith("SessionService flushed", "SessionService")
		})
	})

	describe("concurrency protection", () => {
		it("should prevent concurrent sync operations", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// Make the first sync take a long time
			let resolveFirst: () => void
			const firstSyncPromise = new Promise<{
				session_id: string
				title: string
				created_at: string
				updated_at: string
			}>((resolve) => {
				resolveFirst = () =>
					resolve({
						session_id: "session-id",
						title: "",
						created_at: "2025-01-01T00:00:00Z",
						updated_at: "2025-01-01T00:00:00Z",
					})
			})

			mockCreate.mockReturnValueOnce(firstSyncPromise)

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Start first sync (but don't await - it's already running via timer)
			const firstTick = vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			// Try to trigger another sync while first is in progress
			service.setPath("apiConversationHistoryPath", "/path/to/api2.json")
			const secondTick = vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			// Both ticks run but second should skip due to lock
			await Promise.all([firstTick, secondTick])

			// Now resolve the first sync
			resolveFirst!()
			await firstSyncPromise

			// Only one create call should have been made (second was blocked by lock)
			expect(mockCreate).toHaveBeenCalledTimes(1)
		})

		it("should release lock even if sync fails", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// First sync fails
			mockCreate.mockRejectedValueOnce(new Error("Sync failed"))

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledTimes(1)

			// Second sync should work (lock was released)
			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(mockCreate).toHaveBeenCalledTimes(2)
		})
	})

	describe("restoreSession", () => {
		beforeEach(() => {
			// Mock global fetch
			global.fetch = vi.fn()
		})

		afterEach(() => {
			// Restore global fetch
			vi.restoreAllMocks()
		})

		it("should restore session from signed URLs and write files to disk", async () => {
			const mockSessionData = {
				session_id: "restored-session-id",
				title: "Restored Session",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
				api_conversation_history_blob_url: "https://signed-url.com/api_conversation_history",
				ui_messages_blob_url: "https://signed-url.com/ui_messages",
				task_metadata_blob_url: "https://signed-url.com/task_metadata",
			}

			const apiConversationData = { messages: [{ role: "user", content: "test" }] }
			const uiMessagesData = [
				{ say: "text", text: "message 1", ts: 1000 },
				{ say: "checkpoint_saved", text: "", ts: 2000 }, // Should be filtered out
				{ say: "text", text: "message 2", ts: 3000 },
			] as ClineMessage[]
			const taskMetadataData = { task: "test task" }

			mockGet.mockResolvedValueOnce(mockSessionData)

			// Mock fetch responses for each signed URL
			vi.mocked(global.fetch)
				.mockResolvedValueOnce({
					ok: true,
					headers: new Headers({ "content-type": "application/json" }),
					json: async () => apiConversationData,
				} as unknown as Response)
				.mockResolvedValueOnce({
					ok: true,
					headers: new Headers({ "content-type": "application/json" }),
					json: async () => uiMessagesData,
				} as unknown as Response)
				.mockResolvedValueOnce({
					ok: true,
					headers: new Headers({ "content-type": "application/json" }),
					json: async () => taskMetadataData,
				} as unknown as Response)

			await service.restoreSession("restored-session-id")

			// Verify SessionClient.get was called with include_blob_urls
			expect(mockGet).toHaveBeenCalledWith({
				session_id: "restored-session-id",
				include_blob_urls: true,
			})

			// Verify fetch was called for each signed URL
			expect(global.fetch).toHaveBeenCalledWith("https://signed-url.com/api_conversation_history")
			expect(global.fetch).toHaveBeenCalledWith("https://signed-url.com/ui_messages")
			expect(global.fetch).toHaveBeenCalledWith("https://signed-url.com/task_metadata")

			// Verify directory was created
			expect(vi.mocked(ensureDirSync)).toHaveBeenCalledWith("/mock/tasks/dir/restored-session-id")

			// Verify files were written
			expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(3)
			expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
				"/mock/tasks/dir/restored-session-id/api_conversation_history.json",
				JSON.stringify(apiConversationData, null, 2),
			)

			// Verify checkpoint messages were filtered out
			const uiMessagesCall = vi
				.mocked(writeFileSync)
				.mock.calls.find((call) => call[0] === "/mock/tasks/dir/restored-session-id/ui_messages.json")
			expect(uiMessagesCall?.[1]).toContain("message 1")
			expect(uiMessagesCall?.[1]).toContain("message 2")
			expect(uiMessagesCall?.[1]).not.toContain("checkpoint_saved")

			expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
				"/mock/tasks/dir/restored-session-id/task_metadata.json",
				JSON.stringify(taskMetadataData, null, 2),
			)
		})

		it("should send messages to extension to register task", async () => {
			const mockSessionData = {
				session_id: "restored-session-id",
				title: "Restored Session",
				created_at: "2025-01-01T12:00:00Z",
				updated_at: "2025-01-01T12:00:00Z",
				api_conversation_history: null,
				ui_messages: null,
				task_metadata: null,
			}

			mockGet.mockResolvedValueOnce(mockSessionData)

			await service.restoreSession("restored-session-id")

			// Verify addTaskToHistory message was sent
			expect(mockSendWebviewMessage).toHaveBeenCalledWith({
				type: "addTaskToHistory",
				historyItem: {
					id: "restored-session-id",
					number: 1,
					task: "Restored Session",
					ts: new Date("2025-01-01T12:00:00Z").getTime(),
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
			})

			// Verify showTaskWithId message was sent
			expect(mockSendWebviewMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "restored-session-id",
			})
		})

		it("should handle missing session gracefully", async () => {
			mockGet.mockResolvedValueOnce(null)

			await service.restoreSession("non-existent-id")

			expect(vi.mocked(logs.error)).toHaveBeenCalledWith(
				"Failed to obtain session",
				"SessionService",
				expect.objectContaining({
					sessionId: "non-existent-id",
				}),
			)

			// Should not write any files
			expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
		})

		it("should handle restore errors gracefully", async () => {
			mockGet.mockRejectedValueOnce(new Error("Network error"))

			await service.restoreSession("error-session-id")

			expect(vi.mocked(logs.error)).toHaveBeenCalledWith(
				"Failed to restore session",
				"SessionService",
				expect.objectContaining({
					error: "Network error",
					sessionId: "error-session-id",
				}),
			)

			// SessionId should be reset to null on error
			expect(service.sessionId).toBeNull()
		})

		it("should skip fetching blobs when signed URLs are null", async () => {
			const mockSessionData = {
				session_id: "partial-session-id",
				title: "Partial Session",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
				api_conversation_history_blob_url: "https://signed-url.com/api_conversation_history",
				ui_messages_blob_url: null,
				task_metadata_blob_url: null,
			}

			const apiConversationData = { messages: [] }

			mockGet.mockResolvedValueOnce(mockSessionData)

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				headers: new Headers({ "content-type": "application/json" }),
				json: async () => apiConversationData,
			} as unknown as Response)

			await service.restoreSession("partial-session-id")

			// Only one fetch call should be made
			expect(global.fetch).toHaveBeenCalledTimes(1)
			expect(global.fetch).toHaveBeenCalledWith("https://signed-url.com/api_conversation_history")

			// Only one file should be written
			expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(1)
			expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
				"/mock/tasks/dir/partial-session-id/api_conversation_history.json",
				JSON.stringify(apiConversationData, null, 2),
			)
		})

		it("should handle fetch errors gracefully and continue processing other blobs", async () => {
			const mockSessionData = {
				session_id: "error-session-id",
				title: "Error Session",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
				api_conversation_history_blob_url: "https://signed-url.com/api_conversation_history",
				ui_messages_blob_url: "https://signed-url.com/ui_messages",
				task_metadata_blob_url: "https://signed-url.com/task_metadata",
			}

			const uiMessagesData = [{ say: "text", text: "message", ts: 1000 }] as ClineMessage[]
			const taskMetadataData = { task: "test" }

			mockGet.mockResolvedValueOnce(mockSessionData)

			// First fetch fails, others succeed
			vi.mocked(global.fetch)
				.mockResolvedValueOnce({
					ok: false,
					status: 403,
					statusText: "Forbidden",
					headers: new Headers({ "content-type": "application/json" }),
				} as unknown as Response)
				.mockResolvedValueOnce({
					ok: true,
					headers: new Headers({ "content-type": "application/json" }),
					json: async () => uiMessagesData,
				} as unknown as Response)
				.mockResolvedValueOnce({
					ok: true,
					headers: new Headers({ "content-type": "application/json" }),
					json: async () => taskMetadataData,
				} as unknown as Response)

			await service.restoreSession("error-session-id")

			// Should log error for failed blob fetch
			expect(vi.mocked(logs.error)).toHaveBeenCalledWith(
				"Failed to process blob",
				"SessionService",
				expect.objectContaining({
					filename: "api_conversation_history",
				}),
			)

			// Should still write the successful blobs
			expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(2)
		})

		it("should handle non-JSON responses", async () => {
			const mockSessionData = {
				session_id: "invalid-json-session",
				title: "Invalid JSON Session",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
				api_conversation_history_blob_url: "https://signed-url.com/api_conversation_history",
				ui_messages_blob_url: null,
				task_metadata_blob_url: null,
			}

			mockGet.mockResolvedValueOnce(mockSessionData)

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				headers: new Headers({ "content-type": "text/html" }),
			} as unknown as Response)

			await service.restoreSession("invalid-json-session")

			// Should log error for invalid content type
			expect(vi.mocked(logs.error)).toHaveBeenCalledWith(
				"Failed to process blob",
				"SessionService",
				expect.objectContaining({
					filename: "api_conversation_history",
				}),
			)

			// Should not write any files
			expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
		})

		it("should log info messages during restoration", async () => {
			const mockSessionData = {
				session_id: "session-with-logs",
				title: "Test Session",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
				api_conversation_history: null,
				ui_messages: null,
				task_metadata: null,
			}

			mockGet.mockResolvedValueOnce(mockSessionData)

			await service.restoreSession("session-with-logs")

			expect(vi.mocked(logs.info)).toHaveBeenCalledWith(
				"Restoring session",
				"SessionService",
				expect.objectContaining({
					sessionId: "session-with-logs",
				}),
			)

			expect(vi.mocked(logs.info)).toHaveBeenCalledWith(
				"Task registered with extension",
				"SessionService",
				expect.objectContaining({
					sessionId: "session-with-logs",
					taskId: "session-with-logs",
				}),
			)

			expect(vi.mocked(logs.info)).toHaveBeenCalledWith(
				"Switched to restored task",
				"SessionService",
				expect.objectContaining({
					sessionId: "session-with-logs",
				}),
			)
		})
	})

	describe("getGitState", () => {
		beforeEach(() => {
			// Override default git mocks with working ones for getGitState tests
			mockGit = {
				getRemotes: vi.fn(),
				revparse: vi.fn(),
				raw: vi.fn().mockImplementation((...args: unknown[]) => {
					// Return appropriate mock based on the git command
					const cmd = Array.isArray(args[0]) ? args[0] : args
					if (cmd[0] === "hash-object") {
						return Promise.resolve("4b825dc642cb6eb9a060e54bf8d69288fbee4904\n")
					}
					return Promise.resolve("")
				}),
				diff: vi.fn(),
			}

			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)
		})

		it("should handle first commit (no parent) by diffing against empty tree", async () => {
			// Mock git responses for first commit scenario
			vi.mocked(mockGit.getRemotes!).mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "https://github.com/user/repo.git",
					},
				},
			])
			vi.mocked(mockGit.revparse!).mockResolvedValue("abc123def456")
			// First commit scenario: diff HEAD returns empty, so check if it's first commit
			vi.mocked(mockGit.diff!).mockResolvedValueOnce("") // diff HEAD returns empty for first commit
			;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				if (cmd[0] === "ls-files") {
					return Promise.resolve("") // No untracked files
				}
				if (cmd[0] === "rev-list") {
					return Promise.resolve("abc123def456\n") // Single SHA (no parent)
				}
				if (cmd[0] === "hash-object") {
					return Promise.resolve("4b825dc642cb6eb9a060e54bf8d69288fbee4904\n")
				}
				return Promise.resolve("")
			})
			vi.mocked(mockGit.diff!).mockResolvedValueOnce("diff --git a/file.txt b/file.txt\nnew file mode 100644") // diff against empty tree

			service.setWorkspaceDirectory("/test/repo")

			// @ts-expect-error - Testing private method
			const result = await service.getGitState()

			expect(result).toEqual({
				repoUrl: "https://github.com/user/repo.git",
				head: "abc123def456",
				branch: "main",
				patch: "diff --git a/file.txt b/file.txt\nnew file mode 100644",
			})

			// Verify correct git commands were called
			expect(mockGit.getRemotes).toHaveBeenCalledWith(true)
			expect(mockGit.revparse).toHaveBeenCalledWith(["HEAD"])
			// First tries diff HEAD
			expect(mockGit.diff).toHaveBeenCalledWith(["HEAD"])
			// Then checks if it's first commit
			expect(mockGit.raw).toHaveBeenCalledWith(["rev-list", "--parents", "-n", "1", "HEAD"])
			// Then falls back to empty tree
			expect(mockGit.raw).toHaveBeenCalledWith(["hash-object", "-t", "tree", "/dev/null"])
			expect(mockGit.diff).toHaveBeenCalledWith(["4b825dc642cb6eb9a060e54bf8d69288fbee4904", "HEAD"])
		})

		it("should handle regular commit (has parent) by diffing HEAD", async () => {
			// Mock git responses for regular commit scenario
			vi.mocked(mockGit.getRemotes!).mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "https://github.com/user/repo.git",
					},
				},
			])
			vi.mocked(mockGit.revparse!).mockResolvedValue("def456abc789")
			;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/feature-branch")
				}
				if (cmd[0] === "ls-files") {
					return Promise.resolve("") // No untracked files
				}
				return Promise.resolve("")
			})
			// Regular commit: diff HEAD returns the patch directly
			vi.mocked(mockGit.diff!).mockResolvedValue("diff --git a/file.txt b/file.txt\nindex 123..456")

			service.setWorkspaceDirectory("/test/repo")

			// @ts-expect-error - Testing private method
			const result = await service.getGitState()

			expect(result).toEqual({
				repoUrl: "https://github.com/user/repo.git",
				head: "def456abc789",
				branch: "feature-branch",
				patch: "diff --git a/file.txt b/file.txt\nindex 123..456",
			})

			// Verify correct git commands were called
			expect(mockGit.getRemotes).toHaveBeenCalledWith(true)
			expect(mockGit.revparse).toHaveBeenCalledWith(["HEAD"])
			// Regular commit should diff HEAD for uncommitted changes
			expect(mockGit.diff).toHaveBeenCalledWith(["HEAD"])
		})

		it("should handle commit with no uncommitted changes", async () => {
			// Mock git responses for commit with no changes scenario
			vi.mocked(mockGit.getRemotes!).mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "",
					},
				} as RemoteWithRefs,
			])
			vi.mocked(mockGit.revparse!).mockResolvedValue("merge123abc456")
			;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				if (cmd[0] === "ls-files") {
					return Promise.resolve("") // No untracked files
				}
				if (cmd[0] === "rev-list") {
					return Promise.resolve("merge123abc456 parent123abc\n") // Has parent (not first commit)
				}
				return Promise.resolve("")
			})
			// No uncommitted changes: diff HEAD returns empty, but we're not on first commit
			vi.mocked(mockGit.diff!).mockResolvedValueOnce("") // diff HEAD returns empty

			service.setWorkspaceDirectory("/test/repo")

			// @ts-expect-error - Testing private method
			const result = await service.getGitState()

			expect(result).toEqual({
				repoUrl: "https://github.com/user/repo.git",
				head: "merge123abc456",
				branch: "main",
				patch: "",
			})

			// Should try diff HEAD first
			expect(mockGit.diff).toHaveBeenCalledWith(["HEAD"])
			// Should check if it's first commit
			expect(mockGit.raw).toHaveBeenCalledWith(["rev-list", "--parents", "-n", "1", "HEAD"])
			// Should NOT fall back to empty tree since it's not first commit
			expect(mockGit.raw).not.toHaveBeenCalledWith(["hash-object", "-t", "tree", "/dev/null"])
		})

		it("should use push URL when fetch URL is not available", async () => {
			vi.mocked(mockGit.getRemotes!).mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "",
						push: "https://github.com/user/repo.git",
					},
				} as RemoteWithRefs,
			])
			vi.mocked(mockGit.revparse!).mockResolvedValue("abc123")
			;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				if (cmd[0] === "ls-files") {
					return Promise.resolve("")
				}
				return Promise.resolve("")
			})
			vi.mocked(mockGit.diff!).mockResolvedValue("some diff")

			service.setWorkspaceDirectory("/test/repo")

			// @ts-expect-error - Testing private method
			const result = await service.getGitState()

			expect(result.repoUrl).toBe("https://github.com/user/repo.git")
		})

		it("should return undefined repoUrl when no remotes configured", async () => {
			vi.mocked(mockGit.getRemotes!).mockResolvedValue([])
			vi.mocked(mockGit.revparse!).mockResolvedValue("abc123")
			;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				if (cmd[0] === "ls-files") {
					return Promise.resolve("")
				}
				return Promise.resolve("")
			})
			vi.mocked(mockGit.diff!).mockResolvedValue("some diff")

			service.setWorkspaceDirectory("/test/repo")

			// @ts-expect-error - Testing private method
			const result = await service.getGitState()

			expect(result.repoUrl).toBeUndefined()
			expect(result.head).toBe("abc123")
		})

		it("should handle first commit with changes by using empty tree fallback", async () => {
			vi.mocked(mockGit.getRemotes!).mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "",
					},
				} as RemoteWithRefs,
			])
			vi.mocked(mockGit.revparse!).mockResolvedValue("firstcommit123")
			;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				if (cmd[0] === "ls-files") {
					return Promise.resolve("") // No untracked files
				}
				if (cmd[0] === "rev-list") {
					return Promise.resolve("firstcommit123\n") // Single SHA (no parent)
				}
				if (cmd[0] === "hash-object") {
					return Promise.resolve("4b825dc642cb6eb9a060e54bf8d69288fbee4904\n")
				}
				return Promise.resolve("")
			})
			// First commit: diff HEAD returns empty (no parent), check first commit, then fallback generates patch
			vi.mocked(mockGit.diff!).mockResolvedValueOnce("") // diff HEAD returns empty
			vi.mocked(mockGit.diff!).mockResolvedValueOnce("diff --git a/initial.txt b/initial.txt\nnew file") // diff against empty tree

			service.setWorkspaceDirectory("/test/repo")

			// @ts-expect-error - Testing private method
			const result = await service.getGitState()

			expect(result.patch).toBe("diff --git a/initial.txt b/initial.txt\nnew file")
			// Should try HEAD first
			expect(mockGit.diff).toHaveBeenCalledWith(["HEAD"])
			// Should check if it's first commit
			expect(mockGit.raw).toHaveBeenCalledWith(["rev-list", "--parents", "-n", "1", "HEAD"])
			// Then use empty tree
			expect(mockGit.raw).toHaveBeenCalledWith(["hash-object", "-t", "tree", "/dev/null"])
			expect(mockGit.diff).toHaveBeenCalledWith(["4b825dc642cb6eb9a060e54bf8d69288fbee4904", "HEAD"])
		})

		it("should use process.cwd() when workspace directory not set", async () => {
			vi.mocked(mockGit.getRemotes!).mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "",
					},
				} as RemoteWithRefs,
			])
			vi.mocked(mockGit.revparse!).mockResolvedValue("abc123")
			vi.mocked(mockGit.diff!).mockResolvedValue("some diff")
			;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "ls-files") {
					return Promise.resolve("")
				}
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				return Promise.resolve("")
			})

			// @ts-expect-error - Testing private method
			const result = await service.getGitState()

			expect(result).toBeDefined()
			// Verify simple-git was called (it would use process.cwd())
			expect(simpleGit).toHaveBeenCalled()
		})

		describe("untracked files handling", () => {
			it("should include untracked files in the patch", async () => {
				vi.mocked(mockGit.getRemotes!).mockResolvedValue([
					{
						name: "origin",
						refs: {
							fetch: "https://github.com/user/repo.git",
							push: "",
						},
					} as RemoteWithRefs,
				])
				vi.mocked(mockGit.revparse!).mockResolvedValue("abc123def456")

				// Track the order of git.raw calls
				const rawCalls: unknown[][] = []
				;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
					const cmd = Array.isArray(args[0]) ? args[0] : args
					rawCalls.push(cmd as unknown[])
					if (cmd[0] === "ls-files" && cmd[1] === "--others") {
						// Return untracked files
						return Promise.resolve("new-file.txt\nanother-new-file.js\n")
					}
					if (cmd[0] === "add" && cmd[1] === "--intent-to-add") {
						return Promise.resolve("")
					}
					if (cmd[0] === "reset") {
						return Promise.resolve("")
					}
					if (cmd[0] === "symbolic-ref") {
						return Promise.resolve("refs/heads/main")
					}
					return Promise.resolve("")
				})

				// Diff includes the untracked files after intent-to-add
				vi.mocked(mockGit.diff!).mockResolvedValue(
					"diff --git a/new-file.txt b/new-file.txt\nnew file mode 100644\n+content",
				)

				service.setWorkspaceDirectory("/test/repo")

				// @ts-expect-error - Testing private method
				const result = await service.getGitState()

				// Verify untracked files were fetched
				expect(mockGit.raw).toHaveBeenCalledWith(["ls-files", "--others", "--exclude-standard"])

				// Verify intent-to-add was called with the untracked files
				expect(mockGit.raw).toHaveBeenCalledWith([
					"add",
					"--intent-to-add",
					"--",
					"new-file.txt",
					"another-new-file.js",
				])

				// Verify the patch includes the untracked file content
				expect(result.patch).toContain("new-file.txt")
			})

			it("should restore repository state after getGitState completes", async () => {
				vi.mocked(mockGit.getRemotes!).mockResolvedValue([
					{
						name: "origin",
						refs: {
							fetch: "https://github.com/user/repo.git",
							push: "",
						},
					} as RemoteWithRefs,
				])
				vi.mocked(mockGit.revparse!).mockResolvedValue("abc123def456")

				const rawCalls: unknown[][] = []
				;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
					const cmd = Array.isArray(args[0]) ? args[0] : args
					rawCalls.push(cmd as unknown[])
					if (cmd[0] === "ls-files" && cmd[1] === "--others") {
						return Promise.resolve("untracked.txt\n")
					}
					if (cmd[0] === "add" && cmd[1] === "--intent-to-add") {
						return Promise.resolve("")
					}
					if (cmd[0] === "reset") {
						return Promise.resolve("")
					}
					if (cmd[0] === "symbolic-ref") {
						return Promise.resolve("refs/heads/main")
					}
					return Promise.resolve("")
				})

				vi.mocked(mockGit.diff!).mockResolvedValue("diff content")

				service.setWorkspaceDirectory("/test/repo")

				// @ts-expect-error - Testing private method
				await service.getGitState()

				// Verify reset was called to restore the untracked state
				expect(mockGit.raw).toHaveBeenCalledWith(["reset", "HEAD", "--", "untracked.txt"])

				// Verify the order: ls-files -> add --intent-to-add -> ... -> reset
				const lsFilesIndex = rawCalls.findIndex((args) => args[0] === "ls-files")
				const addIndex = rawCalls.findIndex((args) => args[0] === "add" && args[1] === "--intent-to-add")
				const resetIndex = rawCalls.findIndex((args) => args[0] === "reset")

				expect(lsFilesIndex).toBeLessThan(addIndex)
				expect(addIndex).toBeLessThan(resetIndex)
			})

			it("should restore repository state even when diff throws an error", async () => {
				vi.mocked(mockGit.getRemotes!).mockResolvedValue([
					{
						name: "origin",
						refs: {
							fetch: "https://github.com/user/repo.git",
							push: "",
						},
					} as RemoteWithRefs,
				])
				vi.mocked(mockGit.revparse!).mockResolvedValue("abc123def456")
				;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
					const cmd = Array.isArray(args[0]) ? args[0] : args
					if (cmd[0] === "ls-files" && cmd[1] === "--others") {
						return Promise.resolve("untracked-file.txt\n")
					}
					if (cmd[0] === "add" && cmd[1] === "--intent-to-add") {
						return Promise.resolve("")
					}
					if (cmd[0] === "reset") {
						return Promise.resolve("")
					}
					if (cmd[0] === "symbolic-ref") {
						return Promise.resolve("refs/heads/main")
					}
					return Promise.resolve("")
				})

				// Make diff throw an error
				vi.mocked(mockGit.diff!).mockRejectedValue(new Error("Diff failed"))

				service.setWorkspaceDirectory("/test/repo")

				// @ts-expect-error - Testing private method
				await expect(service.getGitState()).rejects.toThrow("Diff failed")

				// Verify reset was still called in the finally block
				expect(mockGit.raw).toHaveBeenCalledWith(["reset", "HEAD", "--", "untracked-file.txt"])
			})

			it("should handle empty untracked files list without errors", async () => {
				vi.mocked(mockGit.getRemotes!).mockResolvedValue([
					{
						name: "origin",
						refs: {
							fetch: "https://github.com/user/repo.git",
							push: "",
						},
					} as RemoteWithRefs,
				])
				vi.mocked(mockGit.revparse!).mockResolvedValue("abc123def456")
				;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
					const cmd = Array.isArray(args[0]) ? args[0] : args
					if (cmd[0] === "ls-files" && cmd[1] === "--others") {
						// No untracked files
						return Promise.resolve("")
					}
					if (cmd[0] === "symbolic-ref") {
						return Promise.resolve("refs/heads/main")
					}
					return Promise.resolve("")
				})

				vi.mocked(mockGit.diff!).mockResolvedValue("diff --git a/tracked.txt b/tracked.txt\nmodified content")

				service.setWorkspaceDirectory("/test/repo")

				// @ts-expect-error - Testing private method
				const result = await service.getGitState()

				// Should not call add --intent-to-add when there are no untracked files
				expect(mockGit.raw).not.toHaveBeenCalledWith(expect.arrayContaining(["add", "--intent-to-add"]))

				// Should not call reset when there are no untracked files
				expect(mockGit.raw).not.toHaveBeenCalledWith(expect.arrayContaining(["reset", "HEAD"]))

				// Should still return the diff for tracked files
				expect(result.patch).toContain("tracked.txt")
			})

			it("should exclude ignored files from untracked files list", async () => {
				vi.mocked(mockGit.getRemotes!).mockResolvedValue([
					{
						name: "origin",
						refs: {
							fetch: "https://github.com/user/repo.git",
							push: "",
						},
					} as RemoteWithRefs,
				])
				vi.mocked(mockGit.revparse!).mockResolvedValue("abc123def456")
				;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
					const cmd = Array.isArray(args[0]) ? args[0] : args
					if (cmd[0] === "ls-files" && cmd[1] === "--others" && cmd[2] === "--exclude-standard") {
						// --exclude-standard flag ensures .gitignore patterns are respected
						// Only return files that are NOT in .gitignore
						return Promise.resolve("valid-untracked.txt\n")
					}
					if (cmd[0] === "add" && cmd[1] === "--intent-to-add") {
						return Promise.resolve("")
					}
					if (cmd[0] === "reset") {
						return Promise.resolve("")
					}
					if (cmd[0] === "symbolic-ref") {
						return Promise.resolve("refs/heads/main")
					}
					return Promise.resolve("")
				})

				vi.mocked(mockGit.diff!).mockResolvedValue("diff content with valid-untracked.txt")

				service.setWorkspaceDirectory("/test/repo")

				// @ts-expect-error - Testing private method
				await service.getGitState()

				// Verify ls-files was called with --exclude-standard to respect .gitignore
				expect(mockGit.raw).toHaveBeenCalledWith(["ls-files", "--others", "--exclude-standard"])

				// Verify only the non-ignored file was added with intent-to-add
				expect(mockGit.raw).toHaveBeenCalledWith(["add", "--intent-to-add", "--", "valid-untracked.txt"])

				// Verify ignored files like node_modules/* are NOT included
				expect(mockGit.raw).not.toHaveBeenCalledWith(
					expect.arrayContaining(["add", "--intent-to-add", "--", expect.stringContaining("node_modules")]),
				)
			})

			it("should handle multiple untracked files correctly", async () => {
				vi.mocked(mockGit.getRemotes!).mockResolvedValue([
					{
						name: "origin",
						refs: {
							fetch: "https://github.com/user/repo.git",
							push: "",
						},
					} as RemoteWithRefs,
				])
				vi.mocked(mockGit.revparse!).mockResolvedValue("abc123def456")

				const untrackedFiles = ["file1.txt", "src/file2.js", "docs/readme.md"]

				;(mockGit.raw as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
					const cmd = Array.isArray(args[0]) ? args[0] : args
					if (cmd[0] === "ls-files" && cmd[1] === "--others") {
						return Promise.resolve(untrackedFiles.join("\n") + "\n")
					}
					if (cmd[0] === "add" && cmd[1] === "--intent-to-add") {
						return Promise.resolve("")
					}
					if (cmd[0] === "reset") {
						return Promise.resolve("")
					}
					if (cmd[0] === "symbolic-ref") {
						return Promise.resolve("refs/heads/main")
					}
					return Promise.resolve("")
				})

				vi.mocked(mockGit.diff!).mockResolvedValue("diff with multiple files")

				service.setWorkspaceDirectory("/test/repo")

				// @ts-expect-error - Testing private method
				await service.getGitState()

				// Verify all untracked files were added with intent-to-add
				expect(mockGit.raw).toHaveBeenCalledWith([
					"add",
					"--intent-to-add",
					"--",
					"file1.txt",
					"src/file2.js",
					"docs/readme.md",
				])

				// Verify all untracked files were reset
				expect(mockGit.raw).toHaveBeenCalledWith([
					"reset",
					"HEAD",
					"--",
					"file1.txt",
					"src/file2.js",
					"docs/readme.md",
				])
			})
		})
	})

	describe("renameSession", () => {
		it("should rename session successfully", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// Create a session first
			mockCreate.mockResolvedValueOnce({
				session_id: "session-to-rename",
				title: "Original Title",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			// Wait for session creation
			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(service.sessionId).toBe("session-to-rename")

			// Now rename the session
			mockUpdate.mockResolvedValueOnce({
				session_id: "session-to-rename",
				title: "New Title",
				updated_at: "2025-01-01T00:01:00Z",
			})

			await service.renameSession("New Title")

			expect(mockUpdate).toHaveBeenCalledWith({
				session_id: "session-to-rename",
				title: "New Title",
			})

			expect(vi.mocked(logs.info)).toHaveBeenCalledWith(
				"Session renamed successfully",
				"SessionService",
				expect.objectContaining({
					sessionId: "session-to-rename",
					newTitle: "New Title",
				}),
			)
		})

		it("should throw error when no active session", async () => {
			// No session created, sessionId is null
			expect(service.sessionId).toBeNull()

			await expect(service.renameSession("New Title")).rejects.toThrow("No active session")

			expect(mockUpdate).not.toHaveBeenCalled()
		})

		it("should throw error when title is empty", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// Create a session first
			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "Original Title",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			await expect(service.renameSession("")).rejects.toThrow("Session title cannot be empty")

			expect(mockUpdate).not.toHaveBeenCalled()
		})

		it("should throw error when title is only whitespace", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// Create a session first
			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "Original Title",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			await expect(service.renameSession("   ")).rejects.toThrow("Session title cannot be empty")

			expect(mockUpdate).not.toHaveBeenCalled()
		})

		it("should trim whitespace from title", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// Create a session first
			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "Original Title",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			mockUpdate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "Trimmed Title",
				updated_at: "2025-01-01T00:01:00Z",
			})

			await service.renameSession("  Trimmed Title  ")

			expect(mockUpdate).toHaveBeenCalledWith({
				session_id: "session-id",
				title: "Trimmed Title",
			})
		})

		it("should propagate backend errors", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// Create a session first
			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "Original Title",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			mockUpdate.mockRejectedValueOnce(new Error("Network error"))

			await expect(service.renameSession("New Title")).rejects.toThrow("Network error")
		})

		it("should update local sessionTitle after successful rename", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// Create a session first
			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "Original Title",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			mockUpdate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "New Title",
				updated_at: "2025-01-01T00:01:00Z",
			})

			await service.renameSession("New Title")

			// @ts-expect-error - Accessing private property for testing
			expect(service.sessionTitle).toBe("New Title")
		})
	})

	describe("generateTitle", () => {
		describe("short messages (≤140 chars)", () => {
			it("should return short message directly without LLM call", async () => {
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: "Help me write a function to calculate fibonacci numbers",
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBe("Help me write a function to calculate fibonacci numbers")
				expect(mockRequestSingleCompletion).not.toHaveBeenCalled()
			})

			it("should trim and collapse whitespace for short messages", async () => {
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: "   Hello    world   ",
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBe("Hello world")
				expect(mockRequestSingleCompletion).not.toHaveBeenCalled()
			})

			it("should replace newlines with spaces for short messages", async () => {
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: "Hello\nworld\ntest",
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBe("Hello world test")
			})
		})

		describe("long messages (>140 chars)", () => {
			it("should use LLM to summarize long messages", async () => {
				mockRequestSingleCompletion.mockResolvedValue("Summarized title from LLM")

				const longText = "a".repeat(200)
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: longText,
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBe("Summarized title from LLM")
				expect(mockRequestSingleCompletion).toHaveBeenCalledTimes(1)
				expect(mockRequestSingleCompletion).toHaveBeenCalledWith(
					expect.stringContaining("Summarize the following user request"),
					30000,
				)
			})

			it("should truncate LLM response if still too long", async () => {
				mockRequestSingleCompletion.mockResolvedValue("b".repeat(200))

				const longText = "a".repeat(200)
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: longText,
					},
				]

				const title = await service.generateTitle(messages)

				expect(title!.length).toBeLessThanOrEqual(140)
				expect(title).toMatch(/\.\.\.$/i)
			})

			it("should remove quotes from LLM response", async () => {
				mockRequestSingleCompletion.mockResolvedValue('"Quoted summary"')

				const longText = "a".repeat(200)
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: longText,
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBe("Quoted summary")
			})

			it("should fallback to truncation when LLM fails", async () => {
				mockRequestSingleCompletion.mockRejectedValue(new Error("LLM error"))

				const longText = "a".repeat(200)
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: longText,
					},
				]

				const title = await service.generateTitle(messages)

				expect(title!.length).toBeLessThanOrEqual(140)
				expect(title).toMatch(/\.\.\.$/i)
				expect(title).toContain("a".repeat(137))
			})
		})

		describe("edge cases", () => {
			it("should return null for empty array", async () => {
				const title = await service.generateTitle([])

				expect(title).toBeNull()
			})

			it("should return null when no messages have text", async () => {
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "say",
						say: "api_req_started",
					},
					{
						ts: Date.now(),
						type: "ask",
						ask: "command",
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBeNull()
			})

			it("should return null when user message has empty text", async () => {
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: "",
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBeNull()
			})

			it("should return null when user message has only whitespace", async () => {
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: "   \n\t  ",
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBeNull()
			})

			it("should skip messages without text and find next valid message", async () => {
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
					},
					{
						ts: Date.now(),
						type: "say",
						say: "user_feedback",
						text: "Valid user message",
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBe("Valid user message")
			})
		})

		describe("message type behavior", () => {
			it("should extract from any message type with text (first message wins)", async () => {
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "say",
						say: "text",
						text: "First message with text",
					},
					{
						ts: Date.now(),
						type: "ask",
						ask: "followup",
						text: "Second message",
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBe("First message with text")
			})

			it("should extract from command ask if it has text", async () => {
				const messages: ClineMessage[] = [
					{
						ts: Date.now(),
						type: "ask",
						ask: "command",
						text: "npm install",
					},
				]

				const title = await service.generateTitle(messages)

				expect(title).toBe("npm install")
			})
		})
	})

	describe("logging", () => {
		it("should log debug messages for successful operations", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			mockCreate.mockResolvedValueOnce({
				session_id: "new-session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(vi.mocked(logs.debug)).toHaveBeenCalledWith("Creating new session", "SessionService")
			expect(vi.mocked(logs.info)).toHaveBeenCalledWith(
				"Session created successfully",
				"SessionService",
				expect.objectContaining({
					sessionId: "new-session-id",
				}),
			)
		})

		it("should log debug messages for updates", async () => {
			const mockData = { messages: [] }
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

			// Set up git mocks for first sync
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/repo.git",
						push: "https://github.com/user/repo.git",
					},
				},
			])
			mockGit.revparse = vi.fn().mockResolvedValue("abc123")
			mockGit.raw = vi.fn().mockImplementation((...args: unknown[]) => {
				const cmd = Array.isArray(args[0]) ? args[0] : args
				if (cmd[0] === "ls-files") {
					return Promise.resolve("")
				}
				if (cmd[0] === "symbolic-ref") {
					return Promise.resolve("refs/heads/main")
				}
				return Promise.resolve("")
			})
			mockGit.diff = vi.fn().mockResolvedValue("some diff")

			mockCreate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			vi.clearAllMocks()

			// Change git URL to trigger update
			mockGit.getRemotes = vi.fn().mockResolvedValue([
				{
					name: "origin",
					refs: {
						fetch: "https://github.com/user/new-repo.git",
						push: "https://github.com/user/new-repo.git",
					},
				},
			])

			mockUpdate.mockResolvedValueOnce({
				session_id: "session-id",
				title: "",
				updated_at: "2025-01-01T00:01:00Z",
			})

			service.setPath("apiConversationHistoryPath", "/path/to/api.json")

			await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

			expect(vi.mocked(logs.debug)).toHaveBeenCalledWith(
				"Updating existing session",
				"SessionService",
				expect.objectContaining({
					sessionId: "session-id",
				}),
			)
			expect(vi.mocked(logs.debug)).toHaveBeenCalledWith(
				"Session updated successfully",
				"SessionService",
				expect.objectContaining({
					sessionId: "session-id",
				}),
			)
		})

		it("should log during destroy", async () => {
			await service.destroy()

			expect(vi.mocked(logs.debug)).toHaveBeenCalledWith(
				"Destroying SessionService",
				"SessionService",
				expect.objectContaining({
					sessionId: null,
				}),
			)
			expect(vi.mocked(logs.debug)).toHaveBeenCalledWith("SessionService flushed", "SessionService")
		})
	})

	describe("restoreLastSession", () => {
		beforeEach(() => {
			vi.clearAllMocks()
			global.fetch = vi.fn()
		})

		it("should return false when no last session ID exists", async () => {
			service.setWorkspaceDirectory("/test/workspace")
			vi.mocked(existsSync).mockReturnValueOnce(false)

			const result = await service.restoreLastSession()

			expect(result).toBe(false)
			expect(vi.mocked(logs.debug)).toHaveBeenCalledWith("No persisted session ID found", "SessionService")
		})

		it("should return true when session is restored successfully", async () => {
			service.setWorkspaceDirectory("/test/workspace")

			const sessionData = {
				sessionId: "saved-session-id",
				timestamp: Date.now(),
			}

			vi.mocked(existsSync).mockReturnValueOnce(true)
			vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(sessionData))

			const mockSessionData = {
				session_id: "saved-session-id",
				title: "Saved Session",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			}

			mockGet.mockResolvedValueOnce(mockSessionData)

			const result = await service.restoreLastSession()

			expect(result).toBe(true)
			expect(vi.mocked(logs.info)).toHaveBeenCalledWith(
				"Found persisted session ID, attempting to restore",
				"SessionService",
				expect.objectContaining({
					sessionId: "saved-session-id",
				}),
			)
			expect(vi.mocked(logs.info)).toHaveBeenCalledWith(
				"Successfully restored persisted session",
				"SessionService",
				expect.objectContaining({
					sessionId: "saved-session-id",
				}),
			)
		})

		it("should return false when restoration fails", async () => {
			service.setWorkspaceDirectory("/test/workspace")

			const sessionData = {
				sessionId: "invalid-session-id",
				timestamp: Date.now(),
			}

			vi.mocked(existsSync).mockReturnValueOnce(true)
			vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(sessionData))

			mockGet.mockRejectedValueOnce(new Error("Session not found"))

			const result = await service.restoreLastSession()

			expect(result).toBe(false)
			expect(vi.mocked(logs.warn)).toHaveBeenCalledWith(
				"Failed to restore persisted session",
				"SessionService",
				expect.objectContaining({
					error: "Session not found",
					sessionId: "invalid-session-id",
				}),
			)
		})
	})

	describe("session persistence", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		describe("saveLastSessionId", () => {
			it("should save session ID to workspace-specific file", async () => {
				service.setWorkspaceDirectory("/test/workspace")

				const mockData = { messages: [] }
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

				mockCreate.mockResolvedValueOnce({
					session_id: "test-session-id",
					title: "",
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
				})

				service.setPath("apiConversationHistoryPath", "/path/to/api.json")

				await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

				const writeCall = vi
					.mocked(writeFileSync)
					.mock.calls.find((call) => call[0] === "/mock/workspace//test/workspace/last-session.json")
				expect(writeCall).toBeDefined()
				const writtenData = JSON.parse(writeCall![1] as string)
				expect(writtenData.sessionId).toBe("test-session-id")
				expect(writtenData.timestamp).toBeTypeOf("number")
			})

			it("should not save when workspace directory is not set", async () => {
				const mockData = { messages: [] }
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

				mockCreate.mockResolvedValueOnce({
					session_id: "test-session-id",
					title: "",
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
				})

				service.setPath("apiConversationHistoryPath", "/path/to/api.json")

				await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

				expect(vi.mocked(logs.warn)).toHaveBeenCalledWith(
					"Cannot save last session ID: workspace directory not set",
					"SessionService",
				)
			})

			it("should save session ID when restoring a session", async () => {
				service.setWorkspaceDirectory("/test/workspace")

				const mockSessionData = {
					session_id: "restored-session-id",
					title: "Restored Session",
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
					api_conversation_history_blob_url: null,
					ui_messages_blob_url: null,
					task_metadata_blob_url: null,
				}

				mockGet.mockResolvedValueOnce(mockSessionData)

				await service.restoreSession("restored-session-id")

				const writeCall = vi
					.mocked(writeFileSync)
					.mock.calls.find((call) => call[0] === "/mock/workspace//test/workspace/last-session.json")
				expect(writeCall).toBeDefined()
				const writtenData = JSON.parse(writeCall![1] as string)
				expect(writtenData.sessionId).toBe("restored-session-id")
				expect(writtenData.timestamp).toBeTypeOf("number")
			})

			it("should handle write errors gracefully", async () => {
				service.setWorkspaceDirectory("/test/workspace")

				const mockData = { messages: [] }
				vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockData))

				vi.mocked(writeFileSync).mockImplementationOnce(() => {
					throw new Error("Write failed")
				})

				mockCreate.mockResolvedValueOnce({
					session_id: "test-session-id",
					title: "",
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
				})

				service.setPath("apiConversationHistoryPath", "/path/to/api.json")

				await vi.advanceTimersByTimeAsync(SessionService.SYNC_INTERVAL)

				expect(vi.mocked(logs.warn)).toHaveBeenCalledWith(
					"Failed to save last session ID",
					"SessionService",
					expect.objectContaining({
						error: "Write failed",
					}),
				)
			})
		})
	})
})

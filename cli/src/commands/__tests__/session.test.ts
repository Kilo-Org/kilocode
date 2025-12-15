/**
 * Tests for the /session command
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { sessionCommand } from "../session.js"
import type { CommandContext, ArgumentProviderContext, ArgumentSuggestion } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"
import { SessionManager } from "../../../../src/shared/kilocode/cli-sessions/core/SessionManager.js"
import { SessionClient } from "../../../../src/shared/kilocode/cli-sessions/core/SessionClient.js"

// Mock the SessionManager
vi.mock("../../../../src/shared/kilocode/cli-sessions/core/SessionManager.js", () => ({
	SessionManager: {
		init: vi.fn(),
	},
}))

// Mock the SessionClient
vi.mock("../../services/sessionClient.js", () => ({
	SessionClient: {
		getInstance: vi.fn(),
	},
	CliSessionSharedState: {
		Private: "private",
		Public: "public",
	},
}))

// Mock simple-git
vi.mock("simple-git", () => ({
	default: vi.fn(),
}))

describe("sessionCommand", () => {
	let mockContext: CommandContext
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let mockSessionManager: any // Use any to allow mocking the sessionId getter
	let mockSessionClient: Partial<SessionClient>

	beforeEach(() => {
		mockContext = createMockContext({
			input: "/session",
		})

		// Create a mock session client instance
		mockSessionClient = {
			list: vi.fn().mockResolvedValue({
				cliSessions: [],
				nextCursor: null,
			}),
			search: vi.fn().mockResolvedValue({
				results: [],
				total: 0,
				limit: 20,
				offset: 0,
			}),
			delete: vi.fn().mockResolvedValue({ success: true }),
		}

		// Create a mock session manager instance with sessionClient property
		mockSessionManager = {
			sessionId: null,
			restoreSession: vi.fn().mockResolvedValue(undefined),
			sessionClient: mockSessionClient as SessionClient,
			// Add facade methods that delegate to sessionClient
			listSessions: vi.fn().mockImplementation((input) => mockSessionClient.list?.(input)),
			searchSessions: vi.fn().mockImplementation((input) => mockSessionClient.search?.(input)),
			deleteSession: vi.fn().mockImplementation((input) => mockSessionClient.delete?.(input)),
		}

		// Mock SessionManager.init to return our mock instance
		vi.mocked(SessionManager.init).mockReturnValue(mockSessionManager as SessionManager)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("command metadata", () => {
		it("should have correct name", () => {
			expect(sessionCommand.name).toBe("session")
		})

		it("should have empty aliases array", () => {
			expect(sessionCommand.aliases).toEqual([])
		})

		it("should have correct category", () => {
			expect(sessionCommand.category).toBe("system")
		})

		it("should have correct priority", () => {
			expect(sessionCommand.priority).toBe(5)
		})

		it("should have description", () => {
			expect(sessionCommand.description).toBeTruthy()
			expect(sessionCommand.description).toContain("session")
		})

		it("should have usage examples", () => {
			expect(sessionCommand.examples).toHaveLength(8)
			expect(sessionCommand.examples).toContain("/session show")
			expect(sessionCommand.examples).toContain("/session list")
			expect(sessionCommand.examples).toContain("/session search <query>")
			expect(sessionCommand.examples).toContain("/session select <sessionId>")
			expect(sessionCommand.examples).toContain("/session share")
			expect(sessionCommand.examples).toContain("/session fork <id>")
			expect(sessionCommand.examples).toContain("/session delete <sessionId>")
			expect(sessionCommand.examples).toContain("/session rename <new name>")
		})

		it("should have subcommand argument defined", () => {
			expect(sessionCommand.arguments).toBeDefined()
			expect(sessionCommand.arguments).toHaveLength(2)
			expect(sessionCommand.arguments![0].name).toBe("subcommand")
			expect(sessionCommand.arguments![0].required).toBe(false)
		})

		it("should have all subcommand values defined", () => {
			const subcommandArg = sessionCommand.arguments![0]
			expect(subcommandArg.values).toBeDefined()
			expect(subcommandArg.values).toHaveLength(8)
			expect(subcommandArg.values!.map((v) => v.value)).toEqual([
				"show",
				"list",
				"search",
				"select",
				"share",
				"fork",
				"delete",
				"rename",
			])
		})

		it("should have argument with conditional providers", () => {
			const argumentArg = sessionCommand.arguments![1]
			expect(argumentArg.name).toBe("argument")
			expect(argumentArg.required).toBe(false)
			expect(argumentArg.conditionalProviders).toBeDefined()
			expect(argumentArg.conditionalProviders).toHaveLength(1)

			// Check conditional provider exists
			expect(argumentArg.conditionalProviders![0].condition).toBeDefined()
			expect(argumentArg.conditionalProviders![0].provider).toBeDefined()
		})
	})

	describe("handler - no arguments", () => {
		it("should show usage message when called without arguments", async () => {
			mockContext.args = []

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Usage: /session")
			expect(message.content).toContain("show")
			expect(message.content).toContain("list")
			expect(message.content).toContain("search")
			expect(message.content).toContain("select")
			expect(message.content).toContain("share")
			expect(message.content).toContain("fork")
			expect(message.content).toContain("delete")
			expect(message.content).toContain("rename")
		})

		it("should not call SessionManager when showing usage", async () => {
			mockContext.args = []

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).not.toHaveBeenCalled()
		})
	})

	describe("handler - show subcommand", () => {
		it("should display session ID when session exists", async () => {
			const testSessionId = "test-session-123"
			mockSessionManager.sessionId = testSessionId
			mockContext.args = ["show"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalledTimes(1)
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Current Session ID")
			expect(message.content).toContain(testSessionId)
		})

		it("should display message when no session exists", async () => {
			mockSessionManager.sessionId = null
			mockContext.args = ["show"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalledTimes(1)
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("No active session")
		})

		it("should handle 'show' subcommand case-insensitively", async () => {
			mockSessionManager.sessionId = "test-id"
			mockContext.args = ["SHOW"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalledTimes(1)
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
		})
	})

	describe("handler - list subcommand", () => {
		it("should display empty sessions list", async () => {
			mockSessionClient.list = vi.fn().mockResolvedValue({
				cliSessions: [],
				nextCursor: null,
			})
			mockContext.args = ["list"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalled()
			expect(mockSessionClient.list).toHaveBeenCalledWith({ limit: 50 })
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("No sessions found")
		})

		it("should display sessions list with results", async () => {
			const mockSessions = [
				{
					session_id: "session-1",
					title: "Test Session 1",
					created_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
					updated_at: new Date().toISOString(),
				},
				{
					session_id: "session-2",
					title: "Test Session 2",
					created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
					updated_at: new Date().toISOString(),
				},
			]

			mockSessionClient.list = vi.fn().mockResolvedValue({
				cliSessions: mockSessions,
				nextCursor: null,
			})
			mockContext.args = ["list"]

			await sessionCommand.handler(mockContext)

			expect(mockSessionClient.list).toHaveBeenCalledWith({ limit: 50 })
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Available Sessions")
			expect(message.content).toContain("Test Session 1")
			expect(message.content).toContain("Test Session 2")
			expect(message.content).toContain("session-1")
			expect(message.content).toContain("session-2")
		})

		it("should indicate active session in list", async () => {
			mockSessionManager.sessionId = "session-active"
			const mockSessions = [
				{
					session_id: "session-active",
					title: "Active Session",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				},
				{
					session_id: "session-inactive",
					title: "Inactive Session",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				},
			]

			mockSessionClient.list = vi.fn().mockResolvedValue({
				cliSessions: mockSessions,
				nextCursor: null,
			})
			mockContext.args = ["list"]

			await sessionCommand.handler(mockContext)

			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.content).toContain("* [Active]")
		})

		it("should display pagination cursor when available", async () => {
			const mockSessions = Array.from({ length: 50 }, (_, i) => ({
				session_id: `session-${i}`,
				title: `Session ${i}`,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			}))

			mockSessionClient.list = vi.fn().mockResolvedValue({
				cliSessions: mockSessions,
				nextCursor: "cursor-next",
			})
			mockContext.args = ["list"]

			await sessionCommand.handler(mockContext)

			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.content).toContain("Showing first 50 sessions. More available.")
		})

		it("should handle list error gracefully", async () => {
			mockSessionClient.list = vi.fn().mockRejectedValue(new Error("Network error"))
			mockContext.args = ["list"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to list sessions")
			expect(message.content).toContain("Network error")
		})

		it("should format relative time correctly", async () => {
			const mockSessions = [
				{
					session_id: "session-1",
					title: "Just created",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				},
			]

			mockSessionClient.list = vi.fn().mockResolvedValue({
				cliSessions: mockSessions,
				nextCursor: null,
			})
			mockContext.args = ["list"]

			await sessionCommand.handler(mockContext)

			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.content).toContain("just now")
		})
	})

	describe("handler - select subcommand", () => {
		it("should restore session successfully", async () => {
			mockContext.args = ["select", "session-123"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalled()
			expect(mockContext.replaceMessages).toHaveBeenCalledTimes(1)
			expect(mockContext.refreshTerminal).toHaveBeenCalled()
			expect(mockSessionManager.restoreSession).toHaveBeenCalledWith("session-123", true)

			const replacedMessages = (mockContext.replaceMessages as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(replacedMessages).toHaveLength(2)
			expect(replacedMessages[1].content).toContain("Restoring session")
			expect(replacedMessages[1].content).toContain("session-123")
		})

		it("should show error when sessionId is missing", async () => {
			mockContext.args = ["select"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /session select <sessionId>")
			expect(mockSessionManager.restoreSession).not.toHaveBeenCalled()
		})

		it("should show error when sessionId is empty string", async () => {
			mockContext.args = ["select", ""]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /session select <sessionId>")
		})

		it("should handle restore error gracefully", async () => {
			mockSessionManager.restoreSession = vi.fn().mockRejectedValue(new Error("Session not found"))
			mockContext.args = ["select", "invalid-session"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalled()
			const errorMessage = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls.find(
				(call) => call[0].type === "error",
			)
			expect(errorMessage).toBeDefined()
			if (errorMessage) {
				expect(errorMessage[0].content).toContain("Failed to restore session")
				expect(errorMessage[0].content).toContain("Session not found")
			}
		})

		it("should handle 'select' subcommand case-insensitively", async () => {
			mockContext.args = ["SELECT", "session-123"]

			await sessionCommand.handler(mockContext)

			expect(mockSessionManager.restoreSession).toHaveBeenCalledWith("session-123", true)
		})
	})

	describe("handler - share subcommand", () => {
		beforeEach(() => {
			// Setup shareSession mock on manager
			mockSessionManager.shareSession = vi.fn().mockResolvedValue({
				share_id: "share-123",
				session_id: "test-session-123",
			})
		})

		it("should share current session", async () => {
			mockSessionManager.sessionId = "test-session-123"
			mockContext.args = ["share"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalled()
			expect(mockSessionManager.shareSession).toHaveBeenCalled()

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Session shared successfully")
			expect(message.content).toContain("share-123")
		})

		it("should handle share error gracefully", async () => {
			mockSessionManager.sessionId = "test-session-123"
			mockSessionManager.shareSession = vi.fn().mockRejectedValue(new Error("Not in a git repository"))
			mockContext.args = ["share"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to share session")
			expect(message.content).toContain("Not in a git repository")
		})
	})

	describe("handler - search subcommand", () => {
		it("should search sessions and display results", async () => {
			const mockSearchResults = [
				{
					session_id: "session-search-1",
					title: "Search Result 1",
					created_at: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
					updated_at: new Date().toISOString(),
				},
				{
					session_id: "session-search-2",
					title: "Search Result 2",
					created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
					updated_at: new Date().toISOString(),
				},
			]

			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: mockSearchResults,
				total: 2,
				limit: 20,
				offset: 0,
			})
			mockContext.args = ["search", "test-query"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalled()
			expect(mockSessionClient.search).toHaveBeenCalledWith({ search_string: "test-query", limit: 20 })
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Search Results")
			expect(message.content).toContain("2 of 2")
			expect(message.content).toContain("Search Result 1")
			expect(message.content).toContain("Search Result 2")
			expect(message.content).toContain("session-search-1")
			expect(message.content).toContain("session-search-2")
		})

		it("should show error when query is missing", async () => {
			mockContext.args = ["search"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /session search <query>")
			expect(mockSessionClient.search).not.toHaveBeenCalled()
		})

		it("should show error when query is empty string", async () => {
			mockContext.args = ["search", ""]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /session search <query>")
		})

		it("should handle empty search results", async () => {
			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: [],
				total: 0,
				limit: 20,
				offset: 0,
			})
			mockContext.args = ["search", "nonexistent"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain('No sessions found matching "nonexistent"')
		})

		it("should indicate active session in search results", async () => {
			mockSessionManager.sessionId = "session-active"
			const mockSearchResults = [
				{
					session_id: "session-active",
					title: "Active Session",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				},
				{
					session_id: "session-inactive",
					title: "Inactive Session",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				},
			]

			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: mockSearchResults,
				total: 2,
				limit: 20,
				offset: 0,
			})
			mockContext.args = ["search", "query"]

			await sessionCommand.handler(mockContext)

			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.content).toContain("* [Active]")
		})

		it("should handle search error gracefully", async () => {
			mockSessionClient.search = vi.fn().mockRejectedValue(new Error("Database error"))
			mockContext.args = ["search", "test"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to search sessions")
			expect(message.content).toContain("Database error")
		})

		it("should handle 'search' subcommand case-insensitively", async () => {
			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: [],
				total: 0,
				limit: 20,
				offset: 0,
			})
			mockContext.args = ["SEARCH", "test"]

			await sessionCommand.handler(mockContext)

			expect(mockSessionClient.search).toHaveBeenCalledWith({ search_string: "test", limit: 20 })
		})
	})

	describe("handler - fork subcommand", () => {
		beforeEach(() => {
			// Setup forkSession mock on manager
			mockSessionManager.forkSession = vi.fn().mockResolvedValue({
				session_id: "forked-session-123",
				title: "Forked Session",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				api_conversation_history_blob_url: null,
				task_metadata_blob_url: null,
				ui_messages_blob_url: null,
				git_state_blob_url: null,
			})
		})

		it("should fork a session successfully", async () => {
			mockContext.args = ["fork", "share-123"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalled()
			expect(mockContext.replaceMessages).toHaveBeenCalledTimes(1)
			expect(mockContext.refreshTerminal).toHaveBeenCalled()
			expect(mockSessionManager.forkSession).toHaveBeenCalledWith("share-123", true)
			// restoreSession is now called internally by forkSession, not by the command handler

			const replacedMessages = (mockContext.replaceMessages as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(replacedMessages).toHaveLength(2)
			expect(replacedMessages[1].content).toContain("Forking session from ID")
			expect(replacedMessages[1].content).toContain("share-123")
		})

		it("should show error when shareId is missing", async () => {
			mockContext.args = ["fork"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /session fork <id>")
			expect(mockSessionManager.forkSession).not.toHaveBeenCalled()
		})

		it("should show error when shareId is empty string", async () => {
			mockContext.args = ["fork", ""]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /session fork <id>")
		})

		it("should handle fork error gracefully", async () => {
			mockSessionManager.forkSession = vi.fn().mockRejectedValue(new Error("Share ID not found"))
			mockContext.args = ["fork", "invalid-share-id"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalled()
			const errorMessage = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls.find(
				(call) => call[0].type === "error",
			)
			expect(errorMessage).toBeDefined()
			if (errorMessage) {
				expect(errorMessage[0].content).toContain("Failed to fork session")
				expect(errorMessage[0].content).toContain("Share ID not found")
			}
		})

		it("should handle 'fork' subcommand case-insensitively", async () => {
			mockContext.args = ["FORK", "share-123"]

			await sessionCommand.handler(mockContext)

			expect(mockSessionManager.forkSession).toHaveBeenCalledWith("share-123", true)
		})
	})

	describe("handler - rename subcommand", () => {
		beforeEach(() => {
			// Setup renameSession mock on manager
			mockSessionManager.renameSession = vi.fn().mockResolvedValue(undefined)
		})

		it("should rename session successfully", async () => {
			mockSessionManager.sessionId = "test-session-123"
			mockContext.args = ["rename", "My", "New", "Session", "Name"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalled()
			expect(mockSessionManager.renameSession).toHaveBeenCalledWith("test-session-123", "My New Session Name")
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Session renamed to")
			expect(message.content).toContain("My New Session Name")
		})

		it("should rename session with single word name", async () => {
			mockSessionManager.sessionId = "test-session-123"
			mockContext.args = ["rename", "SingleWord"]

			await sessionCommand.handler(mockContext)

			expect(mockSessionManager.renameSession).toHaveBeenCalledWith("test-session-123", "SingleWord")
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("SingleWord")
		})

		it("should show error when name is missing", async () => {
			mockContext.args = ["rename"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /session rename <new name>")
			expect(mockSessionManager.renameSession).not.toHaveBeenCalled()
		})

		it("should handle rename error when no active session", async () => {
			mockSessionManager.sessionId = null
			mockContext.args = ["rename", "New", "Name"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to rename session")
			expect(message.content).toContain("No active session")
		})

		it("should handle rename error when title is empty", async () => {
			mockSessionManager.renameSession = vi.fn().mockRejectedValue(new Error("Session title cannot be empty"))
			mockContext.args = ["rename", "   "]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to rename session")
		})

		it("should handle 'rename' subcommand case-insensitively", async () => {
			mockSessionManager.sessionId = "test-session-123"
			mockContext.args = ["RENAME", "New", "Name"]

			await sessionCommand.handler(mockContext)

			expect(mockSessionManager.renameSession).toHaveBeenCalledWith("test-session-123", "New Name")
		})

		it("should handle backend error gracefully", async () => {
			mockSessionManager.sessionId = "test-session-123"
			mockSessionManager.renameSession = vi.fn().mockRejectedValue(new Error("Network error"))
			mockContext.args = ["rename", "New", "Name"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to rename session")
			expect(message.content).toContain("Network error")
		})
	})

	describe("handler - delete subcommand", () => {
		beforeEach(() => {
			// Setup delete mock on client
			mockSessionClient.delete = vi.fn().mockResolvedValue({ success: true })
		})

		it("should delete a session successfully", async () => {
			mockContext.args = ["delete", "session-123"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).toHaveBeenCalled()
			expect(mockSessionClient.delete).toHaveBeenCalledWith({ session_id: "session-123" })
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Session `session-123` deleted successfully")
		})

		it("should show error when sessionId is missing", async () => {
			mockContext.args = ["delete"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /session delete <sessionId>")
			expect(mockSessionClient.delete).not.toHaveBeenCalled()
		})

		it("should show error when sessionId is empty string", async () => {
			mockContext.args = ["delete", ""]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Usage: /session delete <sessionId>")
		})

		it("should handle delete error gracefully", async () => {
			mockSessionClient.delete = vi.fn().mockRejectedValue(new Error("Session not found"))
			mockContext.args = ["delete", "nonexistent-session"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Failed to delete session")
			expect(message.content).toContain("Session not found")
		})

		it("should handle 'delete' subcommand case-insensitively", async () => {
			mockContext.args = ["DELETE", "session-123"]

			await sessionCommand.handler(mockContext)

			expect(mockSessionClient.delete).toHaveBeenCalledWith({ session_id: "session-123" })
		})
	})

	describe("handler - invalid subcommand", () => {
		it("should show error for unknown subcommand", async () => {
			mockContext.args = ["invalid"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Unknown subcommand")
			expect(message.content).toContain("invalid")
			expect(message.content).toContain("show")
			expect(message.content).toContain("list")
			expect(message.content).toContain("search")
			expect(message.content).toContain("select")
			expect(message.content).toContain("share")
			expect(message.content).toContain("fork")
			expect(message.content).toContain("delete")
			expect(message.content).toContain("rename")
		})

		it("should not call SessionManager for invalid subcommand", async () => {
			mockContext.args = ["invalid"]

			await sessionCommand.handler(mockContext)

			expect(SessionManager.init).not.toHaveBeenCalled()
		})
	})

	describe("handler - execution", () => {
		it("should execute without errors when session exists", async () => {
			mockSessionManager.sessionId = "test-id"
			mockContext.args = ["show"]

			await expect(sessionCommand.handler(mockContext)).resolves.not.toThrow()
		})

		it("should execute without errors when no session exists", async () => {
			mockSessionManager.sessionId = null
			mockContext.args = ["show"]

			await expect(sessionCommand.handler(mockContext)).resolves.not.toThrow()
		})

		it("should execute without errors for invalid subcommand", async () => {
			mockContext.args = ["invalid"]

			await expect(sessionCommand.handler(mockContext)).resolves.not.toThrow()
		})
	})

	describe("message generation", () => {
		it("should generate messages with proper structure", async () => {
			mockSessionManager.sessionId = "test-id"
			mockContext.args = ["show"]

			await sessionCommand.handler(mockContext)

			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message).toHaveProperty("id")
			expect(message).toHaveProperty("type")
			expect(message).toHaveProperty("content")
			expect(message).toHaveProperty("ts")
		})
	})

	describe("sessionIdAutocompleteProvider", () => {
		// Helper to create minimal ArgumentProviderContext for testing
		const createProviderContext = (partialInput: string, subcommand?: string): ArgumentProviderContext => ({
			commandName: "session",
			argumentIndex: 1,
			argumentName: "argument",
			currentArgs: [],
			currentOptions: {},
			partialInput,
			getArgument: (name: string) => (name === "subcommand" ? subcommand : undefined),
			parsedValues: { args: {}, options: {} },
			command: sessionCommand,
		})

		it("should NOT run provider when subcommand is 'share'", async () => {
			const conditionalProvider = sessionCommand.arguments![1].conditionalProviders![0]
			const condition = conditionalProvider.condition
			const context = createProviderContext("test", "share")

			const shouldRun = condition(context)

			expect(shouldRun).toBe(false)
		})

		it("should run provider when subcommand is 'select'", async () => {
			const conditionalProvider = sessionCommand.arguments![1].conditionalProviders![0]
			const condition = conditionalProvider.condition
			const context = createProviderContext("test", "select")

			const shouldRun = condition(context)

			expect(shouldRun).toBe(true)
		})

		it("should run provider when subcommand is 'delete'", async () => {
			const conditionalProvider = sessionCommand.arguments![1].conditionalProviders![0]
			const condition = conditionalProvider.condition
			const context = createProviderContext("test", "delete")

			const shouldRun = condition(context)

			expect(shouldRun).toBe(true)
		})

		it("should NOT run provider when subcommand is 'fork'", async () => {
			const conditionalProvider = sessionCommand.arguments![1].conditionalProviders![0]
			const condition = conditionalProvider.condition
			const context = createProviderContext("test", "fork")

			const shouldRun = condition(context)

			expect(shouldRun).toBe(false)
		})

		it("should return empty array for empty prefix", async () => {
			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("", "select")

			const result = await provider(context)

			expect(result).toEqual([])
			expect(mockSessionClient.search).not.toHaveBeenCalled()
		})

		it("should return empty array for whitespace-only prefix", async () => {
			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("   ", "select")

			const result = await provider(context)

			expect(result).toEqual([])
			expect(mockSessionClient.search).not.toHaveBeenCalled()
		})

		it("should call sessionClient.search with searchString", async () => {
			const mockSessions = [
				{
					session_id: "session-abc123",
					title: "ABC Session",
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
				},
				{
					session_id: "session-abc456",
					title: "Another ABC",
					created_at: "2025-01-02T00:00:00Z",
					updated_at: "2025-01-02T00:00:00Z",
				},
			]

			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: mockSessions,
				total: 2,
				limit: 20,
				offset: 0,
			})

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("abc", "select")

			const result = await provider(context)

			expect(mockSessionClient.search).toHaveBeenCalledWith({ search_string: "abc", limit: 20 })
			expect(result).toHaveLength(2)
		})

		it("should map results correctly to suggestion format", async () => {
			const mockSessions = [
				{
					session_id: "session-test123",
					title: "Test Session",
					created_at: "2025-01-15T10:30:00Z",
					updated_at: "2025-01-15T10:30:00Z",
				},
			]

			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: mockSessions,
				total: 1,
				limit: 20,
				offset: 0,
			})

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("test", "select")

			const result = (await provider(context)) as ArgumentSuggestion[]

			expect(result).toHaveLength(1)
			expect(result[0]).toMatchObject({
				value: "session-test123",
				highlightedValue: "session-test123",
			})
			// Description should include title and created date
			expect(result[0].description).toContain("Test Session")
			expect(result[0].description).toContain("Created:")
			expect(result[0].matchScore).toBe(100) // First item gets score of 100
		})

		it("should handle Untitled sessions", async () => {
			const mockSessions = [
				{
					session_id: "session-untitled",
					title: "",
					created_at: "2025-01-15T10:30:00Z",
					updated_at: "2025-01-15T10:30:00Z",
				},
			]

			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: mockSessions,
				total: 1,
				limit: 20,
				offset: 0,
			})

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("session-untitled", "select")

			const result = (await provider(context)) as ArgumentSuggestion[]

			// When no title, description should only show created date
			expect(result[0].value).toBe("session-untitled")
			expect(result[0].highlightedValue).toBe("session-untitled")
			expect(result[0].description).toContain("Created:")
			expect(result[0].description).not.toContain("|") // No title separator
		})

		it("should preserve backend ordering with matchScore", async () => {
			const mockSessions = [
				{
					session_id: "session-1",
					title: "Most Recent",
					created_at: "2025-01-15T10:30:00Z",
					updated_at: "2025-01-15T10:30:00Z",
				},
				{
					session_id: "session-2",
					title: "Second",
					created_at: "2025-01-14T10:30:00Z",
					updated_at: "2025-01-14T10:30:00Z",
				},
				{
					session_id: "session-3",
					title: "Third",
					created_at: "2025-01-13T10:30:00Z",
					updated_at: "2025-01-13T10:30:00Z",
				},
			]

			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: mockSessions,
				total: 3,
				limit: 20,
				offset: 0,
			})

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("session", "select")

			const result = (await provider(context)) as ArgumentSuggestion[]

			// Verify descending matchScore to preserve backend ordering
			expect(result[0].matchScore).toBe(100)
			expect(result[1].matchScore).toBe(99)
			expect(result[2].matchScore).toBe(98)

			// Verify description format includes title
			expect(result[0].description).toContain("Most Recent")
			expect(result[1].description).toContain("Second")
			expect(result[2].description).toContain("Third")
		})

		it("should return all backend results without client-side filtering", async () => {
			const mockSessions = [
				{
					session_id: "session-abc123",
					title: "My Project",
					created_at: "2025-01-15T10:30:00Z",
					updated_at: "2025-01-15T10:30:00Z",
				},
				{
					session_id: "session-xyz789",
					title: "ABC Task",
					created_at: "2025-01-14T10:30:00Z",
					updated_at: "2025-01-14T10:30:00Z",
				},
				{
					session_id: "session-def456",
					title: "Other Task",
					created_at: "2025-01-13T10:30:00Z",
					updated_at: "2025-01-13T10:30:00Z",
				},
			]

			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: mockSessions,
				total: 3,
				limit: 20,
				offset: 0,
			})

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("abc", "select")

			const result = (await provider(context)) as ArgumentSuggestion[]

			// Backend handles filtering, so all results should be returned
			expect(result).toHaveLength(3)
			expect(result[0].value).toBe("session-abc123")
			expect(result[1].value).toBe("session-xyz789")
			expect(result[2].value).toBe("session-def456")
		})

		it("should handle errors gracefully", async () => {
			mockSessionClient.search = vi.fn().mockRejectedValue(new Error("Network error"))

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("test", "select")

			const result = await provider(context)

			expect(result).toEqual([])
		})

		it("should handle empty results from backend", async () => {
			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: [],
				total: 0,
				limit: 20,
				offset: 0,
			})

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("nonexistent", "select")

			const result = await provider(context)

			expect(result).toEqual([])
		})

		it("should pass limit parameter to search", async () => {
			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: [],
				total: 0,
				limit: 20,
				offset: 0,
			})

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("test", "select")

			await provider(context)

			expect(mockSessionClient.search).toHaveBeenCalledWith({ search_string: "test", limit: 20 })
		})

		it("should truncate long titles in description", async () => {
			const longTitle = "This is a very long session title that exceeds fifty characters and should be truncated"
			const mockSessions = [
				{
					session_id: "session-long-title",
					title: longTitle,
					created_at: "2025-01-15T10:30:00Z",
					updated_at: "2025-01-15T10:30:00Z",
				},
			]

			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: mockSessions,
				total: 1,
				limit: 20,
				offset: 0,
			})

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("test", "select")

			const result = (await provider(context)) as ArgumentSuggestion[]

			expect(result).toHaveLength(1)
			// Title should be truncated to 50 chars with "..."
			expect(result[0].description).not.toContain(longTitle)
			expect(result[0].description).toContain("...")
			// The truncated title should be 50 chars (47 chars + "...")
			const titlePart = result[0].description!.split(" | ")[0]
			expect(titlePart.length).toBe(50)
		})

		it("should not truncate short titles", async () => {
			const shortTitle = "Short Title"
			const mockSessions = [
				{
					session_id: "session-short-title",
					title: shortTitle,
					created_at: "2025-01-15T10:30:00Z",
					updated_at: "2025-01-15T10:30:00Z",
				},
			]

			mockSessionClient.search = vi.fn().mockResolvedValue({
				results: mockSessions,
				total: 1,
				limit: 20,
				offset: 0,
			})

			const provider = sessionCommand.arguments![1].conditionalProviders![0].provider
			const context = createProviderContext("test", "select")

			const result = (await provider(context)) as ArgumentSuggestion[]

			expect(result).toHaveLength(1)
			// Short title should not be truncated
			expect(result[0].description).toContain(shortTitle)
			expect(result[0].description).not.toContain("...")
		})
	})
})

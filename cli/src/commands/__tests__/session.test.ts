/**
 * Tests for the /session command
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { sessionCommand } from "../session.js"
import type { CommandContext, ArgumentProviderContext, ArgumentSuggestion } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"
import { SessionService } from "../../services/session.js"
import { SessionClient, CliSessionSharedState } from "../../services/sessionClient.js"

// Mock the SessionService
vi.mock("../../services/session.js", () => ({
	SessionService: {
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
	let mockSessionService: Partial<SessionService>
	let mockSessionClient: Partial<SessionClient>

	beforeEach(() => {
		mockContext = createMockContext({
			input: "/session",
		})

		// Create a mock session service instance
		mockSessionService = {
			sessionId: null,
			restoreSession: vi.fn().mockResolvedValue(undefined),
		}

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
		}

		// Mock SessionService.init to return our mock instance
		vi.mocked(SessionService.init).mockReturnValue(mockSessionService as SessionService)

		// Mock SessionClient.getInstance to return our mock instance
		vi.mocked(SessionClient.getInstance).mockReturnValue(mockSessionClient as SessionClient)
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
			expect(sessionCommand.examples).toHaveLength(6)
			expect(sessionCommand.examples).toContain("/session show")
			expect(sessionCommand.examples).toContain("/session list")
			expect(sessionCommand.examples).toContain("/session select <sessionId>")
			expect(sessionCommand.examples).toContain("/session share")
			expect(sessionCommand.examples).toContain("/session share public")
			expect(sessionCommand.examples).toContain("/session share private")
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
			expect(subcommandArg.values).toHaveLength(4)
			expect(subcommandArg.values!.map((v) => v.value)).toEqual(["show", "list", "select", "share"])
		})

		it("should have argument with conditional providers", () => {
			const argumentArg = sessionCommand.arguments![1]
			expect(argumentArg.name).toBe("argument")
			expect(argumentArg.required).toBe(false)
			expect(argumentArg.conditionalProviders).toBeDefined()
			expect(argumentArg.conditionalProviders).toHaveLength(2)

			// Check both conditional providers exist
			expect(argumentArg.conditionalProviders![0].condition).toBeDefined()
			expect(argumentArg.conditionalProviders![0].provider).toBeDefined()
			expect(argumentArg.conditionalProviders![1].condition).toBeDefined()
			expect(argumentArg.conditionalProviders![1].provider).toBeDefined()
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
			expect(message.content).toContain("select")
			expect(message.content).toContain("share")
		})

		it("should not call SessionService when showing usage", async () => {
			mockContext.args = []

			await sessionCommand.handler(mockContext)

			expect(SessionService.init).not.toHaveBeenCalled()
			expect(SessionClient.getInstance).not.toHaveBeenCalled()
		})
	})

	describe("handler - show subcommand", () => {
		it("should display session ID when session exists", async () => {
			const testSessionId = "test-session-123"
			mockSessionService.sessionId = testSessionId
			mockContext.args = ["show"]

			await sessionCommand.handler(mockContext)

			expect(SessionService.init).toHaveBeenCalledTimes(1)
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Current Session ID")
			expect(message.content).toContain(testSessionId)
		})

		it("should display message when no session exists", async () => {
			mockSessionService.sessionId = null
			mockContext.args = ["show"]

			await sessionCommand.handler(mockContext)

			expect(SessionService.init).toHaveBeenCalledTimes(1)
			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("No active session")
		})

		it("should handle 'show' subcommand case-insensitively", async () => {
			mockSessionService.sessionId = "test-id"
			mockContext.args = ["SHOW"]

			await sessionCommand.handler(mockContext)

			expect(SessionService.init).toHaveBeenCalledTimes(1)
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

			expect(SessionClient.getInstance).toHaveBeenCalled()
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
			mockSessionService.sessionId = "session-active"
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
			expect(message.content).toContain("🟢 [Active]")
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

			expect(SessionService.init).toHaveBeenCalled()
			expect(mockContext.replaceMessages).toHaveBeenCalledTimes(1)
			expect(mockContext.refreshTerminal).toHaveBeenCalled()
			expect(mockSessionService.restoreSession).toHaveBeenCalledWith("session-123", true)

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
			expect(mockSessionService.restoreSession).not.toHaveBeenCalled()
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
			mockSessionService.restoreSession = vi.fn().mockRejectedValue(new Error("Session not found"))
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

			expect(mockSessionService.restoreSession).toHaveBeenCalledWith("session-123", true)
		})
	})

	describe("handler - share subcommand", () => {
		beforeEach(() => {
			// Setup setSharedState mock on service
			mockSessionService.setSharedState = vi.fn().mockResolvedValue({
				success: true,
				session: {
					session_id: "test-session",
					shared_state: "public",
				},
			})
		})

		it("should set session to private", async () => {
			mockSessionService.sessionId = "test-session-123"
			mockContext.args = ["share", "private"]

			await sessionCommand.handler(mockContext)

			expect(SessionService.init).toHaveBeenCalled()
			expect(mockSessionService.setSharedState).toHaveBeenCalledWith(CliSessionSharedState.Private)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Session set to private")
		})

		it("should set session to public", async () => {
			mockSessionService.sessionId = "test-session-123"
			mockContext.args = ["share", "public"]

			await sessionCommand.handler(mockContext)

			expect(SessionService.init).toHaveBeenCalled()
			expect(mockSessionService.setSharedState).toHaveBeenCalledWith(CliSessionSharedState.Public)

			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Session shared at: https://kilo.ai/session/")
		})

		it("should default to public when no state arg provided", async () => {
			mockSessionService.sessionId = "test-session-123"
			mockContext.args = ["share"]

			await sessionCommand.handler(mockContext)

			expect(mockSessionService.setSharedState).toHaveBeenCalledWith(CliSessionSharedState.Public)
		})

		it("should handle case-insensitive state argument", async () => {
			mockSessionService.sessionId = "test-session-123"
			mockContext.args = ["share", "PRIVATE"]

			await sessionCommand.handler(mockContext)

			expect(mockSessionService.setSharedState).toHaveBeenCalledWith(CliSessionSharedState.Private)
		})

		it("should show error for invalid state value", async () => {
			mockSessionService.sessionId = "test-session-123"
			mockContext.args = ["share", "invalid"]

			await sessionCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain('Invalid share state "invalid"')
			expect(message.content).toContain("Must be one of:")
			// Verify error message includes all valid enum values
			Object.values(CliSessionSharedState).forEach((value) => {
				expect(message.content).toContain(value)
			})
			expect(mockSessionService.setSharedState).not.toHaveBeenCalled()
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
			expect(message.content).toContain("select")
			expect(message.content).toContain("share")
		})

		it("should not call SessionService for invalid subcommand", async () => {
			mockContext.args = ["invalid"]

			await sessionCommand.handler(mockContext)

			expect(SessionService.init).not.toHaveBeenCalled()
			expect(SessionClient.getInstance).not.toHaveBeenCalled()
		})
	})

	describe("handler - execution", () => {
		it("should execute without errors when session exists", async () => {
			mockSessionService.sessionId = "test-id"
			mockContext.args = ["show"]

			await expect(sessionCommand.handler(mockContext)).resolves.not.toThrow()
		})

		it("should execute without errors when no session exists", async () => {
			mockSessionService.sessionId = null
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
			mockSessionService.sessionId = "test-id"
			mockContext.args = ["show"]

			await sessionCommand.handler(mockContext)

			const message = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(message).toHaveProperty("id")
			expect(message).toHaveProperty("type")
			expect(message).toHaveProperty("content")
			expect(message).toHaveProperty("ts")
		})
	})

	describe("stateAutocompleteProvider", () => {
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

		it("should run provider when subcommand is 'share'", async () => {
			const conditionalProvider = sessionCommand.arguments![1].conditionalProviders![1]
			const condition = conditionalProvider.condition
			const context = createProviderContext("", "share")

			const shouldRun = condition(context)

			expect(shouldRun).toBe(true)
		})

		it("should NOT run provider when subcommand is 'select'", async () => {
			const conditionalProvider = sessionCommand.arguments![1].conditionalProviders![1]
			const condition = conditionalProvider.condition
			const context = createProviderContext("", "select")

			const shouldRun = condition(context)

			expect(shouldRun).toBe(false)
		})

		it("should NOT run provider when subcommand is 'list'", async () => {
			const conditionalProvider = sessionCommand.arguments![1].conditionalProviders![1]
			const condition = conditionalProvider.condition
			const context = createProviderContext("", "list")

			const shouldRun = condition(context)

			expect(shouldRun).toBe(false)
		})

		it("should return all valid share states", async () => {
			const provider = sessionCommand.arguments![1].conditionalProviders![1].provider
			const context = createProviderContext("", "share")

			const result = (await provider(context)) as ArgumentSuggestion[]

			const enumValues = Object.values(CliSessionSharedState)
			expect(result).toHaveLength(enumValues.length)
			expect(result.map((r) => r.value)).toEqual(enumValues)
		})

		it("should return suggestions with correct format", async () => {
			const provider = sessionCommand.arguments![1].conditionalProviders![1].provider
			const context = createProviderContext("", "share")

			const result = (await provider(context)) as ArgumentSuggestion[]

			expect(result.length).toBeGreaterThan(0)
			result.forEach((suggestion) => {
				expect(suggestion).toHaveProperty("value")
				expect(suggestion).toHaveProperty("description")
				expect(suggestion).toHaveProperty("matchScore", 100)
				expect(suggestion).toHaveProperty("highlightedValue")
				expect(suggestion.description).toContain("Make session")
				expect(suggestion.description).toContain(suggestion.value)
			})
		})

		it("should include 'private' state", async () => {
			const provider = sessionCommand.arguments![1].conditionalProviders![1].provider
			const context = createProviderContext("", "share")

			const result = (await provider(context)) as ArgumentSuggestion[]

			const privateState = result.find((r) => r.value === CliSessionSharedState.Private)
			expect(privateState).toBeDefined()
			expect(privateState?.description).toContain("Make session private")
		})

		it("should include 'public' state", async () => {
			const provider = sessionCommand.arguments![1].conditionalProviders![1].provider
			const context = createProviderContext("", "share")

			const result = (await provider(context)) as ArgumentSuggestion[]

			const publicState = result.find((r) => r.value === CliSessionSharedState.Public)
			expect(publicState).toBeDefined()
			expect(publicState?.description).toContain("Make session public")
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

			expect(mockSessionClient.search).toHaveBeenCalledWith({ searchString: "abc", limit: 20 })
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
				title: "Test Session",
				highlightedValue: "session-test123",
			})
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
			const context = createProviderContext("untitled", "select")

			const result = (await provider(context)) as ArgumentSuggestion[]

			expect(result[0].title).toBe("Untitled")
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

			expect(mockSessionClient.search).toHaveBeenCalledWith({ searchString: "test", limit: 20 })
		})
	})
})

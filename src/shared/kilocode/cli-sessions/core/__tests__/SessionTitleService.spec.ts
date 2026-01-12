import type { ClineMessage } from "@roo-code/types"
import { SessionTitleService } from "../SessionTitleService"

// Mock dependencies
const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
}

const mockExtensionMessenger = {
	sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
	requestSingleCompletion: vi.fn().mockResolvedValue("Generated title"),
}

const mockSessionClient = {
	update: vi.fn().mockResolvedValue({ updated_at: "2023-01-01T10:00:00Z" }),
	get: vi.fn().mockResolvedValue({ title: null }),
}

const mockStateManager = {
	setTitle: vi.fn(),
	getTitle: vi.fn(),
	hasTitle: vi.fn(),
	updateTimestamp: vi.fn(),
}

describe("SessionTitleService", () => {
	let service: SessionTitleService

	beforeEach(() => {
		vi.clearAllMocks()

		service = new SessionTitleService({
			sessionClient: mockSessionClient as any,
			stateManager: mockStateManager as any,
			extensionMessenger: mockExtensionMessenger as any,
			logger: mockLogger as any,
		})
	})

	describe("getFirstMessageText", () => {
		it("returns null for empty messages array", () => {
			const result = service.getFirstMessageText([])

			expect(result).toBeNull()
		})

		it("returns null when no message has text", () => {
			const messages: ClineMessage[] = [
				{ type: "say", text: undefined, ts: 1 },
				{ type: "say", text: "", ts: 2 },
				{ type: "say", text: "   ", ts: 3 },
			]

			const result = service.getFirstMessageText(messages)

			expect(result).toBeNull()
		})

		it("returns first message text", () => {
			const messages: ClineMessage[] = [
				{ type: "say", text: "First message", ts: 1 },
				{ type: "say", text: "Second message", ts: 2 },
			]

			const result = service.getFirstMessageText(messages)

			expect(result).toBe("First message")
		})

		it("normalizes whitespace in text", () => {
			const messages: ClineMessage[] = [{ type: "say", text: "  Multiple   spaces   here  ", ts: 1 }]

			const result = service.getFirstMessageText(messages)

			expect(result).toBe("Multiple spaces here")
		})

		it("truncates text when truncate=true and text exceeds max length", () => {
			const longText = "a".repeat(150)
			const messages: ClineMessage[] = [{ type: "say", text: longText, ts: 1 }]

			const result = service.getFirstMessageText(messages, true)

			expect(result).toBe("a".repeat(137) + "...")
		})

		it("does not truncate when text is within max length", () => {
			const shortText = "Short text"
			const messages: ClineMessage[] = [{ type: "say", text: shortText, ts: 1 }]

			const result = service.getFirstMessageText(messages, true)

			expect(result).toBe("Short text")
		})

		it("returns null when text becomes empty after normalization", () => {
			const messages: ClineMessage[] = [{ type: "say", text: "   \n\t   ", ts: 1 }]

			const result = service.getFirstMessageText(messages)

			expect(result).toBeNull()
		})
	})

	describe("generateTitle", () => {
		it("returns null when no text available", async () => {
			const messages: ClineMessage[] = []

			const result = await service.generateTitle(messages)

			expect(result).toBeNull()
		})

		it("calls extensionMessenger.requestSingleCompletion", async () => {
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			await service.generateTitle(messages)

			expect(mockExtensionMessenger.requestSingleCompletion).toHaveBeenCalledWith(
				expect.stringContaining("Test message"),
				30000,
			)
		})

		it("returns cleaned summary from LLM", async () => {
			mockExtensionMessenger.requestSingleCompletion.mockResolvedValueOnce("  Clean summary  ")
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			const result = await service.generateTitle(messages)

			expect(result).toBe("Clean summary")
		})

		it("removes surrounding quotes from summary", async () => {
			mockExtensionMessenger.requestSingleCompletion.mockResolvedValueOnce('"Quoted summary"')
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			const result = await service.generateTitle(messages)

			expect(result).toBe("Quoted summary")
		})

		it("falls back to truncation on LLM error", async () => {
			mockExtensionMessenger.requestSingleCompletion.mockRejectedValueOnce(new Error("LLM failed"))
			const longText = "a".repeat(150)
			const messages: ClineMessage[] = [{ type: "say", text: longText, ts: 1 }]

			const result = await service.generateTitle(messages)

			expect(result).toBe("a".repeat(137) + "...")
			expect(mockLogger.warn).toHaveBeenCalledWith(
				"Failed to generate title using LLM, falling back to truncation",
				"SessionTitleService",
				expect.any(Object),
			)
		})

		it("falls back to truncation on empty summary", async () => {
			mockExtensionMessenger.requestSingleCompletion.mockResolvedValueOnce("")
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			const result = await service.generateTitle(messages)

			expect(result).toBe("Test message")
		})

		it("logs warning on LLM failure", async () => {
			mockExtensionMessenger.requestSingleCompletion.mockRejectedValueOnce(new Error("Timeout"))

			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			await service.generateTitle(messages)

			expect(mockLogger.warn).toHaveBeenCalledWith(
				"Failed to generate title using LLM, falling back to truncation",
				"SessionTitleService",
				expect.objectContaining({
					error: "Timeout",
				}),
			)
		})
	})

	describe("updateTitle", () => {
		it("throws error for empty title", async () => {
			await expect(service.updateTitle("session-123", "")).rejects.toThrow("Session title cannot be empty")
		})

		it("trims title before update", async () => {
			await service.updateTitle("session-123", "  Trimmed title  ")

			expect(mockSessionClient.update).toHaveBeenCalledWith({
				session_id: "session-123",
				title: "Trimmed title",
			})
		})

		it("calls sessionClient.update with title", async () => {
			await service.updateTitle("session-123", "Test title")

			expect(mockSessionClient.update).toHaveBeenCalledWith({
				session_id: "session-123",
				title: "Test title",
			})
		})

		it("updates state manager with title", async () => {
			await service.updateTitle("session-123", "Test title")

			expect(mockStateManager.setTitle).toHaveBeenCalledWith("session-123", "Test title")
		})

		it("updates state manager with timestamp", async () => {
			await service.updateTitle("session-123", "Test title")
	
			expect(mockStateManager.updateTimestamp).toHaveBeenCalledWith("session-123", "2023-01-01T10:00:00Z")
		})
	
		it("logs success message", async () => {
			await service.updateTitle("session-123", "Test title")
	
			expect(mockLogger.info).toHaveBeenCalledWith("Session title updated successfully", "SessionTitleService", {
				sessionId: "session-123",
				title: "Test title",
			})
		})
	
		it("emits session_title_generated event", async () => {
			const onSessionTitleGenerated = vi.fn()
			const serviceWithCallback = new SessionTitleService({
				sessionClient: mockSessionClient as any,
				stateManager: mockStateManager as any,
				extensionMessenger: mockExtensionMessenger as any,
				logger: mockLogger as any,
				onSessionTitleGenerated,
			})
	
			await serviceWithCallback.updateTitle("session-123", "Test title")
	
			expect(onSessionTitleGenerated).toHaveBeenCalledWith({
				sessionId: "session-123",
				title: "Test title",
				timestamp: expect.any(Number),
				event: "session_title_generated",
			})
		})
	})

	describe("generateAndUpdateTitle", () => {
		it("marks session as pending title", async () => {
			mockSessionClient.get.mockResolvedValueOnce({ title: "Existing title" })
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			await service.generateAndUpdateTitle("session-123", messages)

			expect(mockStateManager.setTitle).toHaveBeenCalledWith("session-123", "Pending title")
		})

		it("checks for existing title on server", async () => {
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			await service.generateAndUpdateTitle("session-123", messages)

			expect(mockSessionClient.get).toHaveBeenCalledWith({ session_id: "session-123" })
		})

		it("uses existing title if found", async () => {
			mockSessionClient.get.mockResolvedValueOnce({ title: "Existing title" })
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			await service.generateAndUpdateTitle("session-123", messages)

			expect(mockStateManager.setTitle).toHaveBeenCalledWith("session-123", "Existing title")
			expect(mockExtensionMessenger.requestSingleCompletion).not.toHaveBeenCalled()
		})

		it("generates new title if none exists", async () => {
			mockSessionClient.get.mockResolvedValueOnce({ title: null })
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			await service.generateAndUpdateTitle("session-123", messages)

			expect(mockExtensionMessenger.requestSingleCompletion).toHaveBeenCalled()
			expect(mockSessionClient.update).toHaveBeenCalled()
		})

		it("updates session with generated title", async () => {
			mockSessionClient.get.mockResolvedValueOnce({ title: null })
			mockExtensionMessenger.requestSingleCompletion.mockResolvedValueOnce("Generated title")
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			await service.generateAndUpdateTitle("session-123", messages)

			expect(mockSessionClient.update).toHaveBeenCalledWith({
				session_id: "session-123",
				title: "Generated title",
			})
		})

		it("falls back to first message on generation failure", async () => {
			mockSessionClient.get.mockResolvedValueOnce({ title: null })
			mockExtensionMessenger.requestSingleCompletion.mockRejectedValueOnce(new Error("LLM failed"))
			const messages: ClineMessage[] = [{ type: "say", text: "Fallback message", ts: 1 }]

			await service.generateAndUpdateTitle("session-123", messages)

			expect(mockSessionClient.update).toHaveBeenCalledWith({
				session_id: "session-123",
				title: "Fallback message",
			})
		})

		it("logs errors appropriately", async () => {
			mockSessionClient.get.mockRejectedValueOnce(new Error("Server error"))
			const messages: ClineMessage[] = [{ type: "say", text: "Test message", ts: 1 }]

			await service.generateAndUpdateTitle("session-123", messages)

			expect(mockLogger.error).toHaveBeenCalledWith(
				"Failed to generate session title",
				"SessionTitleService",
				expect.objectContaining({
					sessionId: "session-123",
					error: "Server error",
				}),
			)
		})
	})

	describe("Configuration", () => {
		it("uses default config values", () => {
			const serviceWithDefaults = new SessionTitleService({
				sessionClient: mockSessionClient as any,
				stateManager: mockStateManager as any,
				extensionMessenger: mockExtensionMessenger as any,
				logger: mockLogger as any,
			})

			// Test that defaults are applied by checking behavior
			const longText = "a".repeat(150)
			const messages: ClineMessage[] = [{ type: "say", text: longText, ts: 1 }]
			const result = serviceWithDefaults.getFirstMessageText(messages, true)

			expect(result).toBe("a".repeat(137) + "...") // 140 max, 137 truncated
		})

		it("accepts custom config values", () => {
			const serviceWithCustom = new SessionTitleService(
				{
					sessionClient: mockSessionClient as any,
					stateManager: mockStateManager as any,
					extensionMessenger: mockExtensionMessenger as any,
					logger: mockLogger as any,
				},
				{
					maxLength: 50,
					truncatedLength: 47,
					llmTimeoutMs: 10000,
				},
			)

			// Test custom max length
			const longText = "a".repeat(60)
			const messages: ClineMessage[] = [{ type: "say", text: longText, ts: 1 }]
			const result = serviceWithCustom.getFirstMessageText(messages, true)

			expect(result).toBe("a".repeat(47) + "...")
		})
	})
})

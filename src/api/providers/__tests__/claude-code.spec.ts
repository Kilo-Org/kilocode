import { ClaudeCodeHandler } from "../claude-code"
import { ApiHandlerOptions } from "../../../shared/api"
import type { StreamChunk } from "../../../integrations/claude-code/streaming-client"

// Mock the OAuth manager
vi.mock("../../../integrations/claude-code/oauth", () => ({
	claudeCodeOAuthManager: {
		getAccessToken: vi.fn(),
		getEmail: vi.fn(),
		loadCredentials: vi.fn(),
		saveCredentials: vi.fn(),
		clearCredentials: vi.fn(),
		isAuthenticated: vi.fn(),
	},
	generateUserId: vi.fn(() => "user_abc123_account_def456_session_ghi789"),
}))

// Mock the streaming client
vi.mock("../../../integrations/claude-code/streaming-client", () => ({
	createStreamingMessage: vi.fn(),
}))

const { claudeCodeOAuthManager } = await import("../../../integrations/claude-code/oauth")
const { createStreamingMessage } = await import("../../../integrations/claude-code/streaming-client")

const mockGetAccessToken = vi.mocked(claudeCodeOAuthManager.getAccessToken)
const mockGetEmail = vi.mocked(claudeCodeOAuthManager.getEmail)
const mockCreateStreamingMessage = vi.mocked(createStreamingMessage)

describe("ClaudeCodeHandler", () => {
	let handler: ClaudeCodeHandler

	beforeEach(() => {
		vi.clearAllMocks()
		const options: ApiHandlerOptions = {
			apiModelId: "claude-sonnet-4-5",
		}
		handler = new ClaudeCodeHandler(options)
	})

	test("should create handler with correct model configuration", () => {
		const model = handler.getModel()
		expect(model.id).toBe("claude-sonnet-4-5")
		expect(model.info.supportsImages).toBe(true)
		expect(model.info.supportsPromptCache).toBe(true)
	})

	test("should use default model when invalid model provided", () => {
		const options: ApiHandlerOptions = {
			apiModelId: "invalid-model",
		}
		const handlerWithInvalidModel = new ClaudeCodeHandler(options)
		const model = handlerWithInvalidModel.getModel()

		expect(model.id).toBe("claude-sonnet-4-5") // default model
	})

	test("should normalize legacy dated model ids to canonical claude-code models", () => {
		const options: ApiHandlerOptions = {
			apiModelId: "claude-opus-4-5-20251101",
		}
		const handlerWithLegacyModel = new ClaudeCodeHandler(options)
		const model = handlerWithLegacyModel.getModel()

		expect(model.id).toBe("claude-opus-4-5")
		expect(model.info.supportsImages).toBe(true)
		expect(model.info.supportsPromptCache).toBe(true)
	})

	test("should return model maxTokens from model definition", () => {
		const options: ApiHandlerOptions = {
			apiModelId: "claude-opus-4-5",
		}
		const handlerWithModel = new ClaudeCodeHandler(options)
		const model = handlerWithModel.getModel()

		expect(model.id).toBe("claude-opus-4-5")
		// Model maxTokens is 32768 as defined in claudeCodeModels for opus
		expect(model.info.maxTokens).toBe(32768)
	})

	test("should support reasoning effort configuration", () => {
		const options: ApiHandlerOptions = {
			apiModelId: "claude-sonnet-4-5",
		}
		const handler = new ClaudeCodeHandler(options)
		const model = handler.getModel()

		// Default model has supportsReasoningEffort
		expect(model.info.supportsReasoningEffort).toEqual(["disable", "low", "medium", "high"])
		expect(model.info.reasoningEffort).toBe("medium")
	})

	test("should throw error when not authenticated", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue(null)

		const stream = handler.createMessage(systemPrompt, messages)
		const iterator = stream[Symbol.asyncIterator]()

		await expect(iterator.next()).rejects.toThrow(/not authenticated/i)
	})

	test("should call createStreamingMessage with thinking enabled by default", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock empty async generator
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			// Empty generator for basic test
		}
		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)

		// Need to start iterating to trigger the call
		const iterator = stream[Symbol.asyncIterator]()
		await iterator.next()

		// Verify createStreamingMessage was called with correct parameters
		// Default model has reasoning effort of "medium" so thinking should be enabled
		// With interleaved thinking, maxTokens comes from model definition (32768 for claude-sonnet-4-5)
		expect(mockCreateStreamingMessage).toHaveBeenCalledWith({
			accessToken: "test-access-token",
			model: "claude-sonnet-4-5",
			systemPrompt,
			messages,
			maxTokens: 32768, // model's maxTokens from claudeCodeModels definition
			thinking: {
				type: "enabled",
				budget_tokens: 32000, // medium reasoning budget_tokens
			},
			tools: undefined,
			toolChoice: undefined,
			metadata: {
				user_id: "user_abc123_account_def456_session_ghi789",
			},
		})
	})

	test("should disable thinking when reasoningEffort is set to disable", async () => {
		const options: ApiHandlerOptions = {
			apiModelId: "claude-sonnet-4-5",
			reasoningEffort: "disable",
		}
		const handlerNoThinking = new ClaudeCodeHandler(options)

		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock empty async generator
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			// Empty generator for basic test
		}
		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handlerNoThinking.createMessage(systemPrompt, messages)

		// Need to start iterating to trigger the call
		const iterator = stream[Symbol.asyncIterator]()
		await iterator.next()

		// Verify createStreamingMessage was called with thinking disabled
		expect(mockCreateStreamingMessage).toHaveBeenCalledWith({
			accessToken: "test-access-token",
			model: "claude-sonnet-4-5",
			systemPrompt,
			messages,
			maxTokens: 32768, // model maxTokens from claudeCodeModels definition
			thinking: { type: "disabled" },
			tools: undefined,
			toolChoice: undefined,
			metadata: {
				user_id: "user_abc123_account_def456_session_ghi789",
			},
		})
	})

	test("should use high reasoning config when reasoningEffort is high", async () => {
		const options: ApiHandlerOptions = {
			apiModelId: "claude-sonnet-4-5",
			reasoningEffort: "high",
		}
		const handlerHighThinking = new ClaudeCodeHandler(options)

		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock empty async generator
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			// Empty generator for basic test
		}
		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handlerHighThinking.createMessage(systemPrompt, messages)

		// Need to start iterating to trigger the call
		const iterator = stream[Symbol.asyncIterator]()
		await iterator.next()

		// Verify createStreamingMessage was called with high thinking config
		// With interleaved thinking, maxTokens comes from model definition (32768 for claude-sonnet-4-5)
		expect(mockCreateStreamingMessage).toHaveBeenCalledWith({
			accessToken: "test-access-token",
			model: "claude-sonnet-4-5",
			systemPrompt,
			messages,
			maxTokens: 32768, // model's maxTokens from claudeCodeModels definition
			thinking: {
				type: "enabled",
				budget_tokens: 64000, // high reasoning budget_tokens
			},
			tools: undefined,
			toolChoice: undefined,
			metadata: {
				user_id: "user_abc123_account_def456_session_ghi789",
			},
		})
	})

	test("should handle text content from streaming", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock async generator that yields text chunks
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "text", text: "Hello " }
			yield { type: "text", text: "there!" }
		}

		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "text",
			text: "Hello ",
		})
		expect(results[1]).toEqual({
			type: "text",
			text: "there!",
		})
	})

	test("should handle reasoning content from streaming", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock async generator that yields reasoning chunks
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "reasoning", text: "I need to think about this carefully..." }
		}

		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(1)
		expect(results[0]).toEqual({
			type: "reasoning",
			text: "I need to think about this carefully...",
		})
	})

	test("should handle mixed content types from streaming", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock async generator that yields mixed content
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "reasoning", text: "Let me think about this..." }
			yield { type: "text", text: "Here's my response!" }
		}

		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "reasoning",
			text: "Let me think about this...",
		})
		expect(results[1]).toEqual({
			type: "text",
			text: "Here's my response!",
		})
	})

	test("should handle tool call partial chunks from streaming", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock async generator that yields tool call partial chunks
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "tool_call_partial", index: 0, id: "tool_123", name: "read_file", arguments: undefined }
			yield { type: "tool_call_partial", index: 0, id: undefined, name: undefined, arguments: '{"path":' }
			yield { type: "tool_call_partial", index: 0, id: undefined, name: undefined, arguments: '"test.txt"}' }
		}

		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(3)
		expect(results[0]).toEqual({
			type: "tool_call_partial",
			index: 0,
			id: "tool_123",
			name: "read_file",
			arguments: undefined,
		})
		expect(results[1]).toEqual({
			type: "tool_call_partial",
			index: 0,
			id: undefined,
			name: undefined,
			arguments: '{"path":',
		})
		expect(results[2]).toEqual({
			type: "tool_call_partial",
			index: 0,
			id: undefined,
			name: undefined,
			arguments: '"test.txt"}',
		})
	})

	test("should handle usage and cost tracking from streaming", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock async generator with text and usage
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "text", text: "Hello there!" }
			yield {
				type: "usage",
				inputTokens: 10,
				outputTokens: 20,
				cacheReadTokens: 5,
				cacheWriteTokens: 3,
			}
		}

		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Should have text chunk and usage chunk
		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "text",
			text: "Hello there!",
		})
		// Claude Code is subscription-based, no per-token cost
		expect(results[1]).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 3,
			totalCost: 0,
		})
	})

	test("should handle usage without cache tokens", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock async generator with usage without cache tokens
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "text", text: "Hello there!" }
			yield {
				type: "usage",
				inputTokens: 10,
				outputTokens: 20,
			}
		}

		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Claude Code is subscription-based, no per-token cost
		expect(results).toHaveLength(2)
		expect(results[1]).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: undefined,
			cacheWriteTokens: undefined,
			totalCost: 0,
		})
	})

	test("should handle API errors from streaming", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		mockGetAccessToken.mockResolvedValue("test-access-token")

		// Mock async generator that yields an error
		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "error", error: "Invalid model name" }
		}

		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const iterator = stream[Symbol.asyncIterator]()

		// Should throw an error
		await expect(iterator.next()).rejects.toThrow("Invalid model name")
	})

	test("should handle authentication refresh and continue streaming", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// First call returns a valid token
		mockGetAccessToken.mockResolvedValue("refreshed-token")

		const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
			yield { type: "text", text: "Response after refresh" }
		}

		mockCreateStreamingMessage.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(1)
		expect(results[0]).toEqual({
			type: "text",
			text: "Response after refresh",
		})

		expect(mockCreateStreamingMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				accessToken: "refreshed-token",
			}),
		)
	})

	describe("completePrompt", () => {
		test("should throw error when not authenticated", async () => {
			mockGetAccessToken.mockResolvedValue(null)

			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(/not authenticated/i)
		})

		test("should complete prompt and return text response", async () => {
			mockGetAccessToken.mockResolvedValue("test-access-token")
			mockGetEmail.mockResolvedValue("test@example.com")

			// Mock async generator that yields text chunks
			const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
				yield { type: "text", text: "Hello " }
				yield { type: "text", text: "world!" }
				yield { type: "usage", inputTokens: 10, outputTokens: 5 }
			}

			mockCreateStreamingMessage.mockReturnValue(mockGenerator())

			const result = await handler.completePrompt("Say hello")

			expect(result).toBe("Hello world!")
		})

		test("should call createStreamingMessage with empty system prompt and thinking disabled", async () => {
			mockGetAccessToken.mockResolvedValue("test-access-token")
			mockGetEmail.mockResolvedValue("test@example.com")

			// Mock empty async generator
			const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
				yield { type: "text", text: "Response" }
			}

			mockCreateStreamingMessage.mockReturnValue(mockGenerator())

			await handler.completePrompt("Test prompt")

			// Verify createStreamingMessage was called with correct parameters
			// System prompt is empty because the prompt text contains all context
			// createStreamingMessage will still prepend the Claude Code branding
			expect(mockCreateStreamingMessage).toHaveBeenCalledWith({
				accessToken: "test-access-token",
				model: "claude-sonnet-4-5",
				systemPrompt: "", // Empty - branding is added by createStreamingMessage
				messages: [{ role: "user", content: "Test prompt" }],
				maxTokens: 32768,
				thinking: { type: "disabled" }, // No thinking for simple completions
				metadata: {
					user_id: "user_abc123_account_def456_session_ghi789",
				},
			})
		})

		test("should handle API errors from streaming", async () => {
			mockGetAccessToken.mockResolvedValue("test-access-token")
			mockGetEmail.mockResolvedValue("test@example.com")

			// Mock async generator that yields an error
			const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
				yield { type: "error", error: "API rate limit exceeded" }
			}

			mockCreateStreamingMessage.mockReturnValue(mockGenerator())

			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("API rate limit exceeded")
		})

		test("should return empty string when no text chunks received", async () => {
			mockGetAccessToken.mockResolvedValue("test-access-token")
			mockGetEmail.mockResolvedValue("test@example.com")

			// Mock async generator that only yields usage
			const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
				yield { type: "usage", inputTokens: 10, outputTokens: 0 }
			}

			mockCreateStreamingMessage.mockReturnValue(mockGenerator())

			const result = await handler.completePrompt("Test prompt")

			expect(result).toBe("")
		})

		test("should use opus model maxTokens when configured", async () => {
			const options: ApiHandlerOptions = {
				apiModelId: "claude-opus-4-5",
			}
			const handlerOpus = new ClaudeCodeHandler(options)

			mockGetAccessToken.mockResolvedValue("test-access-token")
			mockGetEmail.mockResolvedValue("test@example.com")

			const mockGenerator = async function* (): AsyncGenerator<StreamChunk> {
				yield { type: "text", text: "Response" }
			}

			mockCreateStreamingMessage.mockReturnValue(mockGenerator())

			await handlerOpus.completePrompt("Test prompt")

			expect(mockCreateStreamingMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "claude-opus-4-5",
					maxTokens: 32768, // opus model maxTokens
				}),
			)
		})
	})
})

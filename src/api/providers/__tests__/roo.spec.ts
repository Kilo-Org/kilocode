// npx vitest run api/providers/__tests__/roo.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import { rooDefaultModelId } from "@roo-code/types"

import { ApiHandlerOptions } from "../../../shared/api"

// Mock OpenAI client
const mockCreate = vitest.fn()

vitest.mock("openai", () => {
	return {
		__esModule: true,
		default: vitest.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate.mockImplementation(async (options) => {
						if (!options.stream) {
							return {
								id: "test-completion",
								choices: [
									{
										message: { role: "assistant", content: "Test response" },
										finish_reason: "stop",
										index: 0,
									},
								],
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									total_tokens: 15,
								},
							}
						}

						return {
							[Symbol.asyncIterator]: async function* () {
								yield {
									choices: [{ delta: { content: "Test response" }, index: 0 }],
									usage: null,
								}
								yield {
									choices: [{ delta: {}, index: 0 }],
									usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
								}
							},
						}
					}),
				},
			},
		})),
	}
})

// Mock CloudService - Define functions outside to avoid initialization issues
const mockGetSessionToken = vitest.fn()
const mockHasInstance = vitest.fn()

// Create mock functions that we can control
const mockGetSessionTokenFn = vitest.fn()
const mockHasInstanceFn = vitest.fn()
const mockOnFn = vitest.fn()

vitest.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: () => mockHasInstanceFn(),
		get instance() {
			return {
				authService: {
					getSessionToken: () => mockGetSessionTokenFn(),
				},
				on: vitest.fn(),
				off: vitest.fn(),
			}
		},
	},
}))

// Mock i18n
vitest.mock("../../../i18n", () => ({
	t: vitest.fn((key: string) => {
		if (key === "common:errors.roo.authenticationRequired") {
			return "Authentication required for Roo Code Cloud"
		}
		return key
	}),
}))

// Mock model cache
vitest.mock("../../providers/fetchers/modelCache", () => ({
	getModels: vitest.fn(),
	flushModels: vitest.fn(),
	getModelsFromCache: vitest.fn((provider: string) => {
		if (provider === "roo") {
			return {
				"xai/grok-code-fast-1": {
					maxTokens: 16_384,
					contextWindow: 262_144,
					supportsImages: false,
					supportsReasoningEffort: true, // Enable reasoning for tests
					supportsPromptCache: true,
					inputPrice: 0,
					outputPrice: 0,
				},
			}
		}
		return {}
	}),
}))

// Import after mocks are set up
import { RooHandler } from "../roo"
import { CloudService } from "@roo-code/cloud"

describe("RooHandler", () => {
	let handler: RooHandler
	let mockOptions: ApiHandlerOptions
	const systemPrompt = "You are a helpful assistant."
	const messages: Anthropic.Messages.MessageParam[] = [
		{
			role: "user",
			content: "Hello!",
		},
	]

	beforeEach(() => {
		mockOptions = {
			apiModelId: "xai/grok-code-fast-1",
		}
		// Set up CloudService mocks for successful authentication
		mockHasInstanceFn.mockReturnValue(true)
		mockGetSessionTokenFn.mockReturnValue("test-session-token")
		mockCreate.mockClear()
		vitest.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with valid session token", () => {
			handler = new RooHandler(mockOptions)
			expect(handler).toBeInstanceOf(RooHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should not throw error if CloudService is not available", () => {
			mockHasInstanceFn.mockReturnValue(false)
			expect(() => {
				new RooHandler(mockOptions)
			}).not.toThrow()
			// Constructor should succeed even without CloudService
			const handler = new RooHandler(mockOptions)
			expect(handler).toBeInstanceOf(RooHandler)
		})

		it("should not throw error if session token is not available", () => {
			mockHasInstanceFn.mockReturnValue(true)
			mockGetSessionTokenFn.mockReturnValue(null)
			expect(() => {
				new RooHandler(mockOptions)
			}).not.toThrow()
			// Constructor should succeed even without session token
			const handler = new RooHandler(mockOptions)
			expect(handler).toBeInstanceOf(RooHandler)
		})

		it("should initialize with default model if no model specified", () => {
			handler = new RooHandler({})
			expect(handler).toBeInstanceOf(RooHandler)
			expect(handler.getModel().id).toBe(rooDefaultModelId)
		})

		it("should pass correct configuration to base class", () => {
			handler = new RooHandler(mockOptions)
			expect(handler).toBeInstanceOf(RooHandler)
			// The handler should be initialized with correct base URL and API key
			// We can't directly test the parent class constructor, but we can verify the handler works
			expect(handler).toBeDefined()
		})
	})

	describe("createMessage", () => {
		beforeEach(() => {
			handler = new RooHandler(mockOptions)
		})

		it("should update API key before making request", async () => {
			// Set up a fresh token that will be returned when createMessage is called
			const freshToken = "fresh-session-token"
			mockGetSessionTokenFn.mockReturnValue(freshToken)

			const stream = handler.createMessage(systemPrompt, messages)
			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// Just consume
			}

			// Verify getSessionToken was called to get the fresh token
			expect(mockGetSessionTokenFn).toHaveBeenCalled()
		})

		it("should handle streaming responses", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Test response")
		})

		it("should include usage information", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0].inputTokens).toBe(10)
			expect(usageChunks[0].outputTokens).toBe(5)
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			const stream = handler.createMessage(systemPrompt, messages)
			await expect(async () => {
				for await (const _chunk of stream) {
					// Should not reach here
				}
			}).rejects.toThrow("API Error")
		})

		it("should handle empty response content", async () => {
			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: null },
								index: 0,
							},
						],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 0,
							total_tokens: 10,
						},
					}
				},
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(0)
			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(1)
		})

		it("should handle multiple messages in conversation", async () => {
			const multipleMessages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: "First response" },
				{ role: "user", content: "Second message" },
			]

			const stream = handler.createMessage(systemPrompt, multipleMessages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: expect.arrayContaining([
						expect.objectContaining({ role: "system", content: systemPrompt }),
						expect.objectContaining({ role: "user", content: "First message" }),
						expect.objectContaining({ role: "assistant", content: "First response" }),
						expect.objectContaining({ role: "user", content: "Second message" }),
					]),
				}),
				undefined,
			)
		})
	})

	describe("completePrompt", () => {
		beforeEach(() => {
			handler = new RooHandler(mockOptions)
		})

		it("should complete prompt successfully", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: mockOptions.apiModelId,
				messages: [{ role: "user", content: "Test prompt" }],
			})
		})

		it("should update API key before making request", async () => {
			// Set up a fresh token that will be returned when completePrompt is called
			const freshToken = "fresh-session-token"
			mockGetSessionTokenFn.mockReturnValue(freshToken)

			// Access the client's apiKey property to verify it gets updated
			const clientApiKeyGetter = vitest.fn()
			Object.defineProperty(handler["client"], "apiKey", {
				get: clientApiKeyGetter,
				set: vitest.fn(),
				configurable: true,
			})

			await handler.completePrompt("Test prompt")

			// Verify getSessionToken was called to get the fresh token
			expect(mockGetSessionTokenFn).toHaveBeenCalled()
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(
				"Roo Code Cloud completion error: API Error",
			)
		})

		it("should handle empty response", async () => {
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: { content: "" } }],
			})
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should handle missing response content", async () => {
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: {} }],
			})
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})
	})

	describe("getModel", () => {
		beforeEach(() => {
			handler = new RooHandler(mockOptions)
		})

		it("should return model info for specified model", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe(mockOptions.apiModelId)
			expect(modelInfo.info).toBeDefined()
			// Models are loaded dynamically, so we just verify the structure
			expect(modelInfo.info.maxTokens).toBeDefined()
			expect(modelInfo.info.contextWindow).toBeDefined()
		})

		it("should return default model when no model specified", () => {
			const handlerWithoutModel = new RooHandler({})
			const modelInfo = handlerWithoutModel.getModel()
			expect(modelInfo.id).toBe(rooDefaultModelId)
			expect(modelInfo.info).toBeDefined()
			// Models are loaded dynamically
			expect(modelInfo.info.maxTokens).toBeDefined()
			expect(modelInfo.info.contextWindow).toBeDefined()
		})

		it("should handle unknown model ID with fallback info", () => {
			const handlerWithUnknownModel = new RooHandler({
				apiModelId: "unknown-model-id",
			})
			const modelInfo = handlerWithUnknownModel.getModel()
			expect(modelInfo.id).toBe("unknown-model-id")
			expect(modelInfo.info).toBeDefined()
			// Should return fallback info for unknown models (dynamic models will be merged in real usage)
			expect(modelInfo.info.maxTokens).toBeDefined()
			expect(modelInfo.info.contextWindow).toBeDefined()
			expect(modelInfo.info.supportsImages).toBeDefined()
			expect(modelInfo.info.supportsPromptCache).toBeDefined()
			expect(modelInfo.info.inputPrice).toBeDefined()
			expect(modelInfo.info.outputPrice).toBeDefined()
		})

		it("should handle any model ID since models are loaded dynamically", () => {
			// Test with various model IDs - they should all work since models are loaded dynamically
			const testModelIds = ["xai/grok-code-fast-1", "roo/sonic", "deepseek/deepseek-chat-v3.1"]

			for (const modelId of testModelIds) {
				const handlerWithModel = new RooHandler({ apiModelId: modelId })
				const modelInfo = handlerWithModel.getModel()
				expect(modelInfo.id).toBe(modelId)
				expect(modelInfo.info).toBeDefined()
				// Verify the structure has required fields
				expect(modelInfo.info.maxTokens).toBeDefined()
				expect(modelInfo.info.contextWindow).toBeDefined()
			}
		})
	})

	describe("temperature and model configuration", () => {
		it("should use default temperature of 0.7", async () => {
			handler = new RooHandler(mockOptions)
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.7,
				}),
				undefined,
			)
		})

		it("should respect custom temperature setting", async () => {
			handler = new RooHandler({
				...mockOptions,
				modelTemperature: 0.9,
			})
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.9,
				}),
				undefined,
			)
		})

		it("should use correct API endpoint", () => {
			// The base URL should be set to Roo's API endpoint
			// We can't directly test the OpenAI client configuration, but we can verify the handler initializes
			handler = new RooHandler(mockOptions)
			expect(handler).toBeInstanceOf(RooHandler)
			// The handler should work with the Roo API endpoint
		})
	})

	describe("authentication flow", () => {
		it("should use session token as API key", () => {
			const testToken = "test-session-token-123"
			mockGetSessionTokenFn.mockReturnValue(testToken)

			handler = new RooHandler(mockOptions)
			expect(handler).toBeInstanceOf(RooHandler)
			expect(mockGetSessionTokenFn).toHaveBeenCalled()
		})

		it("should handle undefined auth service gracefully", () => {
			mockHasInstanceFn.mockReturnValue(true)
			// Mock CloudService with undefined authService
			const originalGetSessionToken = mockGetSessionTokenFn.getMockImplementation()

			// Temporarily make authService return undefined
			mockGetSessionTokenFn.mockImplementation(() => undefined)

			try {
				Object.defineProperty(CloudService, "instance", {
					get: () => ({
						authService: undefined,
						on: vitest.fn(),
						off: vitest.fn(),
					}),
					configurable: true,
				})

				expect(() => {
					new RooHandler(mockOptions)
				}).not.toThrow()
				// Constructor should succeed even with undefined auth service
				const handler = new RooHandler(mockOptions)
				expect(handler).toBeInstanceOf(RooHandler)
			} finally {
				// Restore original mock implementation
				if (originalGetSessionToken) {
					mockGetSessionTokenFn.mockImplementation(originalGetSessionToken)
				} else {
					mockGetSessionTokenFn.mockReturnValue("test-session-token")
				}
			}
		})

		it("should handle empty session token gracefully", () => {
			mockGetSessionTokenFn.mockReturnValue("")

			expect(() => {
				new RooHandler(mockOptions)
			}).not.toThrow()
			// Constructor should succeed even with empty session token
			const handler = new RooHandler(mockOptions)
			expect(handler).toBeInstanceOf(RooHandler)
		})
	})

	describe("reasoning effort support", () => {
		it("should include reasoning with enabled: false when not enabled", async () => {
			handler = new RooHandler(mockOptions)
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: mockOptions.apiModelId,
					messages: expect.any(Array),
					stream: true,
					stream_options: { include_usage: true },
					reasoning: { enabled: false },
				}),
				undefined,
			)
		})

		it("should include reasoning with enabled: false when explicitly disabled", async () => {
			handler = new RooHandler({
				...mockOptions,
				enableReasoningEffort: false,
			})
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					reasoning: { enabled: false },
				}),
				undefined,
			)
		})

		it("should include reasoning with enabled: true and effort: low", async () => {
			handler = new RooHandler({
				...mockOptions,
				reasoningEffort: "low",
			})
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					reasoning: { enabled: true, effort: "low" },
				}),
				undefined,
			)
		})

		it("should include reasoning with enabled: true and effort: medium", async () => {
			handler = new RooHandler({
				...mockOptions,
				reasoningEffort: "medium",
			})
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					reasoning: { enabled: true, effort: "medium" },
				}),
				undefined,
			)
		})

		it("should include reasoning with enabled: true and effort: high", async () => {
			handler = new RooHandler({
				...mockOptions,
				reasoningEffort: "high",
			})
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume stream
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					reasoning: { enabled: true, effort: "high" },
				}),
				undefined,
			)
		})

		it("should not include reasoning for minimal (treated as none)", async () => {
			handler = new RooHandler({
				...mockOptions,
				reasoningEffort: "minimal",
			})
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume stream
			}

			// minimal should result in no reasoning parameter
			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.reasoning).toBeUndefined()
		})

		it("should handle enableReasoningEffort: false overriding reasoningEffort setting", async () => {
			handler = new RooHandler({
				...mockOptions,
				enableReasoningEffort: false,
				reasoningEffort: "high",
			})
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume stream
			}

			// When explicitly disabled, should send enabled: false regardless of effort setting
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					reasoning: { enabled: false },
				}),
				undefined,
			)
		})
	})
})

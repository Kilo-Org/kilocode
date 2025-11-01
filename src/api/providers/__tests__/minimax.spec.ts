// npx vitest run src/api/providers/__tests__/minimax.spec.ts

import { MiniMaxHandler } from "../minimax"
import { ApiHandlerOptions } from "../../../shared/api"
import {
	minimaxDefaultModelId,
	minimaxModels,
	MINIMAX_DEFAULT_TEMPERATURE,
	MINIMAX_DEFAULT_MAX_TOKENS,
} from "@roo-code/types"

const mockCreate = vitest.fn()

vitest.mock("@anthropic-ai/sdk", () => {
	const mockAnthropicConstructor = vitest.fn().mockImplementation(() => ({
		messages: {
			create: mockCreate.mockImplementation(async (options) => {
				if (!options.stream) {
					return {
						id: "test-completion",
						content: [{ type: "text", text: "Test response from MiniMax" }],
						role: "assistant",
						model: options.model,
						usage: {
							input_tokens: 10,
							output_tokens: 5,
						},
					}
				}
				return {
					async *[Symbol.asyncIterator]() {
						yield {
							type: "message_start",
							message: {
								usage: {
									input_tokens: 100,
									output_tokens: 50,
									cache_creation_input_tokens: 0,
									cache_read_input_tokens: 0,
								},
							},
						}
						yield {
							type: "content_block_start",
							index: 0,
							content_block: {
								type: "text",
								text: "Hello",
							},
						}
						yield {
							type: "content_block_delta",
							delta: {
								type: "text_delta",
								text: " from MiniMax",
							},
						}
					},
				}
			}),
			countTokens: vitest.fn().mockResolvedValue({ input_tokens: 42 }),
		},
	}))

	return {
		Anthropic: mockAnthropicConstructor,
	}
})

// Import after mock
import { Anthropic } from "@anthropic-ai/sdk"

const mockAnthropicConstructor = vitest.mocked(Anthropic)

describe("MiniMaxHandler", () => {
	let handler: MiniMaxHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			minimaxApiKey: "test-minimax-api-key",
			apiModelId: minimaxDefaultModelId,
		}
		handler = new MiniMaxHandler(mockOptions)
		vitest.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(MiniMaxHandler)
			expect(handler.getModel().id).toBe(minimaxDefaultModelId)
		})

		it("should use default international base URL", () => {
			new MiniMaxHandler(mockOptions)
			expect(mockAnthropicConstructor).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.minimax.io/anthropic",
					apiKey: "test-minimax-api-key",
				}),
			)
		})

		it("should use custom base URL if provided", () => {
			const customBaseUrl = "https://api.minimaxi.com/anthropic"
			new MiniMaxHandler({
				...mockOptions,
				minimaxBaseUrl: customBaseUrl,
			})
			expect(mockAnthropicConstructor).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: customBaseUrl,
				}),
			)
		})

		it("should use China base URL when provided", () => {
			const chinaBaseUrl = "https://api.minimaxi.com/anthropic"
			new MiniMaxHandler({
				...mockOptions,
				minimaxBaseUrl: chinaBaseUrl,
			})
			expect(mockAnthropicConstructor).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: chinaBaseUrl,
					apiKey: "test-minimax-api-key",
				}),
			)
		})

		it("should initialize without API key", () => {
			const handlerWithoutKey = new MiniMaxHandler({
				...mockOptions,
				minimaxApiKey: undefined,
			})
			expect(handlerWithoutKey).toBeInstanceOf(MiniMaxHandler)
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."

		it("should stream messages successfully", async () => {
			const stream = handler.createMessage(systemPrompt, [
				{
					role: "user",
					content: [{ type: "text" as const, text: "Hello MiniMax" }],
				},
			])

			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify usage information
			const usageChunk = chunks.find((chunk) => chunk.type === "usage")
			expect(usageChunk).toBeDefined()
			expect(usageChunk?.inputTokens).toBe(100)
			expect(usageChunk?.outputTokens).toBe(50)

			// Verify text content
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(2)
			expect(textChunks[0].text).toBe("Hello")
			expect(textChunks[1].text).toBe(" from MiniMax")

			// Verify API call
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: minimaxDefaultModelId,
					max_tokens: 38400,
					temperature: MINIMAX_DEFAULT_TEMPERATURE,
					system: [{ text: systemPrompt, type: "text" }],
					stream: true,
				}),
			)
		})

		it("should handle multiple messages", async () => {
			const stream = handler.createMessage(systemPrompt, [
				{
					role: "user",
					content: [{ type: "text" as const, text: "First message" }],
				},
				{
					role: "assistant",
					content: [{ type: "text" as const, text: "Response" }],
				},
				{
					role: "user",
					content: [{ type: "text" as const, text: "Second message" }],
				},
			])

			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			expect(mockCreate).toHaveBeenCalled()
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response from MiniMax")
			expect(mockCreate).toHaveBeenCalledWith({
				model: minimaxDefaultModelId,
				messages: [{ role: "user", content: "Test prompt" }],
				max_tokens: MINIMAX_DEFAULT_MAX_TOKENS,
				temperature: MINIMAX_DEFAULT_TEMPERATURE,
				thinking: undefined,
				stream: false,
			})
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("MiniMax API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("MiniMax API Error")
		})

		it("should handle non-text content", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				content: [{ type: "image" }],
			}))
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should handle empty response", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				content: [{ type: "text", text: "" }],
			}))
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})
	})

	describe("getModel", () => {
		it("should return default model if no model ID is provided", () => {
			const handlerWithoutModel = new MiniMaxHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(minimaxDefaultModelId)
			expect(model.info).toBeDefined()
		})

		it("should return MiniMax-M2 as default model", () => {
			const model = handler.getModel()
			expect(model.id).toBe("MiniMax-M2")
			expect(model.info).toEqual(minimaxModels["MiniMax-M2"])
		})

		it("should return correct model configuration for MiniMax-M2", () => {
			const model = handler.getModel()
			expect(model.id).toBe("MiniMax-M2")
			expect(model.info.maxTokens).toBe(128_000)
			expect(model.info.contextWindow).toBe(192_000)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(false)
			expect(model.info.inputPrice).toBe(0.3)
			expect(model.info.outputPrice).toBe(1.2)
		})

		it("should use correct default temperature", () => {
			const model = handler.getModel()
			expect(model.temperature).toBe(0)
		})

		it("should use correct default max tokens", () => {
			const model = handler.getModel()
			expect(model.maxTokens).toBe(38400)
		})
	})

	describe("countTokens", () => {
		it("should count tokens using Anthropic API", async () => {
			// Create a fresh handler to get the Anthropic instance
			const testHandler = new MiniMaxHandler(mockOptions)
			const anthropicInstance =
				mockAnthropicConstructor.mock.results[mockAnthropicConstructor.mock.results.length - 1]?.value

			const content = [{ type: "text" as const, text: "Test content for MiniMax" }]
			const result = await testHandler.countTokens(content)

			expect(result).toBe(42)
			expect(anthropicInstance?.messages.countTokens).toHaveBeenCalledWith({
				model: minimaxDefaultModelId,
				messages: [{ role: "user", content }],
			})
		})

		it("should fallback to base implementation on error", async () => {
			// Create a fresh handler to get the Anthropic instance
			const testHandler = new MiniMaxHandler(mockOptions)
			const anthropicInstance =
				mockAnthropicConstructor.mock.results[mockAnthropicConstructor.mock.results.length - 1]?.value

			if (anthropicInstance) {
				anthropicInstance.messages.countTokens.mockRejectedValueOnce(new Error("API error"))
			}

			const content = [{ type: "text" as const, text: "Test content" }]
			const result = await testHandler.countTokens(content)

			// Should not throw and return some number from fallback
			expect(typeof result).toBe("number")
		})
	})

	describe("Model Configuration", () => {
		it("should have correct model configuration", () => {
			expect(minimaxDefaultModelId).toBe("MiniMax-M2")
			expect(minimaxModels["MiniMax-M2"]).toEqual({
				maxTokens: 128_000,
				contextWindow: 192_000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.3,
				outputPrice: 1.2,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0,
			})
		})

		it("should have correct default constants", () => {
			expect(MINIMAX_DEFAULT_TEMPERATURE).toBe(1.0)
			expect(MINIMAX_DEFAULT_MAX_TOKENS).toBe(16384)
		})
	})
})

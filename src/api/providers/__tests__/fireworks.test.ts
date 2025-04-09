// npx jest src/api/providers/__tests__/fireworks.test.ts

import { FireworksHandler } from "../fireworks"
import { ApiHandlerOptions, fireworksDefaultModelId } from "../../../shared/api"
import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"
import { BaseProvider } from "../base-provider"

const mockCreate = jest.fn()
jest.mock("openai", () => {
	return {
		__esModule: true,
		default: jest.fn().mockImplementation(() => ({
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
									choices: [
										{
											delta: { content: "Test response" },
											index: 0,
										},
									],
									usage: null,
								}
								yield {
									choices: [
										{
											delta: {},
											index: 0,
										},
									],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
									},
								}
							},
						}
					}),
				},
			},
		})),
	}
})

describe("FireworksHandler", () => {
	let handler: FireworksHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			fireworksApiKey: "test-api-key",
		}
		handler = new FireworksHandler(mockOptions)
		mockCreate.mockClear()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(FireworksHandler)
			expect(handler.getModel().id).toBe(fireworksDefaultModelId)
		})

		it("should initialize with undefined API key", () => {
			const handlerWithoutKey = new FireworksHandler({
				...mockOptions,
				fireworksApiKey: undefined,
			})
			expect(handlerWithoutKey).toBeInstanceOf(FireworksHandler)
		})

		it("should prioritize apiModelId over fireworksModelId in constructor", () => {
			const handler = new FireworksHandler({
				fireworksApiKey: "test-api-key",
				fireworksModelId: "accounts/fireworks/models/deepseek-v3",
				apiModelId: "accounts/fireworks/models/llama-13b",
			})
			expect(handler.getModel().id).toBe("accounts/fireworks/models/llama-13b")
		})

		it("should use fireworksModelId when apiModelId is not provided", () => {
			const handler = new FireworksHandler({
				fireworksApiKey: "test-api-key",
				fireworksModelId: "accounts/fireworks/models/deepseek-v3",
			})
			expect(handler.getModel().id).toBe("accounts/fireworks/models/deepseek-v3")
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text" as const,
						text: "Hello!",
					},
				],
			},
		]

		it("should yield error message when API key is missing", async () => {
			const handlerWithoutKey = new FireworksHandler({
				...mockOptions,
				fireworksApiKey: undefined,
			})

			const stream = handlerWithoutKey.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0].type).toBe("text")
			expect(chunks[0].text).toContain("ERROR: Fireworks API key is required")
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

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: fireworksDefaultModelId,
					stream: true,
					stream_options: { include_usage: true },
				}),
			)

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.messages[0].role).toBe("system")
			expect(callArgs.messages[0].content).toBe(systemPrompt)
		})

		it("should handle DeepSeek models differently", async () => {
			jest.spyOn(handler, "getModel").mockReturnValueOnce({
				id: "accounts/fireworks/models/deepseek-test" as any,
				info: {
					maxTokens: 4096,
					contextWindow: 8192,
					supportsImages: false,
					supportsPromptCache: true,
					inputPrice: 3.0,
					outputPrice: 8.0,
					cacheWritesPrice: 3.0,
					cacheReadsPrice: 0.75,
				},
			})

			const stream = handler.createMessage(systemPrompt, messages)
			for await (const chunk of stream) {
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.temperature).toBe(0.7)

			const systemPromptMessage = callArgs.messages.find((msg: { role: string }) => msg.role === "system")
			expect(systemPromptMessage).toBeDefined()
		})

		it("should handle DeepSeek-r1 responses with <think> tags", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: "<think>\n\n</think>\n\nHello! I'm DeepSeek-R1" },
								index: 0,
							},
						],
						usage: null,
					}
					yield {
						choices: [
							{
								delta: {},
								index: 0,
							},
						],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 46,
							total_tokens: 56,
						},
					}
				},
			}))

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toContain("<think>")
			expect(textChunks[0].text).toContain("</think>")

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0].inputTokens).toBe(10)
			expect(usageChunks[0].outputTokens).toBe(46)
		})

		it("should correctly calculate max output tokens when prompt is near context window limit", async () => {
			jest.spyOn(handler, "countTokens").mockResolvedValueOnce(8000)

			jest.spyOn(handler, "getModel").mockReturnValueOnce({
				id: "accounts/fireworks/models/deepseek-v3" as any,
				info: {
					maxTokens: 16000,
					contextWindow: 8192,
					supportsImages: false,
					supportsPromptCache: true,
					inputPrice: 3.0,
					outputPrice: 8.0,
					cacheWritesPrice: 3.0,
					cacheReadsPrice: 0.75,
				},
			})

			const stream = handler.createMessage(systemPrompt, messages)
			for await (const chunk of stream) {
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.max_tokens).toBe(192)
		})

		it("should use model specified in fireworksModelId option", async () => {
			const customModelHandler = new FireworksHandler({
				...mockOptions,
				fireworksModelId: "accounts/fireworks/models/deepseek-v3",
			})

			const stream = customModelHandler.createMessage(systemPrompt, messages)
			for await (const chunk of stream) {
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.model).toBe("accounts/fireworks/models/deepseek-v3")
		})

		it("should prioritize apiModelId over fireworksModelId", async () => {
			const customModelHandler = new FireworksHandler({
				...mockOptions,
				fireworksModelId: "accounts/fireworks/models/deepseek-v3",
				apiModelId: "accounts/fireworks/models/llama-13b",
			})

			const stream = customModelHandler.createMessage(systemPrompt, messages)
			for await (const chunk of stream) {
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.model).toBe("accounts/fireworks/models/llama-13b")
		})

		it("should fall back to default model when invalid model ID is provided", async () => {
			const handlerWithInvalidModel = new FireworksHandler({
				...mockOptions,
				fireworksModelId: "invalid-model-id" as any,
			})

			const stream = handlerWithInvalidModel.createMessage(systemPrompt, messages)
			for await (const chunk of stream) {
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.model).toBe("invalid-model-id")

			expect(handlerWithInvalidModel.getModel().info).toEqual(
				expect.objectContaining({
					contextWindow: expect.any(Number),
				}),
			)
		})

		it("should handle and cap extremely large max_tokens values", async () => {
			jest.spyOn(handler, "getModel").mockReturnValueOnce({
				id: "accounts/fireworks/models/deepseek-v3" as any,
				info: {
					maxTokens: 200000,
					contextWindow: 200000,
					supportsImages: false,
					supportsPromptCache: true,
					inputPrice: 3.0,
					outputPrice: 8.0,
					cacheWritesPrice: 3.0,
					cacheReadsPrice: 0.75,
				},
			})

			const stream = handler.createMessage(systemPrompt, messages)
			for await (const chunk of stream) {
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.max_tokens).toBeLessThanOrEqual(200000)
		})

		it("should handle streaming errors gracefully", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					throw new Error("Streaming interrupted")
				},
			}))

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0].type).toBe("text")
			expect(chunks[0].text).toContain("ERROR")
			expect(chunks[0].text).toContain("Streaming interrupted")
		})

		it("should handle excessively large prompts", async () => {
			jest.spyOn(handler, "countTokens").mockResolvedValueOnce(100000)

			const stream = handler.createMessage(systemPrompt, messages)
			for await (const chunk of stream) {
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.max_tokens).toBeGreaterThanOrEqual(100)
		})
	})

	describe("error handling", () => {
		const testMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text" as const,
						text: "Hello",
					},
				],
			},
		]

		it("should handle 401 API errors (invalid key)", async () => {
			const error = new Error("Invalid API key")
			error.name = "Error"
			;(error as any).status = 401
			mockCreate.mockRejectedValueOnce(error)

			const stream = handler.createMessage("system prompt", testMessages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0].type).toBe("text")
			expect(chunks[0].text).toContain("ERROR: Invalid Fireworks API key")
		})

		it("should handle 429 API errors (rate limit)", async () => {
			const error = new Error("Rate limit exceeded")
			error.name = "Error"
			;(error as any).status = 429
			mockCreate.mockRejectedValueOnce(error)

			const stream = handler.createMessage("system prompt", testMessages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0].type).toBe("text")
			expect(chunks[0].text).toContain("ERROR: Rate limit exceeded")
		})

		it("should handle 400 API errors (bad request)", async () => {
			const error = new Error("Bad request")
			error.name = "Error"
			;(error as any).status = 400
			mockCreate.mockRejectedValueOnce(error)

			const stream = handler.createMessage("system prompt", testMessages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0].type).toBe("text")
			expect(chunks[0].text).toContain("ERROR: Bad request")
		})

		it("should handle generic API errors", async () => {
			const error = new Error("Unknown error")
			mockCreate.mockRejectedValueOnce(error)

			const stream = handler.createMessage("system prompt", testMessages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0].type).toBe("text")
			expect(chunks[0].text).toContain("ERROR: Unknown error")
		})

		it("should handle empty response content", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {},
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
			}))

			const stream = handler.createMessage("system prompt", testMessages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks.length).toBe(1)
			expect(textChunks[0].text).toContain("No content was received from the model")
		})

		it("should handle context window exceedance errors", async () => {
			const error = new Error(
				"This model's maximum context length is 8192 tokens. However, your messages resulted in 10000 tokens",
			)
			error.name = "Error"
			;(error as any).status = 400
			mockCreate.mockRejectedValueOnce(error)

			const stream = handler.createMessage("system prompt", testMessages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0].type).toBe("text")
			expect(chunks[0].text).toContain("ERROR: Bad request")
			expect(chunks[0].text).toContain("prompt that's too large")
		})

		it("should handle network timeouts", async () => {
			const error = new Error("Network timeout")
			error.name = "TimeoutError"
			mockCreate.mockRejectedValueOnce(error)

			const stream = handler.createMessage("system prompt", testMessages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0].type).toBe("text")
			expect(chunks[0].text).toContain("ERROR")
			expect(chunks[0].text).toContain("Network timeout")
		})

		it("should handle connection errors", async () => {
			const error = new Error("Connection refused")
			error.name = "ConnectionError"
			mockCreate.mockRejectedValueOnce(error)

			const stream = handler.createMessage("system prompt", testMessages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0].type).toBe("text")
			expect(chunks[0].text).toContain("ERROR")
			expect(chunks[0].text).toContain("Connection refused")
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: fireworksDefaultModelId,
					messages: [{ role: "user", content: "Test prompt" }],
				}),
			)
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("Fireworks completion error: API Error")
		})

		it("should handle missing API key", async () => {
			const handlerWithoutKey = new FireworksHandler({
				...mockOptions,
				fireworksApiKey: undefined,
			})
			await expect(handlerWithoutKey.completePrompt("Test prompt")).rejects.toThrow(
				"Fireworks API key is required",
			)
		})

		it("should handle empty response", async () => {
			mockCreate.mockImplementationOnce(() => ({
				choices: [{ message: { content: "" } }],
			}))
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should use correct parameters for non-streaming completion", async () => {
			await handler.completePrompt("Test prompt with specific parameters")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: expect.any(Number),
					temperature: 0.6,
					top_p: 1,
					presence_penalty: 0,
					frequency_penalty: 0,
				}),
			)
		})

		it("should handle null or malformed API response", async () => {
			mockCreate.mockImplementationOnce(() => ({
				choices: [{ message: null }],
			}))

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should handle multiple choices in response", async () => {
			mockCreate.mockImplementationOnce(() => ({
				choices: [
					{ message: { role: "assistant", content: "Choice 1" }, index: 0 },
					{ message: { role: "assistant", content: "Choice 2" }, index: 1 },
				],
			}))

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Choice 1")
		})

		it("should handle truncated responses", async () => {
			mockCreate.mockImplementationOnce(() => ({
				choices: [
					{
						message: { role: "assistant", content: "Truncated response" },
						finish_reason: "length",
					},
				],
			}))

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Truncated response")
		})

		it("should handle different finish reasons", async () => {
			mockCreate.mockImplementationOnce(() => ({
				choices: [
					{
						message: { role: "assistant", content: "Content filtered" },
						finish_reason: "content_filter",
					},
				],
			}))

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Content filtered")
		})
	})

	describe("getModel", () => {
		it("should return model info with default model", () => {
			const model = handler.getModel()
			expect(model.id).toBe(fireworksDefaultModelId)
			expect(model.info).toBeDefined()
			expect(model.info.contextWindow).toBe(1000000)
			expect(model.info.supportsImages).toBe(true)
		})

		it("should return info for explicitly specified model", () => {
			const customModelHandler = new FireworksHandler({
				...mockOptions,
				fireworksModelId: "accounts/fireworks/models/deepseek-v3" as any,
			})

			const model = customModelHandler.getModel()
			expect(model.id).toBe("accounts/fireworks/models/deepseek-v3")
		})

		it("should fall back to default model info when invalid model is specified", () => {
			const invalidModelHandler = new FireworksHandler({
				...mockOptions,
				fireworksModelId: "nonexistent-model" as any,
			})

			const model = invalidModelHandler.getModel()
			expect(model.id).toBe("nonexistent-model")
			expect(model.info).toBeDefined()
		})

		it("should provide correct info properties for different models", () => {
			const deepseekHandler = new FireworksHandler({
				...mockOptions,
				fireworksModelId: "accounts/fireworks/models/deepseek-r1" as any,
			})

			const llama3Handler = new FireworksHandler({
				...mockOptions,
				fireworksModelId: "accounts/fireworks/models/llama-v3" as any,
			})

			expect(deepseekHandler.getModel().info).toBeDefined()
			expect(llama3Handler.getModel().info).toBeDefined()
		})

		it("should handle model switching", () => {
			const handler = new FireworksHandler({
				...mockOptions,
				fireworksModelId: "accounts/fireworks/models/deepseek-v3" as any,
			})

			expect(handler.getModel().id).toBe("accounts/fireworks/models/deepseek-v3")

			handler["options"].apiModelId = "accounts/fireworks/models/llama-13b" as any

			expect(handler.getModel().id).toBe("accounts/fireworks/models/llama-13b")
		})
	})

	describe("countTokens", () => {
		it("should use base provider's token counting", async () => {
			const baseSpy = jest.spyOn(BaseProvider.prototype, "countTokens").mockResolvedValue(100)

			const content = [{ type: "text" as const, text: "Hello world" }]
			const result = await handler.countTokens(content)

			expect(result).toBe(100)
			expect(baseSpy).toHaveBeenCalledWith(content)

			baseSpy.mockRestore()
		})

		it("should handle empty content for token counting", async () => {
			const content: Anthropic.Messages.ContentBlockParam[] = []
			const result = await handler.countTokens(content)

			expect(result).toBe(0)
		})

		it("should handle image content blocks in token counting", async () => {
			const baseCountSpy = jest
				.spyOn(BaseProvider.prototype, "countTokens")
				.mockImplementation(async (content) => {
					for (const block of content as Anthropic.Messages.ContentBlockParam[]) {
						if (block.type === "image") {
							return 500
						}
					}
					return 10
				})

			const content = [
				{
					type: "image" as const,
					source: {
						type: "base64" as const,
						media_type: "image/jpeg" as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
						data: "mockBase64ImageData",
					},
				},
			]

			const result = await handler.countTokens(content)
			expect(result).toBe(500)
			expect(baseCountSpy).toHaveBeenCalledWith(content)

			baseCountSpy.mockRestore()
		})

		it("should count tokens for mixed text and image content", async () => {
			const baseCountSpy = jest
				.spyOn(BaseProvider.prototype, "countTokens")
				.mockImplementation(async (content) => {
					let totalTokens = 0
					for (const block of content as Anthropic.Messages.ContentBlockParam[]) {
						if (block.type === "image") {
							totalTokens += 500
						} else if (block.type === "text") {
							totalTokens += 10
						}
					}
					return totalTokens
				})

			const content = [
				{ type: "text" as const, text: "Hello world" },
				{
					type: "image" as const,
					source: {
						type: "base64" as const,
						media_type: "image/jpeg" as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
						data: "mockBase64ImageData",
					},
				},
			]

			const result = await handler.countTokens(content)
			expect(result).toBe(510)
			expect(baseCountSpy).toHaveBeenCalledWith(content)

			baseCountSpy.mockRestore()
		})

		it("should handle large text inputs", async () => {
			const veryLongText = "A".repeat(10000)
			const baseCountSpy = jest.spyOn(BaseProvider.prototype, "countTokens").mockResolvedValue(2500)

			const content = [{ type: "text" as const, text: veryLongText }]
			const result = await handler.countTokens(content)

			expect(result).toBe(2500)
			expect(baseCountSpy).toHaveBeenCalledWith(content)

			baseCountSpy.mockRestore()
		})
	})
})

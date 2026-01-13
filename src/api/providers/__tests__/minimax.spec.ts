// npx vitest run src/api/providers/__tests__/minimax.spec.ts

vitest.mock("vscode", () => ({
	workspace: {
		getConfiguration: vitest.fn().mockReturnValue({
			get: vitest.fn().mockReturnValue(600), // Default timeout in seconds
		}),
	},
}))

import { Anthropic } from "@anthropic-ai/sdk"

import { type MinimaxModelId, minimaxDefaultModelId, minimaxModels } from "@roo-code/types"

import { MiniMaxHandler } from "../minimax"

vitest.mock("@anthropic-ai/sdk", () => {
	const mockCreate = vitest.fn()
	return {
		Anthropic: vitest.fn(() => ({
			messages: {
				create: mockCreate,
			},
		})),
	}
})

describe("MiniMaxHandler", () => {
	let handler: MiniMaxHandler
	let mockCreate: any

	beforeEach(() => {
		vitest.clearAllMocks()
		const anthropicInstance = (Anthropic as unknown as any)()
		mockCreate = anthropicInstance.messages.create
	})

	describe("International MiniMax (default)", () => {
		beforeEach(() => {
			handler = new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimax.io/anthropic", // kilocode_change: anthropic
			})
		})

		it("should use the correct international MiniMax base URL by default", () => {
			new MiniMaxHandler({ minimaxApiKey: "test-minimax-api-key" })
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.minimax.io/anthropic",
				}),
			)
		})

		it("should convert /v1 endpoint to /anthropic endpoint", () => {
			new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimax.io/anthropic",
			})
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.minimax.io/anthropic",
				}),
			)
		})

		it("should use the provided API key", () => {
			const minimaxApiKey = "test-minimax-api-key"
			new MiniMaxHandler({ minimaxApiKey })
			expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: minimaxApiKey }))
		})

		it("should return default model when no model is specified", () => {
			const model = handler.getModel()
			expect(model.id).toBe(minimaxDefaultModelId)
			expect(model.info).toEqual(minimaxModels[minimaxDefaultModelId])
		})

		it("should return specified model when valid model is provided", () => {
			const testModelId: MinimaxModelId = "MiniMax-M2"
			const handlerWithModel = new MiniMaxHandler({
				apiModelId: testModelId,
				minimaxApiKey: "test-minimax-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(minimaxModels[testModelId])
		})

		it("should return MiniMax-M2 model with correct configuration", () => {
			const testModelId: MinimaxModelId = "MiniMax-M2"
			const handlerWithModel = new MiniMaxHandler({
				apiModelId: testModelId,
				minimaxApiKey: "test-minimax-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(minimaxModels[testModelId])
			expect(model.info.contextWindow).toBe(192_000)
			expect(model.info.maxTokens).toBe(16_384)
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.cacheWritesPrice).toBe(0.375)
			expect(model.info.cacheReadsPrice).toBe(0.03)
		})

		it("should return MiniMax-M2-Stable model with correct configuration", () => {
			const testModelId: MinimaxModelId = "MiniMax-M2-Stable"
			const handlerWithModel = new MiniMaxHandler({
				apiModelId: testModelId,
				minimaxApiKey: "test-minimax-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(minimaxModels[testModelId])
			expect(model.info.contextWindow).toBe(192_000)
			expect(model.info.maxTokens).toBe(16_384)
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.cacheWritesPrice).toBe(0.375)
			expect(model.info.cacheReadsPrice).toBe(0.03)
		})
	})

	describe("China MiniMax", () => {
		beforeEach(() => {
			handler = new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimaxi.com/anthropic", // kilocode_change: anthropic
			})
		})

		it("should use the correct China MiniMax base URL", () => {
			new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimaxi.com/anthropic", // kilocode_change: anthropic
			})
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({ baseURL: "https://api.minimaxi.com/anthropic" }),
			)
		})

		it("should convert China /v1 endpoint to /anthropic endpoint", () => {
			new MiniMaxHandler({
				minimaxApiKey: "test-minimax-api-key",
				minimaxBaseUrl: "https://api.minimaxi.com/anthropic", // kilocode_change: anthropic
			})
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({ baseURL: "https://api.minimaxi.com/anthropic" }),
			)
		})

		it("should use the provided API key for China", () => {
			const minimaxApiKey = "test-minimax-api-key"
			new MiniMaxHandler({ minimaxApiKey, minimaxBaseUrl: "https://api.minimaxi.com/anthropic" }) // kilocode_change: anthropic
			expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: minimaxApiKey }))
		})

		it("should return default model when no model is specified", () => {
			const model = handler.getModel()
			expect(model.id).toBe(minimaxDefaultModelId)
			expect(model.info).toEqual(minimaxModels[minimaxDefaultModelId])
		})
	})

	describe("Default behavior", () => {
		it("should default to international base URL when none is specified", () => {
			const handlerDefault = new MiniMaxHandler({ minimaxApiKey: "test-minimax-api-key" })
			expect(Anthropic).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.minimax.io/anthropic",
				}),
			)

			const model = handlerDefault.getModel()
			expect(model.id).toBe(minimaxDefaultModelId)
			expect(model.info).toEqual(minimaxModels[minimaxDefaultModelId])
		})

		it("should default to MiniMax-M2 model", () => {
			const handlerDefault = new MiniMaxHandler({ minimaxApiKey: "test-minimax-api-key" })
			const model = handlerDefault.getModel()
			expect(model.id).toBe("MiniMax-M2")
		})
	})

	describe("API Methods", () => {
		beforeEach(() => {
			handler = new MiniMaxHandler({ minimaxApiKey: "test-minimax-api-key" })
		})

		it("completePrompt method should return text from MiniMax API", async () => {
			const expectedResponse = "This is a test response from MiniMax"
			mockCreate.mockResolvedValueOnce({
				content: [{ type: "text", text: expectedResponse }],
			})
			const result = await handler.completePrompt("test prompt")
			expect(result).toBe(expectedResponse)
		})

		it("should handle errors in completePrompt", async () => {
			const errorMessage = "MiniMax API error"
			mockCreate.mockRejectedValueOnce(new Error(errorMessage))
			await expect(handler.completePrompt("test prompt")).rejects.toThrow()
		})

		it("createMessage should yield text content from stream", async () => {
			const testContent = "This is test content from MiniMax stream"

			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					next: vitest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "content_block_start",
								index: 0,
								content_block: { type: "text", text: testContent },
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			expect(firstChunk.value).toEqual({ type: "text", text: testContent })
		})

		it("createMessage should yield usage data from stream", async () => {
			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					next: vitest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "message_start",
								message: {
									usage: {
										input_tokens: 10,
										output_tokens: 20,
									},
								},
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			expect(firstChunk.value).toEqual({ type: "usage", inputTokens: 10, outputTokens: 20 })
		})

		it("createMessage should pass correct parameters to MiniMax client", async () => {
			const modelId: MinimaxModelId = "MiniMax-M2"
			const modelInfo = minimaxModels[modelId]
			const handlerWithModel = new MiniMaxHandler({
				apiModelId: modelId,
				minimaxApiKey: "test-minimax-api-key",
			})

			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			})

			const systemPrompt = "Test system prompt for MiniMax"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for MiniMax" }]

			const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
			await messageGenerator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: modelId,
					max_tokens: Math.min(modelInfo.maxTokens, Math.ceil(modelInfo.contextWindow * 0.2)),
					temperature: 1,
					system: expect.any(Array),
					messages: expect.any(Array),
					stream: true,
				}),
			)
		})

		it("should use temperature 1 by default", async () => {
			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			})

			const messageGenerator = handler.createMessage("test", [])
			await messageGenerator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 1,
				}),
			)
		})

		it("should handle thinking blocks in stream", async () => {
			const thinkingContent = "Let me think about this..."

			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					next: vitest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "content_block_start",
								index: 0,
								content_block: { type: "thinking", thinking: thinkingContent },
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			expect(firstChunk.value).toEqual({ type: "reasoning", text: thinkingContent })
		})

		it("should handle tool calls in stream", async () => {
			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: () => ({
					next: vitest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "content_block_start",
								index: 0,
								content_block: {
									type: "tool_use",
									id: "tool-123",
									name: "get_weather",
									input: { city: "London" },
								},
							},
						})
						.mockResolvedValueOnce({
							done: false,
							value: {
								type: "content_block_stop",
								index: 0,
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			})

			const stream = handler.createMessage("system prompt", [])
			const firstChunk = await stream.next()

			expect(firstChunk.done).toBe(false)
			// Provider now yields tool_call_partial chunks, NativeToolCallParser handles reassembly
			expect(firstChunk.value).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: "tool-123",
				name: "get_weather",
				arguments: undefined,
			})
		})
	})

	describe("Model Configuration", () => {
		it("should correctly configure MiniMax-M2 model properties", () => {
			const model = minimaxModels["MiniMax-M2"]
			expect(model.maxTokens).toBe(16_384)
			expect(model.contextWindow).toBe(192_000)
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(true)
			expect(model.inputPrice).toBe(0.3)
			expect(model.outputPrice).toBe(1.2)
			expect(model.cacheWritesPrice).toBe(0.375)
			expect(model.cacheReadsPrice).toBe(0.03)
		})

		it("should correctly configure MiniMax-M2-Stable model properties", () => {
			const model = minimaxModels["MiniMax-M2-Stable"]
			expect(model.maxTokens).toBe(16_384)
			expect(model.contextWindow).toBe(192_000)
			expect(model.supportsImages).toBe(false)
			expect(model.supportsPromptCache).toBe(true)
			expect(model.inputPrice).toBe(0.3)
			expect(model.outputPrice).toBe(1.2)
			expect(model.cacheWritesPrice).toBe(0.375)
			expect(model.cacheReadsPrice).toBe(0.03)
		})
	})
})

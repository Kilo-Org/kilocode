// npx vitest run src/api/providers/__tests__/fireworks.spec.ts

// Use vi.hoisted to define mock functions that can be referenced in hoisted vi.mock() calls
const { mockStreamText, mockGenerateText } = vi.hoisted(() => ({
	mockStreamText: vi.fn(),
	mockGenerateText: vi.fn(),
}))

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>()
	return {
		...actual,
		streamText: mockStreamText,
		generateText: mockGenerateText,
	}
})

vi.mock("@ai-sdk/fireworks", () => ({
	createFireworks: vi.fn(() => {
		// Return a function that returns a mock language model
		return vi.fn(() => ({
			modelId: "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507",
			provider: "fireworks",
		}))
	}),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import { fireworksDefaultModelId, fireworksModels, type FireworksModelId } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"

import { FireworksHandler } from "../fireworks"

describe("FireworksHandler", () => {
	let handler: FireworksHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			fireworksApiKey: "test-fireworks-api-key",
			apiModelId: "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507",
		}
		handler = new FireworksHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(FireworksHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new FireworksHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe(fireworksDefaultModelId)
		})
	})

	describe("getModel", () => {
		it("should return default model when no model is specified", () => {
			const handlerWithoutModel = new FireworksHandler({
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(fireworksDefaultModelId)
			expect(model.info).toEqual(fireworksModels[fireworksDefaultModelId])
		})

		it("should return specified model when valid model is provided", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(fireworksModels[testModelId])
		})

		it("should return Kimi K2 Instruct model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/kimi-k2-instruct"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 16384,
					contextWindow: 128000,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.6,
					outputPrice: 2.5,
					description: expect.stringContaining("Kimi K2 is a state-of-the-art mixture-of-experts"),
				}),
			)
		})

		it("should return Kimi K2 Thinking model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/kimi-k2-thinking"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 16000,
					contextWindow: 256000,
					supportsImages: false,
					supportsPromptCache: true,
					supportsTemperature: true,
					preserveReasoning: true,
					defaultTemperature: 1.0,
					inputPrice: 0.6,
					outputPrice: 2.5,
					cacheReadsPrice: 0.15,
				}),
			)
		})

		it("should return MiniMax M2 model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/minimax-m2"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 4096,
					contextWindow: 204800,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.3,
					outputPrice: 1.2,
					description: expect.stringContaining("MiniMax M2 is a high-performance language model"),
				}),
			)
		})

		it("should return Qwen3 235B model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 32768,
					contextWindow: 256000,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.22,
					outputPrice: 0.88,
					description:
						"Latest Qwen3 thinking model, competitive against the best closed source models in Jul 2025.",
				}),
			)
		})

		it("should return DeepSeek R1 model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/deepseek-r1-0528"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 20480,
					contextWindow: 160000,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 3,
					outputPrice: 8,
					description: expect.stringContaining("05/28 updated checkpoint of Deepseek R1"),
				}),
			)
		})

		it("should return DeepSeek V3 model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/deepseek-v3"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 16384,
					contextWindow: 128000,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.9,
					outputPrice: 0.9,
					description: expect.stringContaining("strong Mixture-of-Experts (MoE) language model"),
				}),
			)
		})

		it("should return DeepSeek V3.1 model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/deepseek-v3p1"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 16384,
					contextWindow: 163840,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.56,
					outputPrice: 1.68,
					description: expect.stringContaining("DeepSeek v3.1 is an improved version"),
				}),
			)
		})

		it("should return GLM-4.5 model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/glm-4p5"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 16384,
					contextWindow: 128000,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.55,
					outputPrice: 2.19,
					description: expect.stringContaining("Z.ai GLM-4.5 with 355B total parameters"),
				}),
			)
		})

		it("should return GLM-4.5-Air model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/glm-4p5-air"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 16384,
					contextWindow: 128000,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.55,
					outputPrice: 2.19,
					description: expect.stringContaining("Z.ai GLM-4.5-Air with 106B total parameters"),
				}),
			)
		})

		it("should return GLM-4.6 model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/glm-4p6"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 25344,
					contextWindow: 198000,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.55,
					outputPrice: 2.19,
					description: expect.stringContaining("Z.ai GLM-4.6 is an advanced coding model"),
				}),
			)
		})

		it("should return gpt-oss-20b model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/gpt-oss-20b"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 16384,
					contextWindow: 128000,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.07,
					outputPrice: 0.3,
					description: expect.stringContaining(
						"OpenAI gpt-oss-20b: Compact model for local/edge deployments",
					),
				}),
			)
		})

		it("should return gpt-oss-120b model with correct configuration", () => {
			const testModelId: FireworksModelId = "accounts/fireworks/models/gpt-oss-120b"
			const handlerWithModel = new FireworksHandler({
				apiModelId: testModelId,
				fireworksApiKey: "test-fireworks-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 16384,
					contextWindow: 128000,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.15,
					outputPrice: 0.6,
					description: expect.stringContaining(
						"OpenAI gpt-oss-120b: Production-grade, general-purpose model",
					),
				}),
			)
		})

		it("should return provided model ID with default model info if model does not exist", () => {
			const handlerWithInvalidModel = new FireworksHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const model = handlerWithInvalidModel.getModel()
			expect(model.id).toBe("invalid-model")
			expect(model.info).toBeDefined()
			// Should use default model info
			expect(model.info).toBe(fireworksModels[fireworksDefaultModelId])
		})

		it("should include model parameters from getModelParams", () => {
			const model = handler.getModel()
			expect(model).toHaveProperty("temperature")
			expect(model).toHaveProperty("maxTokens")
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

		it("should handle streaming responses", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response from Fireworks" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
			})

			const mockProviderMetadata = Promise.resolve({})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
				providerMetadata: mockProviderMetadata,
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Test response from Fireworks")
		})

		it("should include usage information", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 20,
			})

			const mockProviderMetadata = Promise.resolve({})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
				providerMetadata: mockProviderMetadata,
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBeGreaterThan(0)
			expect(usageChunks[0].inputTokens).toBe(10)
			expect(usageChunks[0].outputTokens).toBe(20)
		})

		it("should handle cached tokens in usage data from providerMetadata", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 100,
				outputTokens: 50,
			})

			// Fireworks provides cache metrics via providerMetadata for supported models
			const mockProviderMetadata = Promise.resolve({
				fireworks: {
					promptCacheHitTokens: 30,
					promptCacheMissTokens: 70,
				},
			})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
				providerMetadata: mockProviderMetadata,
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBeGreaterThan(0)
			expect(usageChunks[0].inputTokens).toBe(100)
			expect(usageChunks[0].outputTokens).toBe(50)
			expect(usageChunks[0].cacheReadTokens).toBe(30)
			expect(usageChunks[0].cacheWriteTokens).toBe(70)
		})

		it("should handle usage with details.cachedInputTokens when providerMetadata is not available", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 100,
				outputTokens: 50,
				details: {
					cachedInputTokens: 25,
				},
			})

			const mockProviderMetadata = Promise.resolve({})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
				providerMetadata: mockProviderMetadata,
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBeGreaterThan(0)
			expect(usageChunks[0].cacheReadTokens).toBe(25)
			expect(usageChunks[0].cacheWriteTokens).toBeUndefined()
		})

		it("should pass correct temperature (0.5 default) to streamText", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const handlerWithDefaultTemp = new FireworksHandler({
				fireworksApiKey: "test-key",
				apiModelId: "accounts/fireworks/models/kimi-k2-instruct",
			})

			const stream = handlerWithDefaultTemp.createMessage(systemPrompt, messages)
			for await (const _ of stream) {
				// consume stream
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.5,
				}),
			)
		})

		it("should use model defaultTemperature (1.0) over provider default (0.5) for kimi-k2-thinking", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const handlerWithThinkingModel = new FireworksHandler({
				fireworksApiKey: "test-key",
				apiModelId: "accounts/fireworks/models/kimi-k2-thinking",
			})

			const stream = handlerWithThinkingModel.createMessage(systemPrompt, messages)
			for await (const _ of stream) {
				// consume stream
			}

			// Model's defaultTemperature (1.0) should take precedence over provider's default (0.5)
			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 1.0,
				}),
			)
		})

		it("should use user-specified temperature over model and provider defaults", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const handlerWithCustomTemp = new FireworksHandler({
				fireworksApiKey: "test-key",
				apiModelId: "accounts/fireworks/models/kimi-k2-thinking",
				modelTemperature: 0.7,
			})

			const stream = handlerWithCustomTemp.createMessage(systemPrompt, messages)
			for await (const _ of stream) {
				// consume stream
			}

			// User-specified temperature should take precedence over everything
			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.7,
				}),
			)
		})

		it("should handle stream with multiple chunks", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Hello" }
				yield { type: "text-delta", text: " world" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 5, outputTokens: 10 }),
				providerMetadata: Promise.resolve({}),
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks[0]).toEqual({ type: "text", text: "Hello" })
			expect(textChunks[1]).toEqual({ type: "text", text: " world" })

			const usageChunks = chunks.filter((c) => c.type === "usage")
			expect(usageChunks[0]).toMatchObject({ type: "usage", inputTokens: 5, outputTokens: 10 })
		})
	})

	describe("completePrompt", () => {
		it("should complete a prompt using generateText", async () => {
			mockGenerateText.mockResolvedValue({
				text: "Test completion from Fireworks",
			})

			const result = await handler.completePrompt("Test prompt")

			expect(result).toBe("Test completion from Fireworks")
			expect(mockGenerateText).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "Test prompt",
				}),
			)
		})

		it("should use default temperature in completePrompt", async () => {
			mockGenerateText.mockResolvedValue({
				text: "Test completion",
			})

			await handler.completePrompt("Test prompt")

			expect(mockGenerateText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.5,
				}),
			)
		})
	})

	describe("processUsageMetrics", () => {
		it("should correctly process usage metrics including cache information from providerMetadata", () => {
			class TestFireworksHandler extends FireworksHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestFireworksHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
			}

			const providerMetadata = {
				fireworks: {
					promptCacheHitTokens: 20,
					promptCacheMissTokens: 80,
				},
			}

			const result = testHandler.testProcessUsageMetrics(usage, providerMetadata)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheWriteTokens).toBe(80)
			expect(result.cacheReadTokens).toBe(20)
		})

		it("should handle missing cache metrics gracefully", () => {
			class TestFireworksHandler extends FireworksHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestFireworksHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheWriteTokens).toBeUndefined()
			expect(result.cacheReadTokens).toBeUndefined()
		})

		it("should include reasoning tokens when provided", () => {
			class TestFireworksHandler extends FireworksHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestFireworksHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
				details: {
					reasoningTokens: 30,
				},
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.reasoningTokens).toBe(30)
		})
	})

	describe("tool handling", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [{ type: "text" as const, text: "Hello!" }],
			},
		]

		it("should handle tool calls in streaming", async () => {
			async function* mockFullStream() {
				yield {
					type: "tool-input-start",
					id: "tool-call-1",
					toolName: "read_file",
				}
				yield {
					type: "tool-input-delta",
					id: "tool-call-1",
					delta: '{"path":"test.ts"}',
				}
				yield {
					type: "tool-input-end",
					id: "tool-call-1",
				}
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
			})

			const mockProviderMetadata = Promise.resolve({})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
				providerMetadata: mockProviderMetadata,
			})

			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: [
					{
						type: "function",
						function: {
							name: "read_file",
							description: "Read a file",
							parameters: {
								type: "object",
								properties: { path: { type: "string" } },
								required: ["path"],
							},
						},
					},
				],
			})

			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const toolCallStartChunks = chunks.filter((c) => c.type === "tool_call_start")
			const toolCallDeltaChunks = chunks.filter((c) => c.type === "tool_call_delta")
			const toolCallEndChunks = chunks.filter((c) => c.type === "tool_call_end")

			expect(toolCallStartChunks.length).toBe(1)
			expect(toolCallStartChunks[0].id).toBe("tool-call-1")
			expect(toolCallStartChunks[0].name).toBe("read_file")

			expect(toolCallDeltaChunks.length).toBe(1)
			expect(toolCallDeltaChunks[0].delta).toBe('{"path":"test.ts"}')

			expect(toolCallEndChunks.length).toBe(1)
			expect(toolCallEndChunks[0].id).toBe("tool-call-1")
		})

		it("should ignore tool-call events to prevent duplicate tools in UI", async () => {
			async function* mockFullStream() {
				yield {
					type: "tool-call",
					toolCallId: "tool-call-1",
					toolName: "read_file",
					input: { path: "test.ts" },
				}
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
			})

			const mockProviderMetadata = Promise.resolve({})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
				providerMetadata: mockProviderMetadata,
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// tool-call events should be ignored (only tool-input-start/delta/end are processed)
			const toolCallChunks = chunks.filter(
				(c) => c.type === "tool_call_start" || c.type === "tool_call_delta" || c.type === "tool_call_end",
			)
			expect(toolCallChunks.length).toBe(0)
		})
	})
})

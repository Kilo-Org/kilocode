// npx vitest run src/api/providers/__tests__/groq.spec.ts

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

vi.mock("@ai-sdk/groq", () => ({
	createGroq: vi.fn(() => {
		// Return a function that returns a mock language model
		return vi.fn(() => ({
			modelId: "moonshotai/kimi-k2-instruct-0905",
			provider: "groq",
		}))
	}),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import { groqDefaultModelId, groqModels, type GroqModelId } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"

import { GroqHandler } from "../groq"

describe("GroqHandler", () => {
	let handler: GroqHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			groqApiKey: "test-groq-api-key",
			apiModelId: "moonshotai/kimi-k2-instruct-0905",
		}
		handler = new GroqHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(GroqHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new GroqHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe(groqDefaultModelId)
		})
	})

	describe("getModel", () => {
		it("should return default model when no model is specified", () => {
			const handlerWithoutModel = new GroqHandler({
				groqApiKey: "test-groq-api-key",
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(groqDefaultModelId)
			expect(model.info).toEqual(groqModels[groqDefaultModelId])
		})

		it("should return specified model when valid model is provided", () => {
			const testModelId: GroqModelId = "llama-3.3-70b-versatile"
			const handlerWithModel = new GroqHandler({
				apiModelId: testModelId,
				groqApiKey: "test-groq-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(groqModels[testModelId])
		})

		it("should return model info for llama-3.1-8b-instant", () => {
			const handlerWithLlama = new GroqHandler({
				...mockOptions,
				apiModelId: "llama-3.1-8b-instant",
			})
			const model = handlerWithLlama.getModel()
			expect(model.id).toBe("llama-3.1-8b-instant")
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(8192)
			expect(model.info.contextWindow).toBe(131072)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(false)
		})

		it("should return model info for kimi-k2 which supports prompt cache", () => {
			const handlerWithKimi = new GroqHandler({
				...mockOptions,
				apiModelId: "moonshotai/kimi-k2-instruct-0905",
			})
			const model = handlerWithKimi.getModel()
			expect(model.id).toBe("moonshotai/kimi-k2-instruct-0905")
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(16384)
			expect(model.info.contextWindow).toBe(262144)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should return provided model ID with default model info if model does not exist", () => {
			const handlerWithInvalidModel = new GroqHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const model = handlerWithInvalidModel.getModel()
			expect(model.id).toBe("invalid-model")
			expect(model.info).toBeDefined()
			// Should use default model info
			expect(model.info).toBe(groqModels[groqDefaultModelId])
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
				yield { type: "text-delta", text: "Test response from Groq" }
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
			expect(textChunks[0].text).toBe("Test response from Groq")
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

			// Groq provides cache metrics via providerMetadata for supported models
			const mockProviderMetadata = Promise.resolve({
				groq: {
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

			const handlerWithDefaultTemp = new GroqHandler({
				groqApiKey: "test-key",
				apiModelId: "llama-3.1-8b-instant",
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
	})

	describe("completePrompt", () => {
		it("should complete a prompt using generateText", async () => {
			mockGenerateText.mockResolvedValue({
				text: "Test completion from Groq",
			})

			const result = await handler.completePrompt("Test prompt")

			expect(result).toBe("Test completion from Groq")
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
			class TestGroqHandler extends GroqHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestGroqHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
			}

			const providerMetadata = {
				groq: {
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
			class TestGroqHandler extends GroqHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestGroqHandler(mockOptions)

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
			class TestGroqHandler extends GroqHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestGroqHandler(mockOptions)

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

			// tool-call events are ignored, so no tool_call chunks should be emitted
			const toolCallChunks = chunks.filter((c) => c.type === "tool_call")
			expect(toolCallChunks.length).toBe(0)
		})
	})

	describe("getMaxOutputTokens", () => {
		it("should return maxTokens from model info", () => {
			class TestGroqHandler extends GroqHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const testHandler = new TestGroqHandler({
				...mockOptions,
				apiModelId: "llama-3.1-8b-instant",
			})
			const result = testHandler.testGetMaxOutputTokens()

			// llama-3.1-8b-instant has maxTokens of 8192
			expect(result).toBe(8192)
		})

		it("should use modelMaxTokens when provided", () => {
			class TestGroqHandler extends GroqHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const customMaxTokens = 5000
			const testHandler = new TestGroqHandler({
				...mockOptions,
				modelMaxTokens: customMaxTokens,
			})

			const result = testHandler.testGetMaxOutputTokens()
			expect(result).toBe(customMaxTokens)
		})
	})
})

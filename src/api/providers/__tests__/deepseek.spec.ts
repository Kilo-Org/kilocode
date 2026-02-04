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

vi.mock("@ai-sdk/deepseek", () => ({
	createDeepSeek: vi.fn(() => {
		// Return a function that returns a mock language model
		return vi.fn(() => ({
			modelId: "deepseek-chat",
			provider: "deepseek",
		}))
	}),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import { deepSeekDefaultModelId, type ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"

import { DeepSeekHandler } from "../deepseek"

describe("DeepSeekHandler", () => {
	let handler: DeepSeekHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			deepSeekApiKey: "test-api-key",
			apiModelId: "deepseek-chat",
			deepSeekBaseUrl: "https://api.deepseek.com",
		}
		handler = new DeepSeekHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(DeepSeekHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe(deepSeekDefaultModelId)
		})

		it("should use default base URL if not provided", () => {
			const handlerWithoutBaseUrl = new DeepSeekHandler({
				...mockOptions,
				deepSeekBaseUrl: undefined,
			})
			expect(handlerWithoutBaseUrl).toBeInstanceOf(DeepSeekHandler)
		})

		it("should use custom base URL if provided", () => {
			const customBaseUrl = "https://custom.deepseek.com/v1"
			const handlerWithCustomUrl = new DeepSeekHandler({
				...mockOptions,
				deepSeekBaseUrl: customBaseUrl,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(DeepSeekHandler)
		})
	})

	describe("getModel", () => {
		it("should return model info for valid model ID", () => {
			const model = handler.getModel()
			expect(model.id).toBe(mockOptions.apiModelId)
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(8192) // deepseek-chat has 8K max
			expect(model.info.contextWindow).toBe(128_000)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(true) // Should be true now
		})

		it("should return correct model info for deepseek-reasoner", () => {
			const handlerWithReasoner = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-reasoner",
			})
			const model = handlerWithReasoner.getModel()
			expect(model.id).toBe("deepseek-reasoner")
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(8192) // deepseek-reasoner has 8K max
			expect(model.info.contextWindow).toBe(128_000)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should have preserveReasoning enabled for deepseek-reasoner to support interleaved thinking", () => {
			// This is critical for DeepSeek's interleaved thinking mode with tool calls.
			// See: https://api-docs.deepseek.com/guides/thinking_mode
			// The reasoning_content needs to be passed back during tool call continuation
			// within the same turn for the model to continue reasoning properly.
			const handlerWithReasoner = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-reasoner",
			})
			const model = handlerWithReasoner.getModel()
			// Cast to ModelInfo to access preserveReasoning which is an optional property
			expect((model.info as ModelInfo).preserveReasoning).toBe(true)
		})

		it("should NOT have preserveReasoning enabled for deepseek-chat", () => {
			// deepseek-chat doesn't use thinking mode, so no need to preserve reasoning
			const model = handler.getModel()
			// Cast to ModelInfo to access preserveReasoning which is an optional property
			expect((model.info as ModelInfo).preserveReasoning).toBeUndefined()
		})

		it("should return provided model ID with default model info if model does not exist", () => {
			const handlerWithInvalidModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const model = handlerWithInvalidModel.getModel()
			expect(model.id).toBe("invalid-model") // Returns provided ID
			expect(model.info).toBeDefined()
			// With the current implementation, it's the same object reference when using default model info
			expect(model.info).toBe(handler.getModel().info)
			// Should have the same base properties
			expect(model.info.contextWindow).toBe(handler.getModel().info.contextWindow)
			// And should have supportsPromptCache set to true
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should return default model if no model ID is provided", () => {
			const handlerWithoutModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(deepSeekDefaultModelId)
			expect(model.info).toBeDefined()
			expect(model.info.supportsPromptCache).toBe(true)
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
			// Mock the fullStream async generator
			// Note: processAiSdkStreamPart expects 'text' property for text-delta type
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			// Mock usage and providerMetadata promises
			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
			})

			const mockProviderMetadata = Promise.resolve({
				deepseek: {
					promptCacheHitTokens: 2,
					promptCacheMissTokens: 8,
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

			expect(chunks.length).toBeGreaterThan(0)
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Test response")
		})

		it("should include usage information", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
			})

			const mockProviderMetadata = Promise.resolve({
				deepseek: {
					promptCacheHitTokens: 2,
					promptCacheMissTokens: 8,
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
			expect(usageChunks[0].inputTokens).toBe(10)
			expect(usageChunks[0].outputTokens).toBe(5)
		})

		it("should include cache metrics in usage information from providerMetadata", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
			})

			// DeepSeek provides cache metrics via providerMetadata
			const mockProviderMetadata = Promise.resolve({
				deepseek: {
					promptCacheHitTokens: 2,
					promptCacheMissTokens: 8,
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
			expect(usageChunks[0].cacheWriteTokens).toBe(8) // promptCacheMissTokens
			expect(usageChunks[0].cacheReadTokens).toBe(2) // promptCacheHitTokens
		})
	})

	describe("completePrompt", () => {
		it("should complete a prompt using generateText", async () => {
			mockGenerateText.mockResolvedValue({
				text: "Test completion",
			})

			const result = await handler.completePrompt("Test prompt")

			expect(result).toBe("Test completion")
			expect(mockGenerateText).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "Test prompt",
				}),
			)
		})
	})

	describe("processUsageMetrics", () => {
		it("should correctly process usage metrics including cache information from providerMetadata", () => {
			// We need to access the protected method, so we'll create a test subclass
			class TestDeepSeekHandler extends DeepSeekHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestDeepSeekHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
			}

			// DeepSeek provides cache metrics via providerMetadata
			const providerMetadata = {
				deepseek: {
					promptCacheHitTokens: 20,
					promptCacheMissTokens: 80,
				},
			}

			const result = testHandler.testProcessUsageMetrics(usage, providerMetadata)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheWriteTokens).toBe(80) // promptCacheMissTokens
			expect(result.cacheReadTokens).toBe(20) // promptCacheHitTokens
		})

		it("should handle usage with details.cachedInputTokens when providerMetadata is not available", () => {
			class TestDeepSeekHandler extends DeepSeekHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestDeepSeekHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
				details: {
					cachedInputTokens: 25,
					reasoningTokens: 30,
				},
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheReadTokens).toBe(25) // from details.cachedInputTokens
			expect(result.cacheWriteTokens).toBeUndefined()
			expect(result.reasoningTokens).toBe(30)
		})

		it("should handle missing cache metrics gracefully", () => {
			class TestDeepSeekHandler extends DeepSeekHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestDeepSeekHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
				// No details or providerMetadata
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheWriteTokens).toBeUndefined()
			expect(result.cacheReadTokens).toBeUndefined()
		})
	})

	describe("reasoning content with deepseek-reasoner", () => {
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

		it("should handle reasoning content in streaming responses for deepseek-reasoner", async () => {
			const reasonerHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-reasoner",
			})

			// Mock the fullStream async generator with reasoning content
			// Note: processAiSdkStreamPart expects 'text' property for reasoning type
			async function* mockFullStream() {
				yield { type: "reasoning", text: "Let me think about this..." }
				yield { type: "reasoning", text: " I'll analyze step by step." }
				yield { type: "text-delta", text: "Test response" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
				details: {
					reasoningTokens: 15,
				},
			})

			const mockProviderMetadata = Promise.resolve({
				deepseek: {
					promptCacheHitTokens: 2,
					promptCacheMissTokens: 8,
				},
			})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
				providerMetadata: mockProviderMetadata,
			})

			const stream = reasonerHandler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should have reasoning chunks
			const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning")
			expect(reasoningChunks.length).toBe(2)
			expect(reasoningChunks[0].text).toBe("Let me think about this...")
			expect(reasoningChunks[1].text).toBe(" I'll analyze step by step.")

			// Should also have text chunks
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks.length).toBe(1)
			expect(textChunks[0].text).toBe("Test response")
		})

		it("should include reasoningTokens in usage for deepseek-reasoner", async () => {
			const reasonerHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-reasoner",
			})

			async function* mockFullStream() {
				yield { type: "reasoning", text: "Thinking..." }
				yield { type: "text-delta", text: "Answer" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
				details: {
					reasoningTokens: 15,
				},
			})

			const mockProviderMetadata = Promise.resolve({})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
				providerMetadata: mockProviderMetadata,
			})

			const stream = reasonerHandler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBe(1)
			expect(usageChunks[0].reasoningTokens).toBe(15)
		})

		it("should handle tool calls with reasoning content", async () => {
			const reasonerHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-reasoner",
			})

			// Mock stream with reasoning followed by tool call via streaming events
			// (tool-input-start/delta/end, NOT tool-call which is ignored to prevent duplicates)
			async function* mockFullStream() {
				yield { type: "reasoning", text: "Let me think about this..." }
				yield { type: "reasoning", text: " I'll analyze step by step." }
				yield { type: "tool-input-start", id: "call_123", toolName: "get_weather" }
				yield { type: "tool-input-delta", id: "call_123", delta: '{"location":"SF"}' }
				yield { type: "tool-input-end", id: "call_123" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
				details: {
					reasoningTokens: 15,
				},
			})

			const mockProviderMetadata = Promise.resolve({
				deepseek: {
					promptCacheHitTokens: 2,
					promptCacheMissTokens: 8,
				},
			})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
				providerMetadata: mockProviderMetadata,
			})

			const tools: any[] = [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get weather",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const stream = reasonerHandler.createMessage(systemPrompt, messages, { taskId: "test", tools })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should have reasoning chunks
			const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning")
			expect(reasoningChunks.length).toBe(2)

			// Should have tool call streaming chunks (start/delta/end, NOT tool_call)
			const toolCallStartChunks = chunks.filter((chunk) => chunk.type === "tool_call_start")
			expect(toolCallStartChunks.length).toBe(1)
			expect(toolCallStartChunks[0].name).toBe("get_weather")
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
			// tool-call events are intentionally ignored because tool-input-start/delta/end
			// already provide complete tool call information. Emitting tool-call would cause
			// duplicate tools in the UI for AI SDK providers (e.g., DeepSeek, Moonshot).
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
			class TestDeepSeekHandler extends DeepSeekHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const testHandler = new TestDeepSeekHandler(mockOptions)
			const result = testHandler.testGetMaxOutputTokens()

			// Default model maxTokens is 8192
			expect(result).toBe(8192)
		})

		it("should use modelMaxTokens when provided", () => {
			class TestDeepSeekHandler extends DeepSeekHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const customMaxTokens = 5000
			const testHandler = new TestDeepSeekHandler({
				...mockOptions,
				modelMaxTokens: customMaxTokens,
			})

			const result = testHandler.testGetMaxOutputTokens()
			expect(result).toBe(customMaxTokens)
		})

		it("should fall back to modelInfo.maxTokens when modelMaxTokens is not provided", () => {
			class TestDeepSeekHandler extends DeepSeekHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const testHandler = new TestDeepSeekHandler(mockOptions)
			const result = testHandler.testGetMaxOutputTokens()

			// deepseek-chat has maxTokens of 8192
			expect(result).toBe(8192)
		})
	})
})

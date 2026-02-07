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

vi.mock("@ai-sdk/openai-compatible", () => ({
	createOpenAICompatible: vi.fn(() => {
		// Return a function that returns a mock language model
		return vi.fn(() => ({
			modelId: "moonshot-chat",
			provider: "moonshot",
		}))
	}),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import { moonshotDefaultModelId } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"

import { MoonshotHandler } from "../moonshot"

describe("MoonshotHandler", () => {
	let handler: MoonshotHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			moonshotApiKey: "test-api-key",
			apiModelId: "moonshot-chat",
			moonshotBaseUrl: "https://api.moonshot.ai/v1",
		}
		handler = new MoonshotHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(MoonshotHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new MoonshotHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe(moonshotDefaultModelId)
		})

		it("should use default base URL if not provided", () => {
			const handlerWithoutBaseUrl = new MoonshotHandler({
				...mockOptions,
				moonshotBaseUrl: undefined,
			})
			expect(handlerWithoutBaseUrl).toBeInstanceOf(MoonshotHandler)
		})

		it("should use chinese base URL if provided", () => {
			const customBaseUrl = "https://api.moonshot.cn/v1"
			const handlerWithCustomUrl = new MoonshotHandler({
				...mockOptions,
				moonshotBaseUrl: customBaseUrl,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(MoonshotHandler)
		})
	})

	describe("getModel", () => {
		it("should return model info for valid model ID", () => {
			const model = handler.getModel()
			expect(model.id).toBe(mockOptions.apiModelId)
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(16000)
			expect(model.info.contextWindow).toBe(262144)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should return provided model ID with default model info if model does not exist", () => {
			const handlerWithInvalidModel = new MoonshotHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const model = handlerWithInvalidModel.getModel()
			expect(model.id).toBe("invalid-model") // Returns provided ID
			expect(model.info).toBeDefined()
			// Should have the same base properties as default model
			expect(model.info.contextWindow).toBe(handler.getModel().info.contextWindow)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should return default model if no model ID is provided", () => {
			const handlerWithoutModel = new MoonshotHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(moonshotDefaultModelId)
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
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			// Mock usage promise
			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
				details: { cachedInputTokens: undefined },
				raw: { cached_tokens: 2 },
			})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
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
				details: {},
				raw: { cached_tokens: 2 },
			})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
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

		it("should include cache metrics in usage information", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			const mockUsage = Promise.resolve({
				inputTokens: 10,
				outputTokens: 5,
				details: {},
				raw: { cached_tokens: 2 },
			})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBeGreaterThan(0)
			expect(usageChunks[0].cacheWriteTokens).toBe(0)
			expect(usageChunks[0].cacheReadTokens).toBe(2)
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
		it("should correctly process usage metrics including cache information", () => {
			// We need to access the protected method, so we'll create a test subclass
			class TestMoonshotHandler extends MoonshotHandler {
				public testProcessUsageMetrics(usage: any) {
					return this.processUsageMetrics(usage)
				}
			}

			const testHandler = new TestMoonshotHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
				details: {},
				raw: {
					cached_tokens: 20,
				},
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheWriteTokens).toBe(0)
			expect(result.cacheReadTokens).toBe(20)
		})

		it("should handle missing cache metrics gracefully", () => {
			class TestMoonshotHandler extends MoonshotHandler {
				public testProcessUsageMetrics(usage: any) {
					return this.processUsageMetrics(usage)
				}
			}

			const testHandler = new TestMoonshotHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
				details: {},
				raw: {},
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheWriteTokens).toBe(0)
			expect(result.cacheReadTokens).toBeUndefined()
		})
	})

	describe("getMaxOutputTokens", () => {
		it("should return maxTokens from model info", () => {
			class TestMoonshotHandler extends MoonshotHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const testHandler = new TestMoonshotHandler(mockOptions)
			const result = testHandler.testGetMaxOutputTokens()

			// Default model maxTokens is 16000 (kimi-k2-thinking)
			expect(result).toBe(16000)
		})

		it("should use modelMaxTokens when provided", () => {
			class TestMoonshotHandler extends MoonshotHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const customMaxTokens = 5000
			const testHandler = new TestMoonshotHandler({
				...mockOptions,
				modelMaxTokens: customMaxTokens,
			})

			const result = testHandler.testGetMaxOutputTokens()
			expect(result).toBe(customMaxTokens)
		})

		it("should fall back to modelInfo.maxTokens when modelMaxTokens is not provided", () => {
			class TestMoonshotHandler extends MoonshotHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const testHandler = new TestMoonshotHandler(mockOptions)
			const result = testHandler.testGetMaxOutputTokens()

			// moonshot-chat is not present in moonshotModels and falls back to default model info (maxTokens 16000)
			expect(result).toBe(16000)
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
				details: {},
				raw: {},
			})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
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

		it("should handle complete tool calls", async () => {
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
				details: {},
				raw: {},
			})

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
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

			const toolCallChunks = chunks.filter((c) => c.type === "tool_call")
			expect(toolCallChunks.length).toBe(1)
			expect(toolCallChunks[0].id).toBe("tool-call-1")
			expect(toolCallChunks[0].name).toBe("read_file")
			expect(toolCallChunks[0].arguments).toBe('{"path":"test.ts"}')
		})
	})
})

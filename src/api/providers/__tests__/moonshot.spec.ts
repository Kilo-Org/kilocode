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

		// kilocode_change start
		it("should expose native tools for kimi-k2.5", () => {
			const strictHandler = new MoonshotHandler({
				...mockOptions,
				apiModelId: "kimi-k2.5",
			})
			const model = strictHandler.getModel()
			const strictModelInfo = model.info as { supportsNativeTools?: boolean; defaultToolProtocol?: string }

			expect(strictModelInfo.supportsNativeTools).toBe(true)
			expect(strictModelInfo.defaultToolProtocol).toBe("native")
			expect(model.info.supportsImages).toBe(true)
		})

		it("should expose image capability for kimi-for-coding", () => {
			const strictHandler = new MoonshotHandler({
				...mockOptions,
				apiModelId: "kimi-for-coding",
			})
			const model = strictHandler.getModel()

			expect(model.info.supportsImages).toBe(true)
		})
		// kilocode_change end
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

		// kilocode_change start
		it("should include prompt_cache_key for moonshot requests when taskId is provided", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({
					inputTokens: 1,
					outputTokens: 1,
					details: {},
					raw: {},
				}),
			})

			for await (const _chunk of handler.createMessage(systemPrompt, messages, { taskId: "task-cache-1" })) {
				// Drain stream
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					providerOptions: {
						moonshot: {
							prompt_cache_key: "task-cache-1",
						},
					},
				}),
			)
		})

		it("should enforce strict thinking temperature/provider options for kimi-k2.5 by default", async () => {
			const strictHandler = new MoonshotHandler({
				...mockOptions,
				apiModelId: "kimi-k2.5",
				modelTemperature: 0.1,
			})

			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({
					inputTokens: 1,
					outputTokens: 1,
					details: {},
					raw: {},
				}),
			})

			for await (const _chunk of strictHandler.createMessage(systemPrompt, messages)) {
				// Drain stream
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 1.0,
					providerOptions: {
						moonshot: {
							thinking: { type: "enabled" },
						},
					},
				}),
			)
		})

		it("should include prompt_cache_key alongside strict thinking controls when taskId is provided", async () => {
			const strictHandler = new MoonshotHandler({
				...mockOptions,
				apiModelId: "kimi-for-coding",
			})

			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({
					inputTokens: 1,
					outputTokens: 1,
					details: {},
					raw: {},
				}),
			})

			for await (const _chunk of strictHandler.createMessage(systemPrompt, messages, { taskId: "task-cache-2" })) {
				// Drain stream
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 1.0,
					providerOptions: {
						moonshot: {
							prompt_cache_key: "task-cache-2",
							thinking: { type: "enabled" },
						},
					},
				}),
			)
		})

		it("should enforce strict thinking temperature/provider options for kimi-for-coding by default", async () => {
			const strictHandler = new MoonshotHandler({
				...mockOptions,
				apiModelId: "kimi-for-coding",
				modelTemperature: 0.1,
			})

			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({
					inputTokens: 1,
					outputTokens: 1,
					details: {},
					raw: {},
				}),
			})

			for await (const _chunk of strictHandler.createMessage(systemPrompt, messages)) {
				// Drain stream
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 1.0,
					providerOptions: {
						moonshot: {
							thinking: { type: "enabled" },
						},
					},
				}),
			)
		})

		it("should enforce strict non-thinking temperature/provider options when reasoning is disabled", async () => {
			const strictHandler = new MoonshotHandler({
				...mockOptions,
				apiModelId: "kimi-for-coding",
				enableReasoningEffort: false,
				modelTemperature: 1.9,
			})

			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test response" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({
					inputTokens: 1,
					outputTokens: 1,
					details: {},
					raw: {},
				}),
			})

			for await (const _chunk of strictHandler.createMessage(systemPrompt, messages)) {
				// Drain stream
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.6,
					providerOptions: {
						moonshot: {
							thinking: { type: "disabled" },
						},
					},
				}),
			)
		})
		// kilocode_change end
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

		// kilocode_change start
		it("should enforce strict thinking controls for completePrompt on strict Kimi models", async () => {
			const strictHandler = new MoonshotHandler({
				...mockOptions,
				apiModelId: "kimi-k2.5",
				enableReasoningEffort: false,
				modelTemperature: 1.8,
			})

			mockGenerateText.mockResolvedValue({
				text: "Test completion",
			})

			await strictHandler.completePrompt("Test prompt")

			expect(mockGenerateText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.6,
					providerOptions: {
						moonshot: {
							thinking: { type: "disabled" },
						},
					},
				}),
			)
		})
		// kilocode_change end
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

			// kilocode_change start
			const toolCallChunks = chunks.filter((c) => c.type === "tool_call")
			expect(toolCallChunks.length).toBe(1)
			expect(toolCallChunks[0].id).toBe("tool-call-1")
			expect(toolCallChunks[0].name).toBe("read_file")
			expect(toolCallChunks[0].arguments).toBe('{"path":"test.ts"}')
			// kilocode_change end
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

		// kilocode_change start
		it("should flush pending tool-input stream as tool_call when tool-input-end is missing", async () => {
			async function* mockFullStream() {
				yield {
					type: "tool-input-start",
					id: "tool-call-2",
					toolName: "read_file",
				}
				yield {
					type: "tool-input-delta",
					id: "tool-call-2",
					delta: '{"path":"missing-end.ts"}',
				}
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({
					inputTokens: 10,
					outputTokens: 5,
					details: {},
					raw: {},
				}),
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
			expect(toolCallChunks).toHaveLength(1)
			expect(toolCallChunks[0]).toMatchObject({
				id: "tool-call-2",
				name: "read_file",
				arguments: '{"path":"missing-end.ts"}',
			})
		})
		// kilocode_change end
	})
})

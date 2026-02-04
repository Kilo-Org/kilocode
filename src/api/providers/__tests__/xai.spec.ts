// npx vitest run api/providers/__tests__/xai.spec.ts

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

vi.mock("@ai-sdk/xai", () => ({
	createXai: vi.fn(() => {
		// Return a function that returns a mock language model
		return vi.fn(() => ({
			modelId: "grok-code-fast-1",
			provider: "xai",
		}))
	}),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import { xaiDefaultModelId, xaiModels, type XAIModelId } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"

import { XAIHandler } from "../xai"

describe("XAIHandler", () => {
	let handler: XAIHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			xaiApiKey: "test-xai-api-key",
			apiModelId: "grok-code-fast-1",
		}
		handler = new XAIHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(XAIHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new XAIHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe(xaiDefaultModelId)
		})
	})

	describe("getModel", () => {
		it("should return default model when no model is specified", () => {
			const handlerWithoutModel = new XAIHandler({
				xaiApiKey: "test-xai-api-key",
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(xaiDefaultModelId)
			expect(model.info).toEqual(xaiModels[xaiDefaultModelId])
		})

		it("should return specified model when valid model is provided", () => {
			const testModelId: XAIModelId = "grok-3"
			const handlerWithModel = new XAIHandler({
				apiModelId: testModelId,
				xaiApiKey: "test-xai-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(xaiModels[testModelId])
		})

		it("should return grok-3-mini model with correct configuration", () => {
			const testModelId: XAIModelId = "grok-3-mini"
			const handlerWithModel = new XAIHandler({
				apiModelId: testModelId,
				xaiApiKey: "test-xai-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 8192,
					contextWindow: 131072,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 0.3,
					outputPrice: 0.5,
				}),
			)
		})

		it("should return grok-4-0709 model with correct configuration", () => {
			const testModelId: XAIModelId = "grok-4-0709"
			const handlerWithModel = new XAIHandler({
				apiModelId: testModelId,
				xaiApiKey: "test-xai-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 8192,
					contextWindow: 256_000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 3.0,
					outputPrice: 15.0,
				}),
			)
		})

		it("should fall back to default model for invalid model ID", () => {
			const handlerWithInvalidModel = new XAIHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const model = handlerWithInvalidModel.getModel()
			expect(model.id).toBe(xaiDefaultModelId)
			expect(model.info).toBe(xaiModels[xaiDefaultModelId])
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
				yield { type: "text-delta", text: "Test response from xAI" }
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
			expect(textChunks[0].text).toBe("Test response from xAI")
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

			// xAI provides cache metrics via providerMetadata for supported models
			const mockProviderMetadata = Promise.resolve({
				xai: {
					cachedPromptTokens: 30,
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

		it("should pass correct temperature (0 default) to streamText", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const handlerWithDefaultTemp = new XAIHandler({
				xaiApiKey: "test-key",
				apiModelId: "grok-code-fast-1",
			})

			const stream = handlerWithDefaultTemp.createMessage(systemPrompt, messages)
			for await (const _ of stream) {
				// consume stream
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0,
				}),
			)
		})

		it("should use user-specified temperature over default", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const handlerWithCustomTemp = new XAIHandler({
				xaiApiKey: "test-key",
				apiModelId: "grok-3",
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

		it("should handle reasoning content from stream", async () => {
			async function* mockFullStream() {
				yield { type: "reasoning-delta", text: "Let me think about this..." }
				yield { type: "text-delta", text: "Here is my answer" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
				providerMetadata: Promise.resolve({}),
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const reasoningChunks = chunks.filter((c) => c.type === "reasoning")
			expect(reasoningChunks).toHaveLength(1)
			expect(reasoningChunks[0].text).toBe("Let me think about this...")

			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Here is my answer")
		})

		it("should handle errors during streaming", async () => {
			const mockError = new Error("API error")
			;(mockError as any).name = "AI_APICallError"
			;(mockError as any).status = 500

			async function* mockFullStream(): AsyncGenerator<never> {
				// This yield is unreachable but needed to satisfy the require-yield lint rule
				yield undefined as never
				throw mockError
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const stream = handler.createMessage(systemPrompt, messages)

			await expect(async () => {
				for await (const _ of stream) {
					// consume stream
				}
			}).rejects.toThrow("xAI")
		})
	})

	describe("completePrompt", () => {
		it("should complete a prompt using generateText", async () => {
			mockGenerateText.mockResolvedValue({
				text: "Test completion from xAI",
			})

			const result = await handler.completePrompt("Test prompt")

			expect(result).toBe("Test completion from xAI")
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
					temperature: 0,
				}),
			)
		})

		it("should handle errors in completePrompt", async () => {
			const mockError = new Error("API error")
			;(mockError as any).name = "AI_APICallError"
			mockGenerateText.mockRejectedValue(mockError)

			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("xAI")
		})
	})

	describe("processUsageMetrics", () => {
		it("should correctly process usage metrics including cache information from providerMetadata", () => {
			class TestXAIHandler extends XAIHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestXAIHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
			}

			const providerMetadata = {
				xai: {
					cachedPromptTokens: 20,
				},
			}

			const result = testHandler.testProcessUsageMetrics(usage, providerMetadata)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheReadTokens).toBe(20)
			// xAI doesn't report cache write tokens separately
			expect(result.cacheWriteTokens).toBeUndefined()
		})

		it("should handle missing cache metrics gracefully", () => {
			class TestXAIHandler extends XAIHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestXAIHandler(mockOptions)

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
			class TestXAIHandler extends XAIHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestXAIHandler(mockOptions)

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

		it("should pass tools to streamText when provided", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const testTools = [
				{
					type: "function" as const,
					function: {
						name: "test_tool",
						description: "A test tool",
						parameters: {
							type: "object",
							properties: {
								arg1: { type: "string", description: "First argument" },
							},
							required: ["arg1"],
						},
					},
				},
			]

			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: testTools,
				tool_choice: "auto",
			})

			for await (const _ of stream) {
				// consume stream
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					tools: expect.any(Object),
					toolChoice: "auto",
				}),
			)
		})
	})

	describe("reasoning effort (mini models)", () => {
		it("should include reasoning effort for grok-3-mini model", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const miniModelHandler = new XAIHandler({
				xaiApiKey: "test-key",
				apiModelId: "grok-3-mini",
				reasoningEffort: "high",
			})

			const stream = miniModelHandler.createMessage("test prompt", [])
			for await (const _ of stream) {
				// consume stream
			}

			// Check that provider options are passed for reasoning
			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					providerOptions: expect.any(Object),
				}),
			)
		})
	})
})

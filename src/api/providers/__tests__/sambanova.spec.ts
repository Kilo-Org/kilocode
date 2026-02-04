// npx vitest run src/api/providers/__tests__/sambanova.spec.ts

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

vi.mock("sambanova-ai-provider", () => ({
	createSambaNova: vi.fn(() => {
		// Return a function that returns a mock language model
		return vi.fn(() => ({
			modelId: "Meta-Llama-3.3-70B-Instruct",
			provider: "sambanova",
		}))
	}),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import { sambaNovaDefaultModelId, sambaNovaModels, type SambaNovaModelId } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"

import { SambaNovaHandler } from "../sambanova"

describe("SambaNovaHandler", () => {
	let handler: SambaNovaHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			sambaNovaApiKey: "test-sambanova-api-key",
			apiModelId: "Meta-Llama-3.3-70B-Instruct",
		}
		handler = new SambaNovaHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(SambaNovaHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new SambaNovaHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe(sambaNovaDefaultModelId)
		})
	})

	describe("getModel", () => {
		it("should return default model when no model is specified", () => {
			const handlerWithoutModel = new SambaNovaHandler({
				sambaNovaApiKey: "test-sambanova-api-key",
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(sambaNovaDefaultModelId)
			expect(model.info).toEqual(sambaNovaModels[sambaNovaDefaultModelId])
		})

		it("should return specified model when valid model is provided", () => {
			const testModelId: SambaNovaModelId = "Meta-Llama-3.3-70B-Instruct"
			const handlerWithModel = new SambaNovaHandler({
				apiModelId: testModelId,
				sambaNovaApiKey: "test-sambanova-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toEqual(sambaNovaModels[testModelId])
		})

		it("should return Meta-Llama-3.1-8B-Instruct model with correct configuration", () => {
			const testModelId: SambaNovaModelId = "Meta-Llama-3.1-8B-Instruct"
			const handlerWithModel = new SambaNovaHandler({
				apiModelId: testModelId,
				sambaNovaApiKey: "test-sambanova-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBeDefined()
			expect(model.info.contextWindow).toBeDefined()
		})

		it("should return provided model ID with default model info if model does not exist", () => {
			const handlerWithInvalidModel = new SambaNovaHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const model = handlerWithInvalidModel.getModel()
			expect(model.id).toBe("invalid-model")
			expect(model.info).toBeDefined()
			// Should use default model info
			expect(model.info).toBe(sambaNovaModels[sambaNovaDefaultModelId])
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
				yield { type: "text-delta", text: "Test response from SambaNova" }
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
			expect(textChunks[0].text).toBe("Test response from SambaNova")
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

			// SambaNova provides cache metrics via providerMetadata for supported models
			const mockProviderMetadata = Promise.resolve({
				sambanova: {
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

		it("should pass correct temperature (0.7 default) to streamText", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const handlerWithDefaultTemp = new SambaNovaHandler({
				sambaNovaApiKey: "test-key",
				apiModelId: "Meta-Llama-3.3-70B-Instruct",
			})

			const stream = handlerWithDefaultTemp.createMessage(systemPrompt, messages)
			for await (const _ of stream) {
				// consume stream
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.7,
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

			const handlerWithCustomTemp = new SambaNovaHandler({
				sambaNovaApiKey: "test-key",
				apiModelId: "Meta-Llama-3.3-70B-Instruct",
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
				text: "Test completion from SambaNova",
			})

			const result = await handler.completePrompt("Test prompt")

			expect(result).toBe("Test completion from SambaNova")
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
					temperature: 0.7,
				}),
			)
		})
	})

	describe("processUsageMetrics", () => {
		it("should correctly process usage metrics including cache information from providerMetadata", () => {
			class TestSambaNovaHandler extends SambaNovaHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestSambaNovaHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
			}

			const providerMetadata = {
				sambanova: {
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
			class TestSambaNovaHandler extends SambaNovaHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestSambaNovaHandler(mockOptions)

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
			class TestSambaNovaHandler extends SambaNovaHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestSambaNovaHandler(mockOptions)

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

	describe("error handling", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [{ type: "text" as const, text: "Hello!" }],
			},
		]

		it("should handle AI SDK errors with handleAiSdkError", async () => {
			// eslint-disable-next-line require-yield
			async function* mockFullStream(): AsyncGenerator<any> {
				throw new Error("API Error")
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
			}).rejects.toThrow("SambaNova: API Error")
		})

		it("should preserve status codes in error handling", async () => {
			const apiError = new Error("Rate limit exceeded")
			;(apiError as any).status = 429

			// eslint-disable-next-line require-yield
			async function* mockFullStream(): AsyncGenerator<any> {
				throw apiError
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const stream = handler.createMessage(systemPrompt, messages)

			try {
				for await (const _ of stream) {
					// consume stream
				}
				expect.fail("Should have thrown an error")
			} catch (error: any) {
				expect(error.message).toContain("SambaNova")
				expect(error.status).toBe(429)
			}
		})
	})
})

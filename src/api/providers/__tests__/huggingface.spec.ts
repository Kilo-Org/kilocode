// npx vitest run src/api/providers/__tests__/huggingface.spec.ts

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
			modelId: "meta-llama/Llama-3.3-70B-Instruct",
			provider: "huggingface",
		}))
	}),
}))

// Mock the fetchers
vi.mock("../fetchers/huggingface", () => ({
	getHuggingFaceModels: vi.fn(() => Promise.resolve({})),
	getCachedHuggingFaceModels: vi.fn(() => ({})),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerOptions } from "../../../shared/api"

import { HuggingFaceHandler } from "../huggingface"

describe("HuggingFaceHandler", () => {
	let handler: HuggingFaceHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			huggingFaceApiKey: "test-huggingface-api-key",
			huggingFaceModelId: "meta-llama/Llama-3.3-70B-Instruct",
		}
		handler = new HuggingFaceHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(HuggingFaceHandler)
			expect(handler.getModel().id).toBe(mockOptions.huggingFaceModelId)
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new HuggingFaceHandler({
				...mockOptions,
				huggingFaceModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe("meta-llama/Llama-3.3-70B-Instruct")
		})

		it("should throw error if API key is not provided", () => {
			expect(() => {
				new HuggingFaceHandler({
					...mockOptions,
					huggingFaceApiKey: undefined,
				})
			}).toThrow("Hugging Face API key is required")
		})
	})

	describe("getModel", () => {
		it("should return default model when no model is specified", () => {
			const handlerWithoutModel = new HuggingFaceHandler({
				huggingFaceApiKey: "test-huggingface-api-key",
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe("meta-llama/Llama-3.3-70B-Instruct")
			expect(model.info).toBeDefined()
		})

		it("should return specified model when valid model is provided", () => {
			const testModelId = "mistralai/Mistral-7B-Instruct-v0.3"
			const handlerWithModel = new HuggingFaceHandler({
				huggingFaceModelId: testModelId,
				huggingFaceApiKey: "test-huggingface-api-key",
			})
			const model = handlerWithModel.getModel()
			expect(model.id).toBe(testModelId)
		})

		it("should include model parameters from getModelParams", () => {
			const model = handler.getModel()
			expect(model).toHaveProperty("temperature")
			expect(model).toHaveProperty("maxTokens")
		})

		it("should return fallback info when model not in cache", () => {
			const model = handler.getModel()
			expect(model.info).toEqual(
				expect.objectContaining({
					maxTokens: 8192,
					contextWindow: 131072,
					supportsImages: false,
					supportsPromptCache: false,
				}),
			)
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
				yield { type: "text-delta", text: "Test response from HuggingFace" }
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
			expect(textChunks[0].text).toBe("Test response from HuggingFace")
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

			// HuggingFace provides cache metrics via providerMetadata for supported models
			const mockProviderMetadata = Promise.resolve({
				huggingface: {
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

			const handlerWithDefaultTemp = new HuggingFaceHandler({
				huggingFaceApiKey: "test-key",
				huggingFaceModelId: "meta-llama/Llama-3.3-70B-Instruct",
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

		it("should use user-specified temperature over provider defaults", async () => {
			async function* mockFullStream() {
				yield { type: "text-delta", text: "Test" }
			}

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
				providerMetadata: Promise.resolve({}),
			})

			const handlerWithCustomTemp = new HuggingFaceHandler({
				huggingFaceApiKey: "test-key",
				huggingFaceModelId: "meta-llama/Llama-3.3-70B-Instruct",
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

		it("should handle errors with handleAiSdkError", async () => {
			async function* mockFullStream(): AsyncGenerator<any> {
				yield { type: "text-delta", text: "" } // Yield something before error to satisfy lint
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
			}).rejects.toThrow("HuggingFace: API Error")
		})
	})

	describe("completePrompt", () => {
		it("should complete a prompt using generateText", async () => {
			mockGenerateText.mockResolvedValue({
				text: "Test completion from HuggingFace",
			})

			const result = await handler.completePrompt("Test prompt")

			expect(result).toBe("Test completion from HuggingFace")
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
			class TestHuggingFaceHandler extends HuggingFaceHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestHuggingFaceHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
			}

			const providerMetadata = {
				huggingface: {
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
			class TestHuggingFaceHandler extends HuggingFaceHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestHuggingFaceHandler(mockOptions)

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
			class TestHuggingFaceHandler extends HuggingFaceHandler {
				public testProcessUsageMetrics(usage: any, providerMetadata?: any) {
					return this.processUsageMetrics(usage, providerMetadata)
				}
			}

			const testHandler = new TestHuggingFaceHandler(mockOptions)

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
	})
})

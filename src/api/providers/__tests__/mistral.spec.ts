// Use vi.hoisted to define mock functions that can be referenced in hoisted vi.mock() calls
const { mockStreamText, mockGenerateText, mockCreateMistral } = vi.hoisted(() => ({
	mockStreamText: vi.fn(),
	mockGenerateText: vi.fn(),
	mockCreateMistral: vi.fn(() => {
		// Return a function that returns a mock language model
		return vi.fn(() => ({
			modelId: "codestral-latest",
			provider: "mistral",
		}))
	}),
}))

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>()
	return {
		...actual,
		streamText: mockStreamText,
		generateText: mockGenerateText,
	}
})

vi.mock("@ai-sdk/mistral", () => ({
	createMistral: mockCreateMistral,
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import { mistralDefaultModelId, mistralModels, type MistralModelId } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"

import { MistralHandler } from "../mistral"

describe("MistralHandler", () => {
	let handler: MistralHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			mistralApiKey: "test-api-key",
			apiModelId: "codestral-latest" as MistralModelId,
		}
		handler = new MistralHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(MistralHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new MistralHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe(mistralDefaultModelId)
		})
	})

	describe("getModel", () => {
		it("should return model info for valid model ID", () => {
			const model = handler.getModel()
			expect(model.id).toBe(mockOptions.apiModelId)
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(8192)
			expect(model.info.contextWindow).toBe(256_000)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(false)
		})

		it("should return provided model ID with default model info if model does not exist", () => {
			const handlerWithInvalidModel = new MistralHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const model = handlerWithInvalidModel.getModel()
			expect(model.id).toBe("invalid-model") // Returns provided ID
			expect(model.info).toBeDefined()
			// Should have the same base properties as default model
			expect(model.info.contextWindow).toBe(mistralModels[mistralDefaultModelId].contextWindow)
		})

		it("should return default model if no model ID is provided", () => {
			const handlerWithoutModel = new MistralHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(mistralDefaultModelId)
			expect(model.info).toBeDefined()
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

		it("should handle reasoning content in streaming responses", async () => {
			// Mock the fullStream async generator with reasoning content
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

			mockStreamText.mockReturnValue({
				fullStream: mockFullStream(),
				usage: mockUsage,
			})

			const stream = handler.createMessage(systemPrompt, messages)
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
		it("should correctly process usage metrics", () => {
			// We need to access the protected method, so we'll create a test subclass
			class TestMistralHandler extends MistralHandler {
				public testProcessUsageMetrics(usage: any) {
					return this.processUsageMetrics(usage)
				}
			}

			const testHandler = new TestMistralHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
				details: {
					cachedInputTokens: 20,
					reasoningTokens: 30,
				},
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheReadTokens).toBe(20)
			expect(result.reasoningTokens).toBe(30)
		})

		it("should handle missing cache metrics gracefully", () => {
			class TestMistralHandler extends MistralHandler {
				public testProcessUsageMetrics(usage: any) {
					return this.processUsageMetrics(usage)
				}
			}

			const testHandler = new TestMistralHandler(mockOptions)

			const usage = {
				inputTokens: 100,
				outputTokens: 50,
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheReadTokens).toBeUndefined()
			expect(result.reasoningTokens).toBeUndefined()
		})
	})

	describe("getMaxOutputTokens", () => {
		it("should return maxTokens from model info", () => {
			class TestMistralHandler extends MistralHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const testHandler = new TestMistralHandler(mockOptions)
			const result = testHandler.testGetMaxOutputTokens()

			// codestral-latest maxTokens is 8192
			expect(result).toBe(8192)
		})

		it("should use modelMaxTokens when provided", () => {
			class TestMistralHandler extends MistralHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const customMaxTokens = 5000
			const testHandler = new TestMistralHandler({
				...mockOptions,
				modelMaxTokens: customMaxTokens,
			})

			const result = testHandler.testGetMaxOutputTokens()
			expect(result).toBe(customMaxTokens)
		})

		it("should fall back to modelInfo.maxTokens when modelMaxTokens is not provided", () => {
			class TestMistralHandler extends MistralHandler {
				public testGetMaxOutputTokens() {
					return this.getMaxOutputTokens()
				}
			}

			const testHandler = new TestMistralHandler(mockOptions)
			const result = testHandler.testGetMaxOutputTokens()

			// codestral-latest has maxTokens of 8192
			expect(result).toBe(8192)
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

		it("should ignore tool-call events to prevent duplicate tools in UI", async () => {
			// tool-call events are intentionally ignored because tool-input-start/delta/end
			// already provide complete tool call information. Emitting tool-call would cause
			// duplicate tools in the UI for AI SDK providers.
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

			// tool-call events are ignored, so no tool_call chunks should be emitted
			const toolCallChunks = chunks.filter((c) => c.type === "tool_call")
			expect(toolCallChunks.length).toBe(0)
		})
	})

	describe("mapToolChoice", () => {
		it("should handle string tool choices", () => {
			class TestMistralHandler extends MistralHandler {
				public testMapToolChoice(toolChoice: any) {
					return this.mapToolChoice(toolChoice)
				}
			}

			const testHandler = new TestMistralHandler(mockOptions)

			expect(testHandler.testMapToolChoice("auto")).toBe("auto")
			expect(testHandler.testMapToolChoice("none")).toBe("none")
			expect(testHandler.testMapToolChoice("required")).toBe("required")
			expect(testHandler.testMapToolChoice("any")).toBe("required")
			expect(testHandler.testMapToolChoice("unknown")).toBe("auto")
		})

		it("should handle object tool choice with function name", () => {
			class TestMistralHandler extends MistralHandler {
				public testMapToolChoice(toolChoice: any) {
					return this.mapToolChoice(toolChoice)
				}
			}

			const testHandler = new TestMistralHandler(mockOptions)

			const result = testHandler.testMapToolChoice({
				type: "function",
				function: { name: "my_tool" },
			})

			expect(result).toEqual({ type: "tool", toolName: "my_tool" })
		})

		it("should return undefined for null or undefined", () => {
			class TestMistralHandler extends MistralHandler {
				public testMapToolChoice(toolChoice: any) {
					return this.mapToolChoice(toolChoice)
				}
			}

			const testHandler = new TestMistralHandler(mockOptions)

			expect(testHandler.testMapToolChoice(null)).toBeUndefined()
			expect(testHandler.testMapToolChoice(undefined)).toBeUndefined()
		})
	})

	describe("Codestral URL handling", () => {
		beforeEach(() => {
			mockCreateMistral.mockClear()
		})

		it("should use default Codestral URL for codestral models", () => {
			new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-latest",
			})

			expect(mockCreateMistral).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://codestral.mistral.ai/v1",
				}),
			)
		})

		it("should use custom Codestral URL when provided", () => {
			new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-latest",
				mistralCodestralUrl: "https://custom.codestral.url/v1",
			})

			expect(mockCreateMistral).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://custom.codestral.url/v1",
				}),
			)
		})

		it("should use default Mistral URL for non-codestral models", () => {
			new MistralHandler({
				...mockOptions,
				apiModelId: "mistral-large-latest",
			})

			expect(mockCreateMistral).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.mistral.ai/v1",
				}),
			)
		})
	})
})

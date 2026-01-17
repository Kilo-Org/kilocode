// npx vitest run src/api/providers/__tests__/anthropic.spec.ts

import { AnthropicHandler } from "../anthropic"
import { ApiHandlerOptions } from "../../../shared/api"

// Mock TelemetryService
vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureException: vitest.fn(),
		},
	},
}))

const mockCreate = vitest.fn()
const mockCountTokens = vitest.fn() // kilocode_change

vitest.mock("@anthropic-ai/sdk", () => {
	const mockAnthropicConstructor = vitest.fn().mockImplementation(() => ({
		messages: {
			create: mockCreate.mockImplementation(async (options) => {
				if (!options.stream) {
					return {
						id: "test-completion",
						content: [{ type: "text", text: "Test response" }],
						role: "assistant",
						model: options.model,
						usage: {
							input_tokens: 10,
							output_tokens: 5,
						},
					}
				}
				return {
					async *[Symbol.asyncIterator]() {
						yield {
							type: "message_start",
							message: {
								usage: {
									input_tokens: 100,
									output_tokens: 50,
									cache_creation_input_tokens: 20,
									cache_read_input_tokens: 10,
								},
							},
						}
						yield {
							type: "content_block_start",
							index: 0,
							content_block: {
								type: "text",
								text: "Hello",
							},
						}
						yield {
							type: "content_block_delta",
							delta: {
								type: "text_delta",
								text: " world",
							},
						}
					},
				}
			}),
			countTokens: mockCountTokens, // kilocode_change
		},
	}))

	return {
		Anthropic: mockAnthropicConstructor,
	}
})

// Import after mock
import { Anthropic } from "@anthropic-ai/sdk"

const mockAnthropicConstructor = vitest.mocked(Anthropic)

describe("AnthropicHandler", () => {
	let handler: AnthropicHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			apiKey: "test-api-key",
			apiModelId: "claude-3-5-sonnet-20241022",
		}
		handler = new AnthropicHandler(mockOptions)
		vitest.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(AnthropicHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should initialize with undefined API key", () => {
			// The SDK will handle API key validation, so we just verify it initializes
			const handlerWithoutKey = new AnthropicHandler({
				...mockOptions,
				apiKey: undefined,
			})
			expect(handlerWithoutKey).toBeInstanceOf(AnthropicHandler)
		})

		it("should use custom base URL if provided", () => {
			const customBaseUrl = "https://custom.anthropic.com"
			const handlerWithCustomUrl = new AnthropicHandler({
				...mockOptions,
				anthropicBaseUrl: customBaseUrl,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(AnthropicHandler)
		})

		it("use apiKey for passing token if anthropicUseAuthToken is not set", () => {
			const handlerWithCustomUrl = new AnthropicHandler({
				...mockOptions,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(AnthropicHandler)
			expect(mockAnthropicConstructor).toHaveBeenCalledTimes(1)
			expect(mockAnthropicConstructor.mock.calls[0]![0]!.apiKey).toEqual("test-api-key")
			expect(mockAnthropicConstructor.mock.calls[0]![0]!.authToken).toBeUndefined()
		})

		it("use apiKey for passing token if anthropicUseAuthToken is set but custom base URL is not given", () => {
			const handlerWithCustomUrl = new AnthropicHandler({
				...mockOptions,
				anthropicUseAuthToken: true,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(AnthropicHandler)
			expect(mockAnthropicConstructor).toHaveBeenCalledTimes(1)
			expect(mockAnthropicConstructor.mock.calls[0]![0]!.apiKey).toEqual("test-api-key")
			expect(mockAnthropicConstructor.mock.calls[0]![0]!.authToken).toBeUndefined()
		})

		it("use authToken for passing token if both of anthropicBaseUrl and anthropicUseAuthToken are set", () => {
			const customBaseUrl = "https://custom.anthropic.com"
			const handlerWithCustomUrl = new AnthropicHandler({
				...mockOptions,
				anthropicBaseUrl: customBaseUrl,
				anthropicUseAuthToken: true,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(AnthropicHandler)
			expect(mockAnthropicConstructor).toHaveBeenCalledTimes(1)
			expect(mockAnthropicConstructor.mock.calls[0]![0]!.authToken).toEqual("test-api-key")
			expect(mockAnthropicConstructor.mock.calls[0]![0]!.apiKey).toBeUndefined()
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."

		it("should handle prompt caching for supported models", async () => {
			const stream = handler.createMessage(systemPrompt, [
				{
					role: "user",
					content: [{ type: "text" as const, text: "First message" }],
				},
				{
					role: "assistant",
					content: [{ type: "text" as const, text: "Response" }],
				},
				{
					role: "user",
					content: [{ type: "text" as const, text: "Second message" }],
				},
			])

			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify usage information
			const usageChunk = chunks.find((chunk) => chunk.type === "usage")
			expect(usageChunk).toBeDefined()
			expect(usageChunk?.inputTokens).toBe(100)
			expect(usageChunk?.outputTokens).toBe(50)
			expect(usageChunk?.cacheWriteTokens).toBe(20)
			expect(usageChunk?.cacheReadTokens).toBe(10)

			// Verify text content
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(2)
			expect(textChunks[0].text).toBe("Hello")
			expect(textChunks[1].text).toBe(" world")

			// Verify API
			expect(mockCreate).toHaveBeenCalled()
		})

		// kilocode_change start
		it("uses anthropicDeploymentName as the model for streaming calls when provided", async () => {
			const handlerWithDeployment = new AnthropicHandler({
				...mockOptions,
				anthropicDeploymentName: "custom-deployment-model",
			})

			const stream = handlerWithDeployment.createMessage(systemPrompt, [
				{
					role: "user",
					content: [{ type: "text" as const, text: "Message" }],
				},
			])

			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// no-op
			}

			expect(mockCreate).toHaveBeenCalled()
			const lastCall = mockCreate.mock.calls[mockCreate.mock.calls.length - 1]?.[0]
			expect(lastCall?.model).toBe("custom-deployment-model")
		})
		// kilocode_change end
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: mockOptions.apiModelId,
				messages: [{ role: "user", content: "Test prompt" }],
				max_tokens: 8192,
				temperature: 0,
				thinking: undefined,
				stream: false,
			})
		})

		// kilocode_change start
		it("uses anthropicDeploymentName as the model for non-streaming calls when provided", async () => {
			const handlerWithDeployment = new AnthropicHandler({
				...mockOptions,
				anthropicDeploymentName: "deployment-complete",
			})

			const result = await handlerWithDeployment.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: "deployment-complete",
				messages: [{ role: "user", content: "Test prompt" }],
				max_tokens: 8192,
				temperature: 0,
				thinking: undefined,
				stream: false,
			})
		})
		// kilocode_change end

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("Anthropic completion error: API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("Anthropic completion error: API Error")
		})

		it("should handle non-text content", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				content: [{ type: "image" }],
			}))
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should handle empty response", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				content: [{ type: "text", text: "" }],
			}))
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})
	})

	describe("getModel", () => {
		it("should return default model if no model ID is provided", () => {
			const handlerWithoutModel = new AnthropicHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBeDefined()
			expect(model.info).toBeDefined()
		})

		it("should return specified model if valid model ID is provided", () => {
			const model = handler.getModel()
			expect(model.id).toBe(mockOptions.apiModelId)
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(8192)
			expect(model.info.contextWindow).toBe(200_000)
			expect(model.info.supportsImages).toBe(true)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("honors custom maxTokens for thinking models", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-3-7-sonnet-20250219:thinking",
				modelMaxTokens: 32_768,
				modelMaxThinkingTokens: 16_384,
			})

			const result = handler.getModel()
			expect(result.maxTokens).toBe(32_768)
			expect(result.reasoningBudget).toEqual(16_384)
			expect(result.temperature).toBe(1.0)
		})

		it("does not honor custom maxTokens for non-thinking models", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-3-7-sonnet-20250219",
				modelMaxTokens: 32_768,
				modelMaxThinkingTokens: 16_384,
			})

			const result = handler.getModel()
			expect(result.maxTokens).toBe(8192)
			expect(result.reasoningBudget).toBeUndefined()
			expect(result.temperature).toBe(0)
		})

		it("should handle Claude 4.5 Sonnet model correctly", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-sonnet-4-5",
			})
			const model = handler.getModel()
			expect(model.id).toBe("claude-sonnet-4-5")
			expect(model.info.maxTokens).toBe(64000)
			expect(model.info.contextWindow).toBe(200000)
			expect(model.info.supportsReasoningBudget).toBe(true)
		})

		it("should enable 1M context for Claude 4.5 Sonnet when beta flag is set", () => {
			const handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-sonnet-4-5",
				anthropicBeta1MContext: true,
			})
			const model = handler.getModel()
			expect(model.info.contextWindow).toBe(1000000)
			expect(model.info.inputPrice).toBe(6.0)
			expect(model.info.outputPrice).toBe(22.5)
		})
	})

	describe("reasoning block filtering", () => {
		const systemPrompt = "You are a helpful assistant."

		it("should filter out internal reasoning blocks before sending to API", async () => {
			handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-3-5-sonnet-20241022",
			})

			// Messages with internal reasoning blocks (from stored conversation history)
			const messagesWithReasoning: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Hello",
				},
				{
					role: "assistant",
					content: [
						{
							type: "reasoning" as any,
							text: "This is internal reasoning that should be filtered",
						},
						{
							type: "text",
							text: "This is the response",
						},
					],
				},
				{
					role: "user",
					content: "Continue",
				},
			]

			const stream = handler.createMessage(systemPrompt, messagesWithReasoning)
			const chunks: any[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify the API was called with filtered messages (no reasoning blocks)
			const calledMessages = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].messages
			expect(calledMessages).toHaveLength(3)

			// Check assistant message - should have reasoning block filtered out
			const assistantMessage = calledMessages.find((m: any) => m.role === "assistant")
			expect(assistantMessage).toBeDefined()
			expect(assistantMessage.content).toEqual([{ type: "text", text: "This is the response" }])

			// Verify reasoning blocks were NOT sent to the API
			expect(assistantMessage.content).not.toContainEqual(expect.objectContaining({ type: "reasoning" }))
		})

		it("should filter empty messages after removing all reasoning blocks", async () => {
			handler = new AnthropicHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-3-5-sonnet-20241022",
			})

			// Message with only reasoning content (should be completely filtered)
			const messagesWithOnlyReasoning: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Hello",
				},
				{
					role: "assistant",
					content: [
						{
							type: "reasoning" as any,
							text: "Only reasoning, no actual text",
						},
					],
				},
				{
					role: "user",
					content: "Continue",
				},
			]

			const stream = handler.createMessage(systemPrompt, messagesWithOnlyReasoning)
			const chunks: any[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify empty message was filtered out
			const calledMessages = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].messages
			expect(calledMessages.length).toBe(2) // Only the two user messages
			expect(calledMessages.every((m: any) => m.role === "user")).toBe(true)
		})
	})

	describe("native tool calling", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [{ type: "text" as const, text: "What's the weather in London?" }],
			},
		]

		const mockTools = [
			{
				type: "function" as const,
				function: {
					name: "get_weather",
					description: "Get the current weather",
					parameters: {
						type: "object",
						properties: {
							location: { type: "string" },
						},
						required: ["location"],
					},
				},
			},
		]

		it("should include tools in request by default (native is default)", async () => {
			// Handler uses native protocol by default via model's defaultToolProtocol
			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: mockTools,
			})

			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// Just consume
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tools: expect.arrayContaining([
						expect.objectContaining({
							name: "get_weather",
							description: "Get the current weather",
							input_schema: expect.objectContaining({
								type: "object",
								properties: expect.objectContaining({
									location: { type: "string" },
								}),
							}),
						}),
					]),
				}),
				expect.anything(),
			)
		})

		it("should include tools even when toolProtocol is set to xml (user preference now ignored)", async () => {
			// XML protocol deprecation: user preference is now ignored when model supports native tools
			const xmlHandler = new AnthropicHandler({
				...mockOptions,
				toolProtocol: "xml",
			})

			const stream = xmlHandler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: mockTools,
			})

			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// Just consume
			}

			// Native is forced when supportsNativeTools===true, so tools should still be included
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tools: expect.arrayContaining([
						expect.objectContaining({
							name: "get_weather",
						}),
					]),
				}),
				expect.anything(),
			)
		})

		it("should not include tools when no tools are provided", async () => {
			// Handler uses native protocol by default
			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
			})

			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// Just consume
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.not.objectContaining({
					tools: expect.anything(),
				}),
				expect.anything(),
			)
		})

		it("should convert tool_choice 'auto' to Anthropic format", async () => {
			// Handler uses native protocol by default
			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: mockTools,
				tool_choice: "auto",
			})

			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// Just consume
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tool_choice: { type: "auto", disable_parallel_tool_use: true },
				}),
				expect.anything(),
			)
		})

		it("should convert tool_choice 'required' to Anthropic 'any' format", async () => {
			// Handler uses native protocol by default
			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: mockTools,
				tool_choice: "required",
			})

			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// Just consume
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tool_choice: { type: "any", disable_parallel_tool_use: true },
				}),
				expect.anything(),
			)
		})

		it("should omit both tools and tool_choice when tool_choice is 'none'", async () => {
			// Handler uses native protocol by default
			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: mockTools,
				tool_choice: "none",
			})

			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// Just consume
			}

			// Verify that neither tools nor tool_choice are included in the request
			expect(mockCreate).toHaveBeenCalledWith(
				expect.not.objectContaining({
					tools: expect.anything(),
				}),
				expect.anything(),
			)
			expect(mockCreate).toHaveBeenCalledWith(
				expect.not.objectContaining({
					tool_choice: expect.anything(),
				}),
				expect.anything(),
			)
		})

		it("should convert specific tool_choice to Anthropic 'tool' format", async () => {
			// Handler uses native protocol by default
			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: mockTools,
				tool_choice: { type: "function" as const, function: { name: "get_weather" } },
			})

			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// Just consume
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tool_choice: { type: "tool", name: "get_weather", disable_parallel_tool_use: true },
				}),
				expect.anything(),
			)
		})

		it("should enable parallel tool calls when parallelToolCalls is true", async () => {
			// Handler uses native protocol by default
			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: mockTools,
				tool_choice: "auto",
				parallelToolCalls: true,
			})

			// Consume the stream to trigger the API call
			for await (const _chunk of stream) {
				// Just consume
			}

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tool_choice: { type: "auto", disable_parallel_tool_use: false },
				}),
				expect.anything(),
			)
		})

		it("should handle tool_use blocks in stream and emit tool_call_partial", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				async *[Symbol.asyncIterator]() {
					yield {
						type: "message_start",
						message: {
							usage: {
								input_tokens: 100,
								output_tokens: 50,
							},
						},
					}
					yield {
						type: "content_block_start",
						index: 0,
						content_block: {
							type: "tool_use",
							id: "toolu_123",
							name: "get_weather",
						},
					}
				},
			}))

			// Handler uses native protocol by default
			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: mockTools,
			})

			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Find the tool_call_partial chunk
			const toolCallChunk = chunks.find((chunk) => chunk.type === "tool_call_partial")
			expect(toolCallChunk).toBeDefined()
			expect(toolCallChunk).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: "toolu_123",
				name: "get_weather",
				arguments: undefined,
			})
		})

		it("should handle input_json_delta in stream and emit tool_call_partial arguments", async () => {
			mockCreate.mockImplementationOnce(async () => ({
				async *[Symbol.asyncIterator]() {
					yield {
						type: "message_start",
						message: {
							usage: {
								input_tokens: 100,
								output_tokens: 50,
							},
						},
					}
					yield {
						type: "content_block_start",
						index: 0,
						content_block: {
							type: "tool_use",
							id: "toolu_123",
							name: "get_weather",
						},
					}
					yield {
						type: "content_block_delta",
						index: 0,
						delta: {
							type: "input_json_delta",
							partial_json: '{"location":',
						},
					}
					yield {
						type: "content_block_delta",
						index: 0,
						delta: {
							type: "input_json_delta",
							partial_json: '"London"}',
						},
					}
					yield {
						type: "content_block_stop",
						index: 0,
					}
				},
			}))

			// Handler uses native protocol by default
			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools: mockTools,
			})

			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Find the tool_call_partial chunks
			const toolCallChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
			expect(toolCallChunks).toHaveLength(3)

			// First chunk has id and name
			expect(toolCallChunks[0]).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: "toolu_123",
				name: "get_weather",
				arguments: undefined,
			})

			// Subsequent chunks have arguments
			expect(toolCallChunks[1]).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: undefined,
				name: undefined,
				arguments: '{"location":',
			})

			expect(toolCallChunks[2]).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: undefined,
				name: undefined,
				arguments: '"London"}',
			})
		})
	})
	// kilocode_change start
	describe("countTokens", () => {
		it("uses the internal model ID when no deployment name is provided", async () => {
			mockCountTokens.mockResolvedValueOnce({ input_tokens: 123 })

			const content = [{ type: "text" as const, text: "Hello tokens" }]
			const result = await handler.countTokens(content as any)

			expect(mockCountTokens).toHaveBeenCalledWith({
				model: mockOptions.apiModelId,
				messages: [{ role: "user", content }],
			})
			expect(result).toBe(123)
		})

		it("uses anthropicDeploymentName as the model for token counting when provided", async () => {
			mockCountTokens.mockResolvedValueOnce({ input_tokens: 456 })

			const handlerWithDeployment = new AnthropicHandler({
				...mockOptions,
				anthropicDeploymentName: "deployment-token-counter",
			})

			const content = [{ type: "text" as const, text: "Hello tokens" }]
			const result = await handlerWithDeployment.countTokens(content as any)

			expect(mockCountTokens).toHaveBeenCalledWith({
				model: "deployment-token-counter",
				messages: [{ role: "user", content }],
			})
			expect(result).toBe(456)
		})
	})
	// kilocode_change end
})

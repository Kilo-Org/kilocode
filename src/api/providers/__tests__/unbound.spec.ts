// npx vitest run src/api/providers/__tests__/unbound.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { ApiHandlerOptions } from "../../../shared/api"

import { UnboundHandler } from "../unbound"

// Mock dependencies
vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"anthropic/claude-3-5-sonnet-20241022": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				supportsNativeTools: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 3.5 Sonnet",
				thinking: false,
			},
			"anthropic/claude-sonnet-4-5": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				supportsNativeTools: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 4.5 Sonnet",
				thinking: false,
			},
			"anthropic/claude-3-7-sonnet-20250219": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				supportsNativeTools: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 3.7 Sonnet",
				thinking: false,
			},
			"openai/gpt-4o": {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				supportsNativeTools: true,
				inputPrice: 5,
				outputPrice: 15,
				description: "GPT-4o",
			},
			"openai/o3-mini": {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				supportsNativeTools: true,
				inputPrice: 1,
				outputPrice: 3,
				description: "O3 Mini",
			},
		})
	}),
	getModelsFromCache: vitest.fn().mockReturnValue(undefined),
}))

// Mock OpenAI client
const mockCreate = vitest.fn()
const mockWithResponse = vitest.fn()

vitest.mock("openai", () => {
	return {
		__esModule: true,
		default: vitest.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: (...args: any[]) => {
						const stream = {
							[Symbol.asyncIterator]: async function* () {
								// First chunk with content
								yield {
									choices: [{ delta: { content: "Test response" }, index: 0 }],
								}
								// Second chunk with usage data
								yield {
									choices: [{ delta: {}, index: 0 }],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
									},
								}
								// Third chunk with cache usage data
								yield {
									choices: [{ delta: {}, index: 0 }],
									usage: {
										prompt_tokens: 8,
										completion_tokens: 4,
										total_tokens: 12,
										cache_creation_input_tokens: 3,
										cache_read_input_tokens: 2,
									},
								}
							},
						}

						const result = mockCreate(...args)

						if (args[0].stream) {
							mockWithResponse.mockReturnValue(
								Promise.resolve({ data: stream, response: { headers: new Map() } }),
							)
							result.withResponse = mockWithResponse
						}

						return result
					},
				},
			},
		})),
	}
})

describe("UnboundHandler", () => {
	let handler: UnboundHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			unboundApiKey: "test-api-key",
			unboundModelId: "anthropic/claude-3-5-sonnet-20241022",
		}

		handler = new UnboundHandler(mockOptions)
		mockCreate.mockClear()
		mockWithResponse.mockClear()

		// Default mock implementation for non-streaming responses
		mockCreate.mockResolvedValue({
			id: "test-completion",
			choices: [
				{
					message: { role: "assistant", content: "Test response" },
					finish_reason: "stop",
					index: 0,
				},
			],
		})
	})

	describe("constructor", () => {
		it("should initialize with provided options", async () => {
			expect(handler).toBeInstanceOf(UnboundHandler)
			expect((await handler.fetchModel()).id).toBe(mockOptions.unboundModelId)
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello!",
			},
		]

		it("should handle streaming responses with text and usage data", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: Array<{ type: string } & Record<string, any>> = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(3)

			// Verify text chunk
			expect(chunks[0]).toEqual({ type: "text", text: "Test response" })

			// Verify regular usage data
			expect(chunks[1]).toEqual({ type: "usage", inputTokens: 10, outputTokens: 5 })

			// Verify usage data with cache information
			expect(chunks[2]).toEqual({
				type: "usage",
				inputTokens: 8,
				outputTokens: 4,
				cacheWriteTokens: 3,
				cacheReadTokens: 2,
			})

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "claude-3-5-sonnet-20241022",
					messages: expect.any(Array),
					stream: true,
				}),

				expect.objectContaining({
					headers: {
						"X-Unbound-Metadata": expect.stringContaining("kilo-code"),
					},
				}),
			)
		})

		it("should handle API errors", async () => {
			mockCreate.mockImplementationOnce(() => {
				throw new Error("API Error")
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks = []

			try {
				for await (const chunk of stream) {
					chunks.push(chunk)
				}

				expect.fail("Expected error to be thrown")
			} catch (error) {
				expect(error).toBeInstanceOf(Error)
				expect(error.message).toBe("API Error")
			}
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "claude-3-5-sonnet-20241022",
					messages: [{ role: "user", content: "Test prompt" }],
					temperature: 0,
					max_tokens: 8192,
				}),
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-Unbound-Metadata": expect.stringContaining("kilo-code"),
					}),
				}),
			)
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("Unbound completion error: API Error")
		})

		it("should handle empty response", async () => {
			mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] })
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should not set max_tokens for non-Anthropic models", async () => {
			mockCreate.mockClear()

			const nonAnthropicHandler = new UnboundHandler({
				apiModelId: "openai/gpt-4o",
				unboundApiKey: "test-key",
				unboundModelId: "openai/gpt-4o",
			})

			await nonAnthropicHandler.completePrompt("Test prompt")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "gpt-4o",
					messages: [{ role: "user", content: "Test prompt" }],
					temperature: 0,
				}),
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-Unbound-Metadata": expect.stringContaining("kilo-code"),
					}),
				}),
			)

			expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("max_tokens")
		})

		it("should not set temperature for openai/o3-mini", async () => {
			mockCreate.mockClear()

			const openaiHandler = new UnboundHandler({
				apiModelId: "openai/o3-mini",
				unboundApiKey: "test-key",
				unboundModelId: "openai/o3-mini",
			})

			await openaiHandler.completePrompt("Test prompt")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "o3-mini",
					messages: [{ role: "user", content: "Test prompt" }],
				}),
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-Unbound-Metadata": expect.stringContaining("kilo-code"),
					}),
				}),
			)

			expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("temperature")
		})
	})

	describe("fetchModel", () => {
		it("should return model info", async () => {
			const modelInfo = await handler.fetchModel()
			expect(modelInfo.id).toBe(mockOptions.unboundModelId)
			expect(modelInfo.info).toBeDefined()
		})

		it("should return default model when invalid model provided", async () => {
			const handlerWithInvalidModel = new UnboundHandler({ ...mockOptions, unboundModelId: "invalid/model" })
			const modelInfo = await handlerWithInvalidModel.fetchModel()
			expect(modelInfo.id).toBe("anthropic/claude-sonnet-4-5")
			expect(modelInfo.info).toBeDefined()
		})
	})

	describe("Native Tool Calling", () => {
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

		it("should include tools in request when model supports native tools and tools are provided", async () => {
			mockWithResponse.mockResolvedValueOnce({
				data: {
					[Symbol.asyncIterator]: () => ({
						async next() {
							return { done: true }
						},
					}),
				},
			})

			const messageGenerator = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				toolProtocol: "native",
			})
			await messageGenerator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tools: expect.arrayContaining([
						expect.objectContaining({
							type: "function",
							function: expect.objectContaining({
								name: "test_tool",
							}),
						}),
					]),
					parallel_tool_calls: false,
				}),
				expect.objectContaining({
					headers: {
						"X-Unbound-Metadata": expect.stringContaining("kilo-code"),
					},
				}),
			)
		})

		it("should include tool_choice when provided", async () => {
			mockWithResponse.mockResolvedValueOnce({
				data: {
					[Symbol.asyncIterator]: () => ({
						async next() {
							return { done: true }
						},
					}),
				},
			})

			const messageGenerator = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				toolProtocol: "native",
				tool_choice: "auto",
			})
			await messageGenerator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tool_choice: "auto",
				}),
				expect.objectContaining({
					headers: {
						"X-Unbound-Metadata": expect.stringContaining("kilo-code"),
					},
				}),
			)
		})

		it("should not include tools when toolProtocol is xml", async () => {
			mockWithResponse.mockResolvedValueOnce({
				data: {
					[Symbol.asyncIterator]: () => ({
						async next() {
							return { done: true }
						},
					}),
				},
			})

			const messageGenerator = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				toolProtocol: "xml",
			})
			await messageGenerator.next()

			const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0]
			expect(callArgs).not.toHaveProperty("tools")
			expect(callArgs).not.toHaveProperty("tool_choice")
		})

		it("should yield tool_call_partial chunks during streaming", async () => {
			mockWithResponse.mockResolvedValueOnce({
				data: {
					[Symbol.asyncIterator]: () => ({
						next: vi
							.fn()
							.mockResolvedValueOnce({
								done: false,
								value: {
									choices: [
										{
											delta: {
												tool_calls: [
													{
														index: 0,
														id: "call_123",
														function: {
															name: "test_tool",
															arguments: '{"arg1":',
														},
													},
												],
											},
										},
									],
								},
							})
							.mockResolvedValueOnce({
								done: false,
								value: {
									choices: [
										{
											delta: {
												tool_calls: [
													{
														index: 0,
														function: {
															arguments: '"value"}',
														},
													},
												],
											},
										},
									],
								},
							})
							.mockResolvedValueOnce({ done: true }),
					}),
				},
			})

			const stream = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				toolProtocol: "native",
			})

			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks).toContainEqual({
				type: "tool_call_partial",
				index: 0,
				id: "call_123",
				name: "test_tool",
				arguments: '{"arg1":',
			})

			expect(chunks).toContainEqual({
				type: "tool_call_partial",
				index: 0,
				id: undefined,
				name: undefined,
				arguments: '"value"}',
			})
		})

		it("should set parallel_tool_calls based on metadata", async () => {
			mockWithResponse.mockResolvedValueOnce({
				data: {
					[Symbol.asyncIterator]: () => ({
						async next() {
							return { done: true }
						},
					}),
				},
			})

			const messageGenerator = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				toolProtocol: "native",
				parallelToolCalls: true,
			})
			await messageGenerator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					parallel_tool_calls: true,
				}),
				expect.objectContaining({
					headers: {
						"X-Unbound-Metadata": expect.stringContaining("kilo-code"),
					},
				}),
			)
		})
	})
})

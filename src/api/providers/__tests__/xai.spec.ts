// npx vitest api/providers/__tests__/xai.spec.ts

const mockCreate = vitest.fn()

vitest.mock("openai", () => {
	const mockConstructor = vitest.fn()

	return {
		__esModule: true,
		default: mockConstructor.mockImplementation(() => ({ chat: { completions: { create: mockCreate } } })),
	}
})

import OpenAI from "openai"
import type { Anthropic } from "@anthropic-ai/sdk"

import { xaiDefaultModelId, xaiModels } from "@roo-code/types"

import { XAIHandler } from "../xai"

describe("XAIHandler", () => {
	let handler: XAIHandler

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()
		mockCreate.mockClear()

		// Create handler with mock
		handler = new XAIHandler({})
	})

	it("should use the correct X.AI base URL", () => {
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://api.x.ai/v1",
			}),
		)
	})

	it("should use the provided API key", () => {
		// Clear mocks before this specific test
		vi.clearAllMocks()

		// Create a handler with our API key
		const xaiApiKey = "test-api-key"
		new XAIHandler({ xaiApiKey })

		// Verify the OpenAI constructor was called with our API key
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: xaiApiKey,
			}),
		)
	})

	it("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(xaiDefaultModelId)
		expect(model.info).toEqual(xaiModels[xaiDefaultModelId])
	})

	test("should return specified model when valid model is provided", () => {
		const testModelId = "grok-3"
		const handlerWithModel = new XAIHandler({ apiModelId: testModelId })
		const model = handlerWithModel.getModel()

		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(xaiModels[testModelId])
	})

	it("should include reasoning_effort parameter for mini models", async () => {
		const miniModelHandler = new XAIHandler({
			apiModelId: "grok-3-mini",
			reasoningEffort: "high",
		})

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		// Start generating a message
		const messageGenerator = miniModelHandler.createMessage("test prompt", [])
		await messageGenerator.next() // Start the generator

		// Check that reasoning_effort was included
		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				reasoning_effort: "high",
			}),
		)
	})

	it("should not include reasoning_effort parameter for non-mini models", async () => {
		const regularModelHandler = new XAIHandler({
			apiModelId: "grok-3",
			reasoningEffort: "high",
		})

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		// Start generating a message
		const messageGenerator = regularModelHandler.createMessage("test prompt", [])
		await messageGenerator.next() // Start the generator

		// Check call args for reasoning_effort
		const calls = mockCreate.mock.calls
		const lastCall = calls[calls.length - 1][0]
		expect(lastCall).not.toHaveProperty("reasoning_effort")
	})

	it("completePrompt method should return text from OpenAI API", async () => {
		const expectedResponse = "This is a test response"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })

		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))

		await expect(handler.completePrompt("test prompt")).rejects.toThrow(`xAI completion error: ${errorMessage}`)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content"

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: { content: testContent } }],
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		// Create and consume the stream
		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		// Verify the content
		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "text",
			text: testContent,
		})
	})

	it("createMessage should yield reasoning content from stream", async () => {
		const testReasoning = "Test reasoning content"

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: { reasoning_content: testReasoning } }],
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		// Create and consume the stream
		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		// Verify the reasoning content
		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "reasoning",
			text: testReasoning,
		})
	})

	it("createMessage should yield usage data from stream", async () => {
		// Setup mock for streaming response that includes usage data
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: {} }], // Needs to have choices array to avoid error
								usage: {
									prompt_tokens: 10,
									completion_tokens: 20,
									cache_read_input_tokens: 5,
									cache_creation_input_tokens: 15,
								},
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		// Create and consume the stream
		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		// Verify the usage data
		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 15,
		})
	})

	it("createMessage should pass correct parameters to OpenAI client", async () => {
		// Setup a handler with specific model
		const modelId = "grok-3"
		const modelInfo = xaiModels[modelId]
		const handlerWithModel = new XAIHandler({ apiModelId: modelId })

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		// System prompt and messages
		const systemPrompt = "Test system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message" }]

		// Start generating a message
		const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
		await messageGenerator.next() // Start the generator

		// Check that all parameters were passed correctly
		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: modelId,
				max_tokens: modelInfo.maxTokens,
				temperature: 0,
				messages: expect.arrayContaining([{ role: "system", content: systemPrompt }]),
				stream: true,
				stream_options: { include_usage: true },
			}),
		)
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
			const handlerWithTools = new XAIHandler({ apiModelId: "grok-3" })

			mockCreate.mockImplementationOnce(() => {
				return {
					[Symbol.asyncIterator]: () => ({
						async next() {
							return { done: true }
						},
					}),
				}
			})

			const messageGenerator = handlerWithTools.createMessage("test prompt", [], {
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
			)
		})

		it("should include tool_choice when provided", async () => {
			const handlerWithTools = new XAIHandler({ apiModelId: "grok-3" })

			mockCreate.mockImplementationOnce(() => {
				return {
					[Symbol.asyncIterator]: () => ({
						async next() {
							return { done: true }
						},
					}),
				}
			})

			const messageGenerator = handlerWithTools.createMessage("test prompt", [], {
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
			)
		})

		it("should not include tools when toolProtocol is xml", async () => {
			const handlerWithTools = new XAIHandler({ apiModelId: "grok-3" })

			mockCreate.mockImplementationOnce(() => {
				return {
					[Symbol.asyncIterator]: () => ({
						async next() {
							return { done: true }
						},
					}),
				}
			})

			const messageGenerator = handlerWithTools.createMessage("test prompt", [], {
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
			const handlerWithTools = new XAIHandler({ apiModelId: "grok-3" })

			mockCreate.mockImplementationOnce(() => {
				return {
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
				}
			})

			const stream = handlerWithTools.createMessage("test prompt", [], {
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
			const handlerWithTools = new XAIHandler({ apiModelId: "grok-3" })

			mockCreate.mockImplementationOnce(() => {
				return {
					[Symbol.asyncIterator]: () => ({
						async next() {
							return { done: true }
						},
					}),
				}
			})

			const messageGenerator = handlerWithTools.createMessage("test prompt", [], {
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
			)
		})

		it("should yield tool_call_end events when finish_reason is tool_calls", async () => {
			// Import NativeToolCallParser to set up state
			const { NativeToolCallParser } = await import("../../../core/assistant-message/NativeToolCallParser")

			// Clear any previous state
			NativeToolCallParser.clearRawChunkState()

			const handlerWithTools = new XAIHandler({ apiModelId: "grok-3" })

			mockCreate.mockImplementationOnce(() => {
				return {
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
														id: "call_xai_test",
														function: {
															name: "test_tool",
															arguments: '{"arg1":"value"}',
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
											delta: {},
											finish_reason: "tool_calls",
										},
									],
									usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
								},
							})
							.mockResolvedValueOnce({ done: true }),
					}),
				}
			})

			const stream = handlerWithTools.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				toolProtocol: "native",
			})

			const chunks = []
			for await (const chunk of stream) {
				// Simulate what Task.ts does: when we receive tool_call_partial,
				// process it through NativeToolCallParser to populate rawChunkTracker
				if (chunk.type === "tool_call_partial") {
					NativeToolCallParser.processRawChunk({
						index: chunk.index,
						id: chunk.id,
						name: chunk.name,
						arguments: chunk.arguments,
					})
				}
				chunks.push(chunk)
			}

			// Should have tool_call_partial and tool_call_end
			const partialChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
			const endChunks = chunks.filter((chunk) => chunk.type === "tool_call_end")

			expect(partialChunks).toHaveLength(1)
			expect(endChunks).toHaveLength(1)
			expect(endChunks[0].id).toBe("call_xai_test")
		})
	})
})

// npx vitest api/providers/__tests__/deepinfra.spec.ts

import { deepInfraDefaultModelId, deepInfraDefaultModelInfo } from "@roo-code/types"

const mockCreate = vitest.fn()
const mockWithResponse = vitest.fn()

vitest.mock("openai", () => {
	const mockConstructor = vitest.fn()

	return {
		__esModule: true,
		default: mockConstructor.mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate.mockImplementation(() => ({
						withResponse: mockWithResponse,
					})),
				},
			},
		})),
	}
})

vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockResolvedValue({
		[deepInfraDefaultModelId]: deepInfraDefaultModelInfo,
	}),
	getModelsFromCache: vitest.fn().mockReturnValue(undefined),
}))

import OpenAI from "openai"
import { DeepInfraHandler } from "../deepinfra"

describe("DeepInfraHandler", () => {
	let handler: DeepInfraHandler

	beforeEach(() => {
		vi.clearAllMocks()
		mockCreate.mockClear()
		mockWithResponse.mockClear()

		handler = new DeepInfraHandler({})
	})

	it("should use the correct DeepInfra base URL", () => {
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://api.deepinfra.com/v1/openai",
			}),
		)
	})

	it("should use the provided API key", () => {
		vi.clearAllMocks()

		const deepInfraApiKey = "test-api-key"
		new DeepInfraHandler({ deepInfraApiKey })

		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: deepInfraApiKey,
			}),
		)
	})

	it("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(deepInfraDefaultModelId)
		expect(model.info).toEqual(deepInfraDefaultModelInfo)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content"

		mockWithResponse.mockResolvedValueOnce({
			data: {
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
			},
		})

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "text",
			text: testContent,
		})
	})

	it("createMessage should yield reasoning content from stream", async () => {
		const testReasoning = "Test reasoning content"

		mockWithResponse.mockResolvedValueOnce({
			data: {
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
			},
		})

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "reasoning",
			text: testReasoning,
		})
	})

	it("createMessage should yield usage data from stream", async () => {
		mockWithResponse.mockResolvedValueOnce({
			data: {
				[Symbol.asyncIterator]: () => ({
					next: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: {} }],
								usage: {
									prompt_tokens: 10,
									completion_tokens: 20,
									prompt_tokens_details: {
										cache_write_tokens: 15,
										cached_tokens: 5,
									},
								},
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			},
		})

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheWriteTokens: 15,
			cacheReadTokens: 5,
			totalCost: expect.any(Number),
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
			)
		})
	})

	describe("completePrompt", () => {
		it("should return text from API", async () => {
			const expectedResponse = "This is a test response"
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: { content: expectedResponse } }],
			})

			const result = await handler.completePrompt("test prompt")
			expect(result).toBe(expectedResponse)
		})
	})
})

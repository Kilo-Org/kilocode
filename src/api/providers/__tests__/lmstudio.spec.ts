// Mock OpenAI client - must come before other imports
const mockCreate = vi.fn()
vi.mock("openai", () => {
	return {
		__esModule: true,
		default: vi.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate.mockImplementation(async (options) => {
						if (!options.stream) {
							return {
								id: "test-completion",
								choices: [
									{
										message: { role: "assistant", content: "Test response" },
										finish_reason: "stop",
										index: 0,
									},
								],
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									total_tokens: 15,
								},
							}
						}

						return {
							[Symbol.asyncIterator]: async function* () {
								yield {
									choices: [
										{
											delta: { content: "Test response" },
											index: 0,
										},
									],
									usage: null,
								}
								yield {
									choices: [
										{
											delta: {},
											index: 0,
										},
									],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
									},
								}
							},
						}
					}),
				},
			},
		})),
	}
})

import type { Anthropic } from "@anthropic-ai/sdk"

import { LmStudioHandler } from "../lm-studio"
import type { ApiHandlerOptions } from "../../../shared/api"

describe("LmStudioHandler", () => {
	let handler: LmStudioHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			apiModelId: "local-model",
			lmStudioModelId: "local-model",
			lmStudioBaseUrl: "http://localhost:1234",
		}
		handler = new LmStudioHandler(mockOptions)
		mockCreate.mockClear()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(LmStudioHandler)
			expect(handler.getModel().id).toBe(mockOptions.lmStudioModelId)
		})

		it("should use default base URL if not provided", () => {
			const handlerWithoutUrl = new LmStudioHandler({
				apiModelId: "local-model",
				lmStudioModelId: "local-model",
			})
			expect(handlerWithoutUrl).toBeInstanceOf(LmStudioHandler)
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

		it("should handle streaming responses", async () => {
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

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))

			const stream = handler.createMessage(systemPrompt, messages)

			await expect(async () => {
				for await (const _chunk of stream) {
					// Should not reach here
				}
			}).rejects.toThrow("Please check the LM Studio developer logs to debug what went wrong")
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: mockOptions.lmStudioModelId,
				messages: [{ role: "user", content: "Test prompt" }],
				temperature: 0,
				stream: false,
			})
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(
				"Please check the LM Studio developer logs to debug what went wrong",
			)
		})

		it("should handle empty response", async () => {
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: { content: "" } }],
			})
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})
	})

	describe("getModel", () => {
		it("should return model info", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe(mockOptions.lmStudioModelId)
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBe(-1)
			expect(modelInfo.info.contextWindow).toBe(128_000)
		})
	})
	describe("LmStudioHandler Tool Calling", () => {
		let handler: LmStudioHandler
		let mockOptions: ApiHandlerOptions

		beforeEach(() => {
			mockOptions = {
				apiModelId: "local-model",
				lmStudioModelId: "local-model",
				lmStudioBaseUrl: "http://localhost:1234",
			}
			handler = new LmStudioHandler(mockOptions)
			mockCreate.mockClear()
		})

		describe("createMessage with tool calls", () => {
			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: "Hello!",
				},
			]

			it("should include tool call parameters when tools are provided", async () => {
				mockCreate.mockImplementation(async function* () {
					yield {
						choices: [
							{
								delta: { content: "Test response" },
								index: 0,
							},
						],
						usage: null,
					}
				})

				const stream = handler.createMessage(systemPrompt, messages, {
					tools: ["test_tool" as any],
					taskId: "test-task-id",
				})

				// Consume the stream
				for await (const _ of stream) {
					//
				}

				expect(mockCreate).toHaveBeenCalledWith(
					expect.objectContaining({
						tools: expect.any(Array),
						tool_choice: "auto",
					}),
				)
			})

			it("should yield tool_call chunks when model returns tool calls", async () => {
				const toolCallChunk = {
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "tool-call-1",
										type: "function",
										function: {
											name: "test_tool",
											arguments: '{"param1":"value1"}',
										},
									},
								],
							},
							index: 0,
						},
					],
				}
				const finalChunk = {
					choices: [
						{
							delta: {},
							finish_reason: "tool_calls",
						},
					],
					usage: {
						prompt_tokens: 10,
						completion_tokens: 5,
						total_tokens: 15,
					},
				}

				mockCreate.mockImplementation(async function* () {
					yield toolCallChunk
					yield finalChunk
				})

				const stream = handler.createMessage(systemPrompt, messages, {
					tools: ["test_tool" as any],
					taskId: "test-task-id",
				})

				const chunks: any[] = []
				for await (const chunk of stream) {
					chunks.push(chunk)
				}

				const toolCallChunks = chunks.filter((c) => c.type === "tool_call")
				expect(toolCallChunks.length).toBe(1)
				expect(toolCallChunks[0].toolCalls).toEqual(toolCallChunk.choices[0].delta.tool_calls)
				expect(toolCallChunks[0].toolCallType).toBe("openai")
			})
		})
	})
})

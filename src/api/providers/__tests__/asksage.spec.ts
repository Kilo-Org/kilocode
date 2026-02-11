// npx vitest run api/providers/__tests__/asksage.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { TOOL_PROTOCOL } from "@roo-code/types"

import { AskSageHandler } from "../asksage"
import { ApiHandlerOptions } from "../../../shared/api"
import { Package } from "../../../shared/package"
import { ApiHandlerCreateMessageMetadata } from "../../index"

const mockCreate = vitest.fn()
const mockResolveToolProtocol = vitest.fn()

vitest.mock("openai", () => {
	return {
		default: vitest.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		})),
	}
})

vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))

vitest.mock("../../../utils/resolveToolProtocol", () => ({
	resolveToolProtocol: (...args: any[]) => mockResolveToolProtocol(...args),
}))

vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"gpt-4o-mini": {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 0.15,
				outputPrice: 0.6,
				description: "GPT-4o Mini via AskSage",
			},
		})
	}),
}))

describe("AskSageHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		askSageApiKey: "test-key",
		askSageModelId: "gpt-4o-mini",
	}

	beforeEach(() => vitest.clearAllMocks())

	it("initializes with correct options", () => {
		const handler = new AskSageHandler(mockOptions)
		expect(handler).toBeInstanceOf(AskSageHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://api.asksage.ai/server/v1",
			apiKey: mockOptions.askSageApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://kilocode.ai",
				"X-Title": "Kilo Code",
				"X-KiloCode-Version": Package.version,
				"User-Agent": `Kilo-Code/${Package.version}`,
			},
		})
	})

	it("can use a custom base URL instead of the default", () => {
		const handler = new AskSageHandler({ ...mockOptions, askSageBaseUrl: "https://custom.asksage.ai/v1" })
		expect(handler).toBeInstanceOf(AskSageHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://custom.asksage.ai/v1",
			apiKey: mockOptions.askSageApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://kilocode.ai",
				"X-Title": "Kilo Code",
				"X-KiloCode-Version": Package.version,
				"User-Agent": `Kilo-Code/${Package.version}`,
			},
		})
	})

	describe("fetchModel", () => {
		it("returns correct model info when options are provided", async () => {
			const handler = new AskSageHandler(mockOptions)
			const result = await handler.fetchModel()

			expect(result).toMatchObject({
				id: mockOptions.askSageModelId,
				info: {
					maxTokens: 4096,
					contextWindow: 128000,
					supportsImages: true,
					supportsPromptCache: false,
					inputPrice: 0.15,
					outputPrice: 0.6,
					description: "GPT-4o Mini via AskSage",
				},
			})
		})

		it("returns default model info when options are not provided", async () => {
			const handler = new AskSageHandler({})
			const result = await handler.fetchModel()

			expect(result).toMatchObject({
				id: mockOptions.askSageModelId,
				info: {
					maxTokens: 4096,
					contextWindow: 128000,
					supportsImages: true,
					supportsPromptCache: false,
					inputPrice: 0.15,
					outputPrice: 0.6,
					description: "GPT-4o Mini via AskSage",
				},
			})
		})
	})

	describe("createMessage", () => {
		it("generates correct stream chunks", async () => {
			const handler = new AskSageHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: mockOptions.askSageModelId,
						choices: [{ delta: { content: "test response" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {} }],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 20,
							prompt_tokens_details: {
								caching_tokens: 5,
								cached_tokens: 2,
							},
						},
					}
				},
			}

			mockCreate.mockResolvedValue(mockStream)

			const systemPrompt = "test system prompt"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]

			const generator = handler.createMessage(systemPrompt, messages)
			const chunks = []

			for await (const chunk of generator) {
				chunks.push(chunk)
			}

			// Verify stream chunks
			expect(chunks).toHaveLength(2) // One text chunk and one usage chunk
			expect(chunks[0]).toEqual({ type: "text", text: "test response" })
			expect(chunks[1]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 20,
				cacheWriteTokens: 5,
				cacheReadTokens: 2,
				totalCost: expect.any(Number),
			})

			// Verify OpenAI client was called with correct parameters
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: 4096,
					messages: [
						{
							role: "system",
							content: "test system prompt",
						},
						{
							role: "user",
							content: "test message",
						},
					],
					model: "gpt-4o-mini",
					stream: true,
					stream_options: { include_usage: true },
					temperature: 0,
				}),
			)
		})

		it("handles API errors", async () => {
			const handler = new AskSageHandler(mockOptions)
			const mockError = new Error("API Error")
			mockCreate.mockRejectedValue(mockError)

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("API Error")
		})

		describe("native tool support", () => {
			const systemPrompt = "test system prompt"
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user" as const, content: "What's the weather?" },
			]

			const mockTools: OpenAI.Chat.ChatCompletionTool[] = [
				{
					type: "function",
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

			beforeEach(() => {
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield {
							id: "test-id",
							choices: [{ delta: { content: "test response" } }],
						}
					},
				}
				mockCreate.mockResolvedValue(mockStream)
			})

			it("should include tools in request when toolProtocol is native", async () => {
				mockResolveToolProtocol.mockReturnValue(TOOL_PROTOCOL.NATIVE)

				const metadata: ApiHandlerCreateMessageMetadata = {
					taskId: "test-task",
					tools: mockTools,
					tool_choice: "auto",
				}

				const handler = new AskSageHandler(mockOptions)
				const iterator = handler.createMessage(systemPrompt, messages, metadata)
				await iterator.next()

				expect(mockCreate).toHaveBeenCalledWith(
					expect.objectContaining({
						tools: expect.arrayContaining([
							expect.objectContaining({
								type: "function",
								function: expect.objectContaining({
									name: "get_weather",
									description: "Get the current weather",
								}),
							}),
						]),
						tool_choice: "auto",
					}),
				)
			})

			it("should not include tools when toolProtocol is not native", async () => {
				mockResolveToolProtocol.mockReturnValue(TOOL_PROTOCOL.XML)

				const metadata: ApiHandlerCreateMessageMetadata = {
					taskId: "test-task",
					tools: mockTools,
					tool_choice: "auto",
				}

				const handler = new AskSageHandler(mockOptions)
				const iterator = handler.createMessage(systemPrompt, messages, metadata)
				await iterator.next()

				expect(mockCreate).toHaveBeenCalledWith(
					expect.not.objectContaining({
						tools: expect.anything(),
						tool_choice: expect.anything(),
					}),
				)
			})

			it("should handle tool_call_partial chunks in streaming response", async () => {
				mockResolveToolProtocol.mockReturnValue(TOOL_PROTOCOL.NATIVE)

				const mockStreamWithToolCalls = {
					async *[Symbol.asyncIterator]() {
						yield {
							id: "test-id",
							choices: [
								{
									delta: {
										tool_calls: [
											{
												index: 0,
												id: "call_123",
												function: {
													name: "get_weather",
													arguments: '{"location":',
												},
											},
										],
									},
								},
							],
						}
						yield {
							id: "test-id",
							choices: [
								{
									delta: {
										tool_calls: [
											{
												index: 0,
												function: {
													arguments: '"New York"}',
												},
											},
										],
									},
								},
							],
						}
						yield {
							id: "test-id",
							choices: [{ delta: {} }],
							usage: { prompt_tokens: 10, completion_tokens: 20 },
						}
					},
				}
				mockCreate.mockResolvedValue(mockStreamWithToolCalls)

				const metadata: ApiHandlerCreateMessageMetadata = {
					taskId: "test-task",
					tools: mockTools,
				}

				const handler = new AskSageHandler(mockOptions)
				const chunks = []
				for await (const chunk of handler.createMessage(systemPrompt, messages, metadata)) {
					chunks.push(chunk)
				}

				// Expect two tool_call_partial chunks and one usage chunk
				expect(chunks).toHaveLength(3)
				expect(chunks[0]).toEqual({
					type: "tool_call_partial",
					index: 0,
					id: "call_123",
					name: "get_weather",
					arguments: '{"location":',
				})
				expect(chunks[1]).toEqual({
					type: "tool_call_partial",
					index: 0,
					id: undefined,
					name: undefined,
					arguments: '"New York"}',
				})
				expect(chunks[2]).toMatchObject({
					type: "usage",
					inputTokens: 10,
					outputTokens: 20,
				})
			})
		})
	})

	describe("completePrompt", () => {
		it("returns correct response", async () => {
			const handler = new AskSageHandler(mockOptions)
			const mockResponse = { choices: [{ message: { content: "test completion" } }] }

			mockCreate.mockResolvedValue(mockResponse)

			const result = await handler.completePrompt("test prompt")

			expect(result).toBe("test completion")

			expect(mockCreate).toHaveBeenCalledWith({
				model: mockOptions.askSageModelId,
				max_tokens: 4096,
				messages: [{ role: "system", content: "test prompt" }],
				temperature: 0,
			})
		})

		it("handles API errors", async () => {
			const handler = new AskSageHandler(mockOptions)
			const mockError = new Error("API Error")
			mockCreate.mockRejectedValue(mockError)

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("API Error")
		})

		it("handles unexpected errors", async () => {
			const handler = new AskSageHandler(mockOptions)
			mockCreate.mockRejectedValue(new Error("Unexpected error"))

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("Unexpected error")
		})
	})
})

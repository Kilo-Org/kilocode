// npx vitest run src/api/providers/__tests__/poe.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { NATIVE_TOOL_DEFAULTS, POE_BASE_URL, poeDefaultModelId, poeDefaultModelInfo } from "@roo-code/types"

import { PoeHandler } from "../poe"
import { ApiHandlerOptions } from "../../../shared/api"
import { Package } from "../../../shared/package"
import { ApiHandlerCreateMessageMetadata } from "../../index"

const mockCreate = vitest.fn()

vitest.mock("openai", () => {
	return {
		default: vitest.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate,
				},
			},
			apiKey: "test-key",
		})),
	}
})

// Mock model cache - returns models WITHOUT supportsNativeTools to test NATIVE_TOOL_DEFAULTS merge
vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"gpt-4o": {
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				supportsReasoningEffort: true,
				inputPrice: 2.5,
				outputPrice: 10,
				description: "GPT-4o via Poe",
				// Note: supportsNativeTools is intentionally NOT included
			},
			"claude-sonnet-4": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				supportsReasoningBudget: true,
				inputPrice: 3,
				outputPrice: 15,
				description: "Claude Sonnet 4 via Poe",
			},
		})
	}),
}))

describe("PoeHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		poeApiKey: "test-poe-key",
		poeModelId: "gpt-4o",
	}

	beforeEach(() => vitest.clearAllMocks())

	describe("constructor", () => {
		it("initializes with correct options", () => {
			const handler = new PoeHandler(mockOptions)
			expect(handler).toBeInstanceOf(PoeHandler)

			expect(OpenAI).toHaveBeenCalledWith({
				baseURL: POE_BASE_URL,
				apiKey: mockOptions.poeApiKey,
				defaultHeaders: {
					"HTTP-Referer": "https://kilocode.ai",
					"X-Title": "Kilo Code",
					"X-KiloCode-Version": Package.version,
					"User-Agent": `Kilo-Code/${Package.version}`,
				},
			})
		})

		it("uses default API key when not provided", () => {
			const handler = new PoeHandler({})
			expect(handler).toBeInstanceOf(PoeHandler)

			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					apiKey: "not-provided",
				}),
			)
		})
	})

	describe("getModel", () => {
		it("merges NATIVE_TOOL_DEFAULTS into cached model info", async () => {
			const handler = new PoeHandler(mockOptions)
			const result = await handler.fetchModel()

			// Verify supportsNativeTools is true even though it's not in the cached model
			expect(result.info.supportsNativeTools).toBe(true)
			expect(result.info.defaultToolProtocol).toBe(NATIVE_TOOL_DEFAULTS.defaultToolProtocol)

			// Verify other cached properties are preserved
			expect(result.id).toBe("gpt-4o")
			expect(result.info.maxTokens).toBe(16384)
			expect(result.info.contextWindow).toBe(128000)
			expect(result.info.supportsImages).toBe(true)
		})

		it("returns default model when modelId not specified", async () => {
			const handler = new PoeHandler({ poeApiKey: "test-key" })
			const result = await handler.fetchModel()

			expect(result.id).toBe(poeDefaultModelId)
		})

		it("falls back to default model info when model not in cache", async () => {
			const handler = new PoeHandler({ poeApiKey: "test-key", poeModelId: "unknown-model" })
			const result = await handler.fetchModel()

			// Should fall back to default model info with NATIVE_TOOL_DEFAULTS merged
			expect(result.info.supportsNativeTools).toBe(true)
		})
	})

	describe("createMessage", () => {
		it("generates correct stream chunks for text content", async () => {
			const handler = new PoeHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [{ delta: { content: "Hello " } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: { content: "world!" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {} }],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 20,
						},
					}
				},
			}

			mockCreate.mockResolvedValue(mockStream)

			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "Hello" }]

			const chunks = []
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				chunks.push(chunk)
			}

			expect(chunks).toHaveLength(3)
			expect(chunks[0]).toEqual({ type: "text", text: "Hello " })
			expect(chunks[1]).toEqual({ type: "text", text: "world!" })
			expect(chunks[2]).toMatchObject({
				type: "usage",
				inputTokens: 10,
				outputTokens: 20,
			})
		})

		it("handles reasoning_content in stream", async () => {
			const handler = new PoeHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [{ delta: { reasoning_content: "Let me think..." } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: { content: "The answer is 42" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {} }],
						usage: { prompt_tokens: 10, completion_tokens: 20 },
					}
				},
			}

			mockCreate.mockResolvedValue(mockStream)

			const chunks = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "question" }])) {
				chunks.push(chunk)
			}

			expect(chunks[0]).toEqual({ type: "reasoning", text: "Let me think..." })
			expect(chunks[1]).toEqual({ type: "text", text: "The answer is 42" })
		})

		it("includes tools in request when provided", async () => {
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield { id: "test-id", choices: [{ delta: { content: "test" } }] }
				},
			}
			mockCreate.mockResolvedValue(mockStream)

			const mockTools: OpenAI.Chat.ChatCompletionTool[] = [
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
			]

			const metadata: ApiHandlerCreateMessageMetadata = {
				taskId: "test-task",
				tools: mockTools,
				tool_choice: "auto",
			}

			const handler = new PoeHandler(mockOptions)
			const iterator = handler.createMessage("system", [{ role: "user", content: "read file" }], metadata)
			await iterator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tools: expect.arrayContaining([
						expect.objectContaining({
							type: "function",
							function: expect.objectContaining({
								name: "read_file",
							}),
						}),
					]),
					tool_choice: "auto",
				}),
			)
		})

		it("emits tool_call_partial chunks for streaming tool calls", async () => {
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
											id: "call_abc123",
											function: {
												name: "read_file",
												arguments: '{"path":',
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
												arguments: '"/test.txt"}',
											},
										},
									],
								},
							},
						],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {}, finish_reason: "tool_calls" }],
						usage: { prompt_tokens: 10, completion_tokens: 20 },
					}
				},
			}
			mockCreate.mockResolvedValue(mockStreamWithToolCalls)

			const handler = new PoeHandler(mockOptions)
			const chunks = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "read" }])) {
				chunks.push(chunk)
			}

			// Expect: 2 tool_call_partial, 1 tool_call_end, 1 usage
			expect(chunks).toHaveLength(4)

			expect(chunks[0]).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: "call_abc123",
				name: "read_file",
				arguments: '{"path":',
			})

			expect(chunks[1]).toEqual({
				type: "tool_call_partial",
				index: 0,
				id: undefined,
				name: undefined,
				arguments: '"/test.txt"}',
			})

			// Verify tool_call_end is emitted when finish_reason is "tool_calls"
			expect(chunks[2]).toEqual({
				type: "tool_call_end",
				id: "call_abc123",
			})

			expect(chunks[3]).toMatchObject({
				type: "usage",
				inputTokens: 10,
				outputTokens: 20,
			})
		})

		it("handles multiple concurrent tool calls", async () => {
			const mockStreamWithMultipleTools = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [
							{
								delta: {
									tool_calls: [
										{ index: 0, id: "call_1", function: { name: "tool_a", arguments: "{}" } },
										{ index: 1, id: "call_2", function: { name: "tool_b", arguments: "{}" } },
									],
								},
							},
						],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {}, finish_reason: "tool_calls" }],
						usage: { prompt_tokens: 10, completion_tokens: 20 },
					}
				},
			}
			mockCreate.mockResolvedValue(mockStreamWithMultipleTools)

			const handler = new PoeHandler(mockOptions)
			const chunks = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "test" }])) {
				chunks.push(chunk)
			}

			// 2 tool_call_partial + 2 tool_call_end + 1 usage
			expect(chunks).toHaveLength(5)

			const endChunks = chunks.filter((c) => c.type === "tool_call_end")
			expect(endChunks).toHaveLength(2)
			expect(endChunks.map((c) => c.id).sort()).toEqual(["call_1", "call_2"])
		})

		it("handles API errors", async () => {
			const handler = new PoeHandler(mockOptions)
			const mockError = new Error("API Error")
			mockCreate.mockRejectedValue(mockError)

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow()
		})

		it("processes usage metrics with cache tokens", async () => {
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [{ delta: { content: "test" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {} }],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 50,
							prompt_tokens_details: {
								caching_tokens: 20,
								cached_tokens: 30,
							},
						},
					}
				},
			}
			mockCreate.mockResolvedValue(mockStream)

			const handler = new PoeHandler(mockOptions)
			const chunks = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "test" }])) {
				chunks.push(chunk)
			}

			const usageChunk = chunks.find((c) => c.type === "usage")
			expect(usageChunk).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 20,
				cacheReadTokens: 30,
			})
		})
	})

	describe("getReasoningParams", () => {
		it("uses thinking_budget for Anthropic models", async () => {
			const handler = new PoeHandler({
				poeApiKey: "test-key",
				poeModelId: "claude-sonnet-4",
				modelMaxThinkingTokens: 10000,
				enableReasoningEffort: true,
			})

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield { id: "test-id", choices: [{ delta: { content: "test" } }] }
				},
			}
			mockCreate.mockResolvedValue(mockStream)

			const iterator = handler.createMessage("system", [{ role: "user", content: "test" }])
			await iterator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					thinking_budget: 10000,
				}),
			)
		})

		it("uses reasoning_effort for OpenAI models", async () => {
			const handler = new PoeHandler({
				poeApiKey: "test-key",
				poeModelId: "gpt-4o",
				reasoningEffort: "high",
			})

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield { id: "test-id", choices: [{ delta: { content: "test" } }] }
				},
			}
			mockCreate.mockResolvedValue(mockStream)

			const iterator = handler.createMessage("system", [{ role: "user", content: "test" }])
			await iterator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					reasoning_effort: "high",
				}),
			)
		})

		it("filters out unsupported reasoning_effort values for OpenAI", async () => {
			const handler = new PoeHandler({
				poeApiKey: "test-key",
				poeModelId: "gpt-4o",
				reasoningEffort: "xhigh" as any, // Unsupported value
			})

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield { id: "test-id", choices: [{ delta: { content: "test" } }] }
				},
			}
			mockCreate.mockResolvedValue(mockStream)

			const iterator = handler.createMessage("system", [{ role: "user", content: "test" }])
			await iterator.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.not.objectContaining({
					reasoning_effort: expect.anything(),
				}),
			)
		})
	})

	describe("completePrompt", () => {
		it("returns correct response", async () => {
			const handler = new PoeHandler(mockOptions)
			const mockResponse = { choices: [{ message: { content: "test completion" } }] }

			mockCreate.mockResolvedValue(mockResponse)

			const result = await handler.completePrompt("test prompt")

			expect(result).toBe("test completion")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: mockOptions.poeModelId,
					messages: [{ role: "user", content: "test prompt" }],
				}),
			)
		})

		it("returns empty string when no content", async () => {
			const handler = new PoeHandler(mockOptions)
			const mockResponse = { choices: [{ message: {} }] }

			mockCreate.mockResolvedValue(mockResponse)

			const result = await handler.completePrompt("test prompt")

			expect(result).toBe("")
		})

		it("handles API errors", async () => {
			const handler = new PoeHandler(mockOptions)
			const mockError = new Error("API Error")
			mockCreate.mockRejectedValue(mockError)

			await expect(handler.completePrompt("test prompt")).rejects.toThrow()
		})
	})
})

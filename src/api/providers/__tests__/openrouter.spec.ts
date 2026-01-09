// pnpm --filter roo-cline test api/providers/__tests__/openrouter.spec.ts

vitest.mock("vscode", () => ({}))

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { OpenRouterHandler } from "../openrouter"
import { ApiHandlerOptions } from "../../../shared/api"
import { Package } from "../../../shared/package"

vitest.mock("openai")
vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))

const mockCaptureException = vitest.fn()

vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureException: (...args: unknown[]) => mockCaptureException(...args),
		},
	},
}))

vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"anthropic/claude-sonnet-4": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 3.7 Sonnet",
				thinking: false,
			},
			"anthropic/claude-sonnet-4.5": {
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
			"anthropic/claude-3.7-sonnet:thinking": {
				maxTokens: 128000,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 3.7 Sonnet with thinking",
			},
		})
	}),
}))

describe("OpenRouterHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		openRouterApiKey: "test-key",
		openRouterModelId: "anthropic/claude-sonnet-4",
	}

	beforeEach(() => vitest.clearAllMocks())

	it("initializes with correct options", () => {
		const handler = new OpenRouterHandler(mockOptions)
		expect(handler).toBeInstanceOf(OpenRouterHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://openrouter.ai/api/v1",
			apiKey: mockOptions.openRouterApiKey,
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
			const handler = new OpenRouterHandler(mockOptions)
			const result = await handler.fetchModel()

			expect(result).toMatchObject({
				id: mockOptions.openRouterModelId,
				maxTokens: 8192,
				temperature: 0,
				reasoningEffort: undefined,
				topP: undefined,
			})
		})

		it("returns default model info when options are not provided", async () => {
			const handler = new OpenRouterHandler({})
			const result = await handler.fetchModel()
			expect(result.id).toBe("anthropic/claude-sonnet-4.5")
			expect(result.info.supportsPromptCache).toBe(true)
			expect(result.info.supportsNativeTools).toBe(true)
		})

		it("honors custom maxTokens for thinking models", async () => {
			const handler = new OpenRouterHandler({
				openRouterApiKey: "test-key",
				openRouterModelId: "anthropic/claude-3.7-sonnet:thinking",
				modelMaxTokens: 32_768,
				modelMaxThinkingTokens: 16_384,
			})

			const result = await handler.fetchModel()
			// With the new clamping logic, 128000 tokens (64% of 200000 context window)
			// gets clamped to 20% of context window: 200000 * 0.2 = 40000
			expect(result.maxTokens).toBe(40000)
			expect(result.reasoningBudget).toBeUndefined()
			expect(result.temperature).toBe(0)
		})

		it("does not honor custom maxTokens for non-thinking models", async () => {
			const handler = new OpenRouterHandler({
				...mockOptions,
				modelMaxTokens: 32_768,
				modelMaxThinkingTokens: 16_384,
			})

			const result = await handler.fetchModel()
			expect(result.maxTokens).toBe(8192)
			expect(result.reasoningBudget).toBeUndefined()
			expect(result.temperature).toBe(0)
		})
	})

	describe("createMessage", () => {
		it("generates correct stream chunks", async () => {
			const handler = new OpenRouterHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: mockOptions.openRouterModelId,
						choices: [{ delta: { content: "test response" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {} }],
						usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.001 },
					}
				},
			}

			// Mock OpenAI chat.completions.create
			const mockCreate = vitest.fn().mockResolvedValue(mockStream)

			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

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
			expect(chunks[1]).toEqual({ type: "usage", inputTokens: 10, outputTokens: 20, totalCost: 0.001 })

			// Verify OpenAI client was called with correct parameters.
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: 8192,
					messages: [
						{
							content: [
								{ cache_control: { type: "ephemeral" }, text: "test system prompt", type: "text" },
							],
							role: "system",
						},
						{
							content: [{ cache_control: { type: "ephemeral" }, text: "test message", type: "text" }],
							role: "user",
						},
					],
					model: "anthropic/claude-sonnet-4",
					stream: true,
					stream_options: { include_usage: true },
					temperature: 0,
					top_p: undefined,
					transforms: ["middle-out"],
				}),
				{ headers: { "x-anthropic-beta": "fine-grained-tool-streaming-2025-05-14" } },
			)
		})

		it("supports the middle-out transform", async () => {
			const handler = new OpenRouterHandler({
				...mockOptions,
				openRouterUseMiddleOutTransform: true,
			})
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [{ delta: { content: "test response" } }],
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await handler.createMessage("test", []).next()

			expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ transforms: ["middle-out"] }), {
				headers: { "x-anthropic-beta": "fine-grained-tool-streaming-2025-05-14" },
			})
		})

		it("adds cache control for supported models", async () => {
			const handler = new OpenRouterHandler({
				...mockOptions,
				openRouterModelId: "anthropic/claude-3.5-sonnet",
			})

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [{ delta: { content: "test response" } }],
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "message 1" },
				{ role: "assistant", content: "response 1" },
				{ role: "user", content: "message 2" },
			]

			await handler.createMessage("test system", messages).next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: expect.arrayContaining([
						expect.objectContaining({
							role: "system",
							content: expect.arrayContaining([
								expect.objectContaining({ cache_control: { type: "ephemeral" } }),
							]),
						}),
					]),
				}),
				{ headers: { "x-anthropic-beta": "fine-grained-tool-streaming-2025-05-14" } },
			)
		})

		it("handles API errors and captures telemetry", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield { error: { message: "API Error", code: 500 } }
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("OpenRouter API Error 500: API Error")

			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "API Error",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "createMessage",
					errorCode: 500,
					status: 500,
				}),
			)
		})

		it("captures telemetry when createMessage throws an exception", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockCreate = vitest.fn().mockRejectedValue(new Error("Connection failed"))
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow()

			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Connection failed",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "createMessage",
				}),
			)
		})

		it("passes SDK exceptions with status 429 to telemetry (filtering happens in PostHogTelemetryClient)", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const error = new Error("Rate limit exceeded: free-models-per-day") as any
			error.status = 429

			const mockCreate = vitest.fn().mockRejectedValue(error)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("Rate limit exceeded")

			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Rate limit exceeded: free-models-per-day",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "createMessage",
				}),
			)
		})

		it("passes SDK exceptions with 429 in message to telemetry (filtering happens in PostHogTelemetryClient)", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const error = new Error("429 Rate limit exceeded: free-models-per-day")
			const mockCreate = vitest.fn().mockRejectedValue(error)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("429 Rate limit exceeded")

			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "429 Rate limit exceeded: free-models-per-day",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "createMessage",
				}),
			)
		})

		it("passes SDK exceptions containing 'rate limit' to telemetry (filtering happens in PostHogTelemetryClient)", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const error = new Error("Request failed due to rate limit")
			const mockCreate = vitest.fn().mockRejectedValue(error)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("rate limit")

			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Request failed due to rate limit",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "createMessage",
				}),
			)
		})

		it("passes 429 rate limit errors from stream to telemetry (filtering happens in PostHogTelemetryClient)", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield { error: { message: "Rate limit exceeded", code: 429 } }
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("OpenRouter API Error 429: Rate limit exceeded")

			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Rate limit exceeded",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "createMessage",
					errorCode: 429,
					status: 429,
				}),
			)
		})

		it("yields tool_call_end events when finish_reason is tool_calls", async () => {
			// Import NativeToolCallParser to set up state
			const { NativeToolCallParser } = await import("../../../core/assistant-message/NativeToolCallParser")

			// Clear any previous state
			NativeToolCallParser.clearRawChunkState()

			const handler = new OpenRouterHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [
							{
								delta: {
									tool_calls: [
										{
											index: 0,
											id: "call_openrouter_test",
											function: { name: "read_file", arguments: '{"path":"test.ts"}' },
										},
									],
								},
								index: 0,
							},
						],
					}
					yield {
						id: "test-id",
						choices: [
							{
								delta: {},
								finish_reason: "tool_calls",
								index: 0,
							},
						],
						usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			const chunks = []

			for await (const chunk of generator) {
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
			expect(endChunks[0].id).toBe("call_openrouter_test")
		})
	})

	describe("completePrompt", () => {
		it("returns correct response", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockResponse = { choices: [{ message: { content: "test completion" } }] }

			const mockCreate = vitest.fn().mockResolvedValue(mockResponse)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const result = await handler.completePrompt("test prompt")

			expect(result).toBe("test completion")

			expect(mockCreate).toHaveBeenCalledWith(
				{
					model: mockOptions.openRouterModelId,
					max_tokens: 8192,
					temperature: 0,
					messages: [{ role: "user", content: "test prompt" }],
					stream: false,
				},
				{ headers: { "x-anthropic-beta": "fine-grained-tool-streaming-2025-05-14" } },
			)
		})

		it("handles API errors and captures telemetry", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockError = {
				error: {
					message: "API Error",
					code: 500,
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockError)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("OpenRouter API Error 500: API Error")

			// Verify telemetry was captured
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "API Error",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "completePrompt",
					errorCode: 500,
					status: 500,
				}),
			)
		})

		it("handles unexpected errors and captures telemetry", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const error = new Error("Unexpected error")
			const mockCreate = vitest.fn().mockRejectedValue(error)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("Unexpected error")

			// Verify telemetry was captured (filtering now happens inside PostHogTelemetryClient)
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Unexpected error",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "completePrompt",
				}),
			)
		})

		it("passes SDK exceptions with status 429 to telemetry (filtering happens in PostHogTelemetryClient)", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const error = new Error("Rate limit exceeded: free-models-per-day") as any
			error.status = 429
			const mockCreate = vitest.fn().mockRejectedValue(error)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("Rate limit exceeded")

			// captureException is called, but PostHogTelemetryClient filters out 429 errors internally
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Rate limit exceeded: free-models-per-day",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "completePrompt",
				}),
			)
		})

		it("passes SDK exceptions with 429 in message to telemetry (filtering happens in PostHogTelemetryClient)", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const error = new Error("429 Rate limit exceeded: free-models-per-day")
			const mockCreate = vitest.fn().mockRejectedValue(error)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("429 Rate limit exceeded")

			// captureException is called, but PostHogTelemetryClient filters out 429 errors internally
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "429 Rate limit exceeded: free-models-per-day",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "completePrompt",
				}),
			)
		})

		it("passes SDK exceptions containing 'rate limit' to telemetry (filtering happens in PostHogTelemetryClient)", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const error = new Error("Request failed due to rate limit")
			const mockCreate = vitest.fn().mockRejectedValue(error)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("rate limit")

			// captureException is called, but PostHogTelemetryClient filters out rate limit errors internally
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Request failed due to rate limit",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "completePrompt",
				}),
			)
		})

		it("passes 429 rate limit errors from response to telemetry (filtering happens in PostHogTelemetryClient)", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockError = {
				error: {
					message: "Rate limit exceeded",
					code: 429,
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockError)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow(
				"OpenRouter API Error 429: Rate limit exceeded",
			)

			// captureException is called, but PostHogTelemetryClient filters out 429 errors internally
			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Rate limit exceeded",
					provider: "OpenRouter",
					modelId: mockOptions.openRouterModelId,
					operation: "completePrompt",
					errorCode: 429,
					status: 429,
				}),
			)
		})
	})
})

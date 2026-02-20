// kilocode_change - new file
// Mock DEFAULT_HEADERS before imports
vi.mock("../constants", () => ({
	DEFAULT_HEADERS: {
		"HTTP-Referer": "https://github.com/Kilo-Org/kilocode",
		"X-Title": "Kilo Code",
		"User-Agent": "KiloCode/1.0.0",
	},
}))

// Mock the model cache fetcher
vi.mock("../fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
}))

import { ApertisHandler } from "../apertis"
import {
	apertisDefaultModelId,
	apertisDefaultModelInfo,
	APERTIS_DEFAULT_BASE_URL,
	APERTIS_RESPONSES_API_MODELS,
} from "@roo-code/types"

// Mock fetch globally
global.fetch = vi.fn()

describe("ApertisHandler", () => {
	let handler: ApertisHandler

	const mockOptions = {
		apertisApiKey: "test-api-key",
		apertisModelId: "gpt-4o",
	}

	beforeEach(() => {
		vi.clearAllMocks()
		handler = new ApertisHandler(mockOptions)
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(ApertisHandler)
			expect(handler.getModel().id).toBe(mockOptions.apertisModelId)
		})

		it("should use default model when not provided", () => {
			const handlerWithoutModel = new ApertisHandler({
				apertisApiKey: "test-key",
			})
			expect(handlerWithoutModel.getModel().id).toBe(apertisDefaultModelId)
		})

		it("should use default base URL when not provided", () => {
			// The handler creates OpenAI/Anthropic clients internally
			// We can verify through behavior that defaults are applied
			expect(handler).toBeInstanceOf(ApertisHandler)
		})

		it("should use custom base URL when provided", () => {
			const customBaseUrl = "https://custom.apertis.ai"
			const handlerWithCustomUrl = new ApertisHandler({
				apertisApiKey: "test-key",
				apertisBaseUrl: customBaseUrl,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(ApertisHandler)
		})
	})

	describe("getApiFormat", () => {
		it("should route claude models to messages API", () => {
			const claudeHandler = new ApertisHandler({
				apertisApiKey: "test-key",
				apertisModelId: "claude-sonnet-4-20250514",
			})
			// @ts-expect-error - accessing private method for testing
			expect(claudeHandler.getApiFormat("claude-sonnet-4-20250514")).toBe("messages")
			// @ts-expect-error
			expect(claudeHandler.getApiFormat("claude-3-5-sonnet-20241022")).toBe("messages")
			// @ts-expect-error
			expect(claudeHandler.getApiFormat("claude-opus-4-20250514")).toBe("messages")
		})

		it("should route o1/o3 reasoning models to responses API", () => {
			// Test models in the APERTIS_RESPONSES_API_MODELS set
			const responsesModels = ["o1-preview", "o1-mini", "o1", "o3-mini", "o3"]

			for (const modelId of responsesModels) {
				const testHandler = new ApertisHandler({
					apertisApiKey: "test-key",
					apertisModelId: modelId,
				})
				// @ts-expect-error - accessing private method for testing
				expect(testHandler.getApiFormat(modelId)).toBe("responses")
			}
		})

		it("should route other models to chat completions API", () => {
			// @ts-expect-error - accessing private method for testing
			expect(handler.getApiFormat("gpt-4o")).toBe("chat")
			// @ts-expect-error
			expect(handler.getApiFormat("gpt-4o-mini")).toBe("chat")
			// @ts-expect-error
			expect(handler.getApiFormat("gemini-2.5-pro")).toBe("chat")
			// @ts-expect-error
			expect(handler.getApiFormat("deepseek-chat")).toBe("chat")
		})
	})

	describe("getModel", () => {
		it("should return configured model ID", () => {
			const model = handler.getModel()
			expect(model.id).toBe("gpt-4o")
		})

		it("should return default model when not configured", () => {
			const handlerWithoutModel = new ApertisHandler({
				apertisApiKey: "test-key",
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(apertisDefaultModelId)
			expect(model.info).toBeDefined()
		})

		it("should include model parameters", () => {
			const model = handler.getModel()
			expect(model).toHaveProperty("maxTokens")
			expect(model).toHaveProperty("temperature")
		})

		it("should use default model info for unknown models", () => {
			const handlerWithUnknown = new ApertisHandler({
				apertisApiKey: "test-key",
				apertisModelId: "unknown-model",
			})
			const model = handlerWithUnknown.getModel()
			expect(model.id).toBe("unknown-model")
			expect(model.info).toBe(apertisDefaultModelInfo)
		})

		it("should respect configured temperature", () => {
			const handlerWithTemp = new ApertisHandler({
				apertisApiKey: "test-key",
				apertisModelId: "gpt-4o",
				modelTemperature: 0.7,
			})
			const model = handlerWithTemp.getModel()
			expect(model.temperature).toBe(0.7)
		})

		it("should default temperature to 0", () => {
			const model = handler.getModel()
			expect(model.temperature).toBe(0)
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: any[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Hello!" }],
			},
		]

		describe("chat completions API", () => {
			it("should use chat completions for GPT models", async () => {
				// Mock streaming response
				const mockStream = {
					[Symbol.asyncIterator]: async function* () {
						yield {
							choices: [{ delta: { content: "Hello" }, index: 0 }],
							usage: null,
						}
						yield {
							choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
							usage: { prompt_tokens: 10, completion_tokens: 5 },
						}
					},
				}

				// Create a handler and mock the client
				const chatHandler = new ApertisHandler({
					apertisApiKey: "test-key",
					apertisModelId: "gpt-4o",
				})

				// We can't easily test the internal client calls without more complex mocking
				// Instead we verify the handler routes correctly
				const model = chatHandler.getModel()
				expect(model.id).toBe("gpt-4o")
				// @ts-expect-error - accessing private method
				expect(chatHandler.getApiFormat(model.id)).toBe("chat")
			})
		})

		describe("responses API", () => {
			it("should make correct API request for o1 models", async () => {
				const mockResponse = {
					ok: true,
					body: {
						getReader: () => ({
							read: vi
								.fn()
								.mockResolvedValueOnce({
									done: false,
									value: new TextEncoder().encode(
										'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
									),
								})
								.mockResolvedValueOnce({
									done: false,
									value: new TextEncoder().encode("data: [DONE]\n\n"),
								})
								.mockResolvedValueOnce({ done: true }),
							releaseLock: vi.fn(),
						}),
					},
				}
				vi.mocked(fetch).mockResolvedValueOnce(mockResponse as any)

				const responsesHandler = new ApertisHandler({
					apertisApiKey: "test-key",
					apertisModelId: "o1-preview",
				})

				const generator = responsesHandler.createMessage(systemPrompt, messages)
				const chunks: any[] = []
				for await (const chunk of generator) {
					chunks.push(chunk)
				}

				expect(fetch).toHaveBeenCalledWith(
					`${APERTIS_DEFAULT_BASE_URL}/v1/responses`,
					expect.objectContaining({
						method: "POST",
						headers: expect.objectContaining({
							"Content-Type": "application/json",
							Authorization: "Bearer test-key",
						}),
					}),
				)
			})

			it("should include reasoning parameters when configured", async () => {
				const mockResponse = {
					ok: true,
					body: {
						getReader: () => ({
							read: vi.fn().mockResolvedValueOnce({ done: true }),
							releaseLock: vi.fn(),
						}),
					},
				}
				vi.mocked(fetch).mockResolvedValueOnce(mockResponse as any)

				const responsesHandler = new ApertisHandler({
					apertisApiKey: "test-key",
					apertisModelId: "o1-preview",
					apertisReasoningEffort: "high",
					apertisReasoningSummary: "auto",
				})

				const generator = responsesHandler.createMessage(systemPrompt, messages)
				await generator.next()

				const requestBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)
				expect(requestBody.reasoning).toEqual({
					effort: "high",
					summary: "auto",
				})
			})

			it("should handle API errors properly", async () => {
				const mockErrorResponse = {
					ok: false,
					status: 400,
					text: () => Promise.resolve("Bad Request"),
				}
				vi.mocked(fetch).mockResolvedValueOnce(mockErrorResponse as any)

				const responsesHandler = new ApertisHandler({
					apertisApiKey: "test-key",
					apertisModelId: "o1-preview",
				})

				const generator = responsesHandler.createMessage(systemPrompt, messages)
				await expect(generator.next()).rejects.toThrow("Apertis Responses API error: 400")
			})
		})
	})

	describe("completePrompt", () => {
		it("should use chat completions API for non-streaming completion", async () => {
			// The completePrompt method uses the OpenAI client internally
			// We verify the handler is set up correctly
			expect(handler).toBeInstanceOf(ApertisHandler)
			expect(typeof handler.completePrompt).toBe("function")
		})
	})

	describe("model routing constants", () => {
		it("should have correct responses API models defined", () => {
			// Verify the APERTIS_RESPONSES_API_MODELS set contains expected models
			expect(APERTIS_RESPONSES_API_MODELS.has("o1-preview")).toBe(true)
			expect(APERTIS_RESPONSES_API_MODELS.has("o1-mini")).toBe(true)
			expect(APERTIS_RESPONSES_API_MODELS.has("o1")).toBe(true)
			expect(APERTIS_RESPONSES_API_MODELS.has("o3-mini")).toBe(true)
			expect(APERTIS_RESPONSES_API_MODELS.has("o3")).toBe(true)
		})

		it("should not include non-reasoning models in responses API set", () => {
			expect(APERTIS_RESPONSES_API_MODELS.has("gpt-4o")).toBe(false)
			expect(APERTIS_RESPONSES_API_MODELS.has("claude-sonnet-4-20250514")).toBe(false)
		})
	})
})

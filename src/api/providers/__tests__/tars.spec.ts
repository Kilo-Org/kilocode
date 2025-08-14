// npx vitest run api/providers/__tests__/tars.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { TarsHandler } from "../tars"
import { ApiHandlerOptions } from "../../../shared/api"
import { Package } from "../../../shared/package"

const mockCreate = vitest.fn()

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

vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"gpt-4o": {
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: true,
				supportsComputerUse: false,
				inputPrice: 2.5,
				outputPrice: 10.0,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0,
				description:
					"OpenAI GPT-4o model routed through TARS for optimal performance and reliability. TARS automatically selects the best available provider.",
			},
		})
	}),
}))

describe("TarsHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		tarsApiKey: "test-key",
		tarsModelId: "gpt-4o",
	}

	beforeEach(() => vitest.clearAllMocks())

	it("initializes with correct options", () => {
		const handler = new TarsHandler(mockOptions)
		expect(handler).toBeInstanceOf(TarsHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://api.router.tetrate.ai/v1",
			apiKey: mockOptions.tarsApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
				"X-Title": "Roo Code",
				"User-Agent": `RooCode/${Package.version}`,
			},
		})
	})

	describe("fetchModel", () => {
		it("returns correct model info when options are provided", async () => {
			const handler = new TarsHandler(mockOptions)
			const result = await handler.fetchModel()

			expect(result).toMatchObject({
				id: mockOptions.tarsModelId,
				info: {
					maxTokens: 16384,
					contextWindow: 128000,
					supportsImages: true,
					supportsPromptCache: true,
					supportsComputerUse: false,
					inputPrice: 2.5,
					outputPrice: 10.0,
					cacheWritesPrice: 0,
					cacheReadsPrice: 0,
					description:
						"OpenAI GPT-4o model routed through TARS for optimal performance and reliability. TARS automatically selects the best available provider.",
				},
			})
		})

		it("returns default model info when options are not provided", async () => {
			const handler = new TarsHandler({})
			const result = await handler.fetchModel()

			expect(result).toMatchObject({
				id: "claude-3-5-haiku-20241022",
				info: {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					supportsComputerUse: false,
					inputPrice: 0.8,
					outputPrice: 4.0,
					cacheWritesPrice: 1.0,
					cacheReadsPrice: 0.08,
					description:
						"Claude 3.5 Haiku - Fast and cost-effective with excellent coding capabilities. Ideal for development tasks with 200k context window",
				},
			})
		})
	})

	describe("createMessage", () => {
		it("generates correct stream chunks", async () => {
			const handler = new TarsHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: mockOptions.tarsModelId,
						choices: [{ delta: { content: "test response" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: { reasoning_content: "test reasoning" } }],
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
			const metadata = { taskId: "test-task-id", mode: "test-mode" }

			const generator = handler.createMessage(systemPrompt, messages, metadata)
			const chunks = []

			for await (const chunk of generator) {
				chunks.push(chunk)
			}

			// Verify stream chunks
			expect(chunks).toHaveLength(3) // text, reasoning, and usage chunks
			expect(chunks[0]).toEqual({ type: "text", text: "test response" })
			expect(chunks[1]).toEqual({ type: "reasoning", text: "test reasoning" })
			expect(chunks[2]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 20,
				cacheWriteTokens: 5,
				cacheReadTokens: 2,
				totalCost: expect.any(Number),
			})

			// Verify OpenAI client was called with correct parameters
			expect(mockCreate).toHaveBeenCalledWith({
				max_tokens: 16384,
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
				model: "gpt-4o",
				stream: true,
				stream_options: { include_usage: true },
				temperature: 0,
			})
		})

		it("handles API errors", async () => {
			const handler = new TarsHandler(mockOptions)
			const mockError = new Error("API Error")
			mockCreate.mockRejectedValue(mockError)

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("API Error")
		})
	})

	describe("completePrompt", () => {
		it("returns correct response", async () => {
			const handler = new TarsHandler(mockOptions)
			const mockResponse = { choices: [{ message: { content: "test completion" } }] }

			mockCreate.mockResolvedValue(mockResponse)

			const result = await handler.completePrompt("test prompt")

			expect(result).toBe("test completion")

			expect(mockCreate).toHaveBeenCalledWith({
				model: mockOptions.tarsModelId,
				max_tokens: 16384,
				messages: [{ role: "system", content: "test prompt" }],
				temperature: 0,
			})
		})

		it("handles API errors", async () => {
			const handler = new TarsHandler(mockOptions)
			const mockError = new Error("API Error")
			mockCreate.mockRejectedValue(mockError)

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("API Error")
		})

		it("handles unexpected errors", async () => {
			const handler = new TarsHandler(mockOptions)
			mockCreate.mockRejectedValue(new Error("Unexpected error"))

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("Unexpected error")
		})
	})
})

// npx vitest run api/providers/__tests__/cortecs.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { CortecsHandler } from "../cortecs"
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
			"coding/claude-4-sonnet": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				supportsComputerUse: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 4 Sonnet",
			},
		})
	}),
}))

describe("CortecsHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		cortecsApiKey: "test-key",
		cortecsModelId: "coding/claude-4-sonnet",
	}

	beforeEach(() => vitest.clearAllMocks())

	it("initializes with correct options", () => {
		const handler = new CortecsHandler(mockOptions)
		expect(handler).toBeInstanceOf(CortecsHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://api.cortecs.ai/v1",
			apiKey: mockOptions.cortecsApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://kilocode.ai",
				"X-Title": "Kilo Code",
				"X-KiloCode-Version": Package.version,
				"User-Agent": `Kilo-Code/${Package.version}`,
			},
		})
	})

	it("can use a base URL instead of the default", () => {
		const handler = new CortecsHandler({ ...mockOptions, cortecsBaseUrl: "https://api.cortecs.ai/v1" })
		expect(handler).toBeInstanceOf(CortecsHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://api.cortecs.ai/v1",
			apiKey: mockOptions.cortecsApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://kilocode.ai",
				"X-Title": "Kilo Code",
				"X-KiloCode-Version": Package.version,
				"User-Agent": `Kilo-Code/${Package.version}`,
			},
		})
	})

	describe("createMessage", () => {
		it("generates correct stream chunks", async () => {
			const handler = new CortecsHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: mockOptions.cortecsModelId,
						choices: [{ delta: { content: "test response" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {} }],
						usage: {
							prompt_tokens: 10,
							completion_tokens: 20,
							cache_creation_input_tokens: 5,
							cache_read_input_tokens: 10,
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
				cacheReadTokens: 10,
				cacheWriteTokens: 5,
			})

			// Verify OpenAI client was called with correct parameters
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
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
					model: "coding/claude-4-sonnet",
					stream: true,
					stream_options: { include_usage: true },
				}),
			)
		})

		it("handles API errors", async () => {
			const handler = new CortecsHandler(mockOptions)
			const mockError = new Error("API Error")
			mockCreate.mockRejectedValue(mockError)

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("API Error")
		})
	})

	describe("completePrompt", () => {
		it("returns correct response", async () => {
			const handler = new CortecsHandler(mockOptions)
			const mockResponse = { choices: [{ message: { content: "test completion" } }] }

			mockCreate.mockResolvedValue(mockResponse)

			const result = await handler.completePrompt("test prompt")

			expect(result).toBe("test completion")

			expect(mockCreate).toHaveBeenCalledWith({
				model: mockOptions.cortecsModelId,
				messages: [{ role: "user", content: "test prompt" }],
			})
		})

		it("handles API errors", async () => {
			const handler = new CortecsHandler(mockOptions)
			const mockError = new Error("API Error")
			mockCreate.mockRejectedValue(mockError)

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("API Error")
		})

		it("handles unexpected errors", async () => {
			const handler = new CortecsHandler(mockOptions)
			mockCreate.mockRejectedValue(new Error("Unexpected error"))

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("Unexpected error")
		})
	})
})

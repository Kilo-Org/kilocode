// npx vitest run src/api/providers/__tests__/cometapi.spec.ts

// Mock vscode first to avoid import errors
vitest.mock("vscode", () => ({}))

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import { describe, it, expect, vi, beforeEach } from "vitest"
import { CometAPIHandler } from "../cometapi"
import type { ApiHandlerOptions } from "../../../shared/api"
import { cometApiModels, cometApiDefaultModelId } from "@roo-code/types"
import { Package } from "../../../shared/package"

// Mock dependencies
vitest.mock("openai")
vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))
vitest.mock("../fetchers/cometapi", () => ({
	getCometAPIModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"claude-sonnet-4-20250514": {
				maxTokens: 8192,
				contextWindow: 200000, // Increased to allow maxTokens without clamping
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.2,
				outputPrice: 0.2,
				description: "Comet Claude Sonnet 4",
			},
			"claude-sonnet-4-20250514-thinking": {
				maxTokens: 128000,
				contextWindow: 200000, // Increased to allow maxTokens without clamping
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.15,
				outputPrice: 0.15,
				description: "Comet Claude Sonnet 4 Thinking",
			},
		})
	}),
}))

describe("CometAPIHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		cometApiKey: "test-key",
		cometApiModelId: "claude-sonnet-4-20250514",
	}

	beforeEach(() => vitest.clearAllMocks())

	it("initializes with correct options", () => {
		const handler = new CometAPIHandler(mockOptions)
		expect(handler).toBeInstanceOf(CometAPIHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://api.cometapi.com/v1",
			apiKey: mockOptions.cometApiKey,
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
			const handler = new CometAPIHandler(mockOptions)
			const result = await handler.fetchModel()

			expect(result).toMatchObject({
				id: mockOptions.cometApiModelId,
				maxTokens: 8192,
				temperature: 0,
			})
		})

		it("returns default model info when options are not provided", async () => {
			const handler = new CometAPIHandler({ cometApiModelId: "nonexistent/model" })
			const result = await handler.fetchModel()
			expect(result.id).toBe("nonexistent/model")
			expect(result.info.description).toBe(cometApiModels[cometApiDefaultModelId].description)
		})
	})

	describe("createMessage", () => {
		it("generates correct stream chunks", async () => {
			const handler = new CometAPIHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: mockOptions.cometApiModelId,
						choices: [{ delta: { content: "test response" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {} }],
						usage: { prompt_tokens: 10, completion_tokens: 20 },
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
			expect(chunks[1]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 20,
				totalCost: expect.any(Number),
			})

			// Verify OpenAI client was called with correct parameters
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: 8192,
					messages: [
						{ role: "system", content: "test system prompt" },
						{ role: "user", content: "test message" },
					],

					model: "claude-sonnet-4-20250514", // Use the actual model ID from mockOptions
					stream: true,
					stream_options: { include_usage: true },
					temperature: 0,
				}),
			)
		})

		it("handles API errors directly", async () => {
			const handler = new CometAPIHandler(mockOptions)
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
			await expect(generator.next()).rejects.toThrow("CometAPI Error 500: API Error")
		})

		it("handles errors without retry (removed retry logic)", async () => {
			const handler = new CometAPIHandler(mockOptions)
			const mockCreate = vitest.fn().mockRejectedValue(new Error("THROTTLING error in completePrompt"))

			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("THROTTLING error in completePrompt")
			expect(mockCreate).toHaveBeenCalledTimes(1) // No retry, called only once
		})
	})

	describe("completePrompt", () => {
		it("returns correct response", async () => {
			const handler = new CometAPIHandler(mockOptions)
			const mockResponse = { choices: [{ message: { content: "test completion" } }] }

			const mockCreate = vitest.fn().mockResolvedValue(mockResponse)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const result = await handler.completePrompt("test prompt")

			expect(result).toBe("test completion")

			expect(mockCreate).toHaveBeenCalledWith({
				model: mockOptions.cometApiModelId,
				max_tokens: 8192,
				temperature: 0,
				messages: [{ role: "user", content: "test prompt" }],
				stream: false,
			})
		})

		it("handles API errors directly", async () => {
			const handler = new CometAPIHandler(mockOptions)
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

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("CometAPI Error 500: API Error")
		})

		it("handles unexpected errors directly", async () => {
			const handler = new CometAPIHandler(mockOptions)
			const mockCreate = vitest.fn().mockRejectedValue(new Error("Unexpected error"))
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("Unexpected error")
		})

		it("handles empty or null prompts", async () => {
			const handler = new CometAPIHandler(mockOptions)
			const mockCreate = vitest.fn().mockRejectedValue(new Error("Unexpected error"))
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			// Test empty prompt - no validation in current implementation, passes empty string to API
			await expect(handler.completePrompt("")).rejects.toThrow("Unexpected error")

			// Test null prompt - passes null which causes OpenAI client error
			await expect(handler.completePrompt(null as any)).rejects.toThrow("Unexpected error")
		})

		it("handles errors without retry (removed retry logic)", async () => {
			const handler = new CometAPIHandler(mockOptions)
			const mockCreate = vitest.fn().mockRejectedValue(new Error("THROTTLING error in completePrompt"))

			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("THROTTLING error in completePrompt")
			expect(mockCreate).toHaveBeenCalledTimes(1) // No retry, called only once
		})
	})
})

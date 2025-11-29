// kilocode_change - new file
// npx vitest run src/api/providers/__tests__/mistral-fim.spec.ts

// Mock vscode first to avoid import errors
vitest.mock("vscode", () => ({}))

import { MistralHandler } from "../mistral"
import { ApiHandlerOptions } from "../../../shared/api"
import { streamSse } from "../../../services/continuedev/core/fetch/stream"

// Mock the stream module
vitest.mock("../../../services/continuedev/core/fetch/stream", () => ({
	streamSse: vitest.fn(),
}))

// Mock delay
vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))

describe("MistralHandler FIM support", () => {
	const mockOptions: ApiHandlerOptions = {
		mistralApiKey: "test-api-key",
		apiModelId: "codestral-latest",
	}

	beforeEach(() => vitest.clearAllMocks())

	describe("supportsFim", () => {
		it("returns true for codestral models", () => {
			const handler = new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-latest",
			})

			expect(handler.supportsFim()).toBe(true)
		})

		it("returns true for codestral-2405", () => {
			const handler = new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-2405",
			})

			expect(handler.supportsFim()).toBe(true)
		})

		it("returns false for non-codestral models", () => {
			const handler = new MistralHandler({
				...mockOptions,
				apiModelId: "mistral-large-latest",
			})

			expect(handler.supportsFim()).toBe(false)
		})

		it("returns true when no model is specified (defaults to codestral-latest)", () => {
			const handler = new MistralHandler({
				mistralApiKey: "test-api-key",
			})

			// Default model is codestral-latest, which supports FIM
			expect(handler.supportsFim()).toBe(true)
		})
	})

	describe("completeFim", () => {
		it("handles errors correctly", async () => {
			const handler = new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-latest",
			})

			const mockResponse = {
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				text: vitest.fn().mockResolvedValue("Error details"),
			}

			global.fetch = vitest.fn().mockResolvedValue(mockResponse)

			await expect(handler.completeFim("prefix", "suffix")).rejects.toThrow(
				"FIM streaming failed: 500 Internal Server Error - Error details",
			)
		})

		it("aggregates all chunks", async () => {
			const handler = new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-latest",
			})

			// Mock streamSse to return the expected data
			;(streamSse as any).mockImplementation(async function* () {
				yield { choices: [{ delta: { content: "Hello" } }] }
				yield { choices: [{ delta: { content: " " } }] }
				yield { choices: [{ delta: { content: "World" } }] }
			})

			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
			} as Response

			global.fetch = vitest.fn().mockResolvedValue(mockResponse)

			const result = await handler.completeFim("prefix", "suffix")

			expect(result).toBe("Hello World")
		})
	})

	describe("streamFim", () => {
		it("yields chunks correctly", async () => {
			const handler = new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-latest",
			})

			// Mock streamSse to return the expected data
			;(streamSse as any).mockImplementation(async function* () {
				yield { choices: [{ delta: { content: "chunk1" } }] }
				yield { choices: [{ delta: { content: "chunk2" } }] }
				yield { choices: [{ delta: { content: "chunk3" } }] }
			})

			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
			} as Response

			global.fetch = vitest.fn().mockResolvedValue(mockResponse)

			const chunks: string[] = []

			for await (const chunk of handler.streamFim("prefix", "suffix")) {
				chunks.push(chunk)
			}

			expect(chunks).toEqual(["chunk1", "chunk2", "chunk3"])
			expect(streamSse).toHaveBeenCalledWith(mockResponse)
		})

		it("handles errors correctly", async () => {
			const handler = new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-latest",
			})

			const mockResponse = {
				ok: false,
				status: 400,
				statusText: "Bad Request",
				text: vitest.fn().mockResolvedValue("Invalid request"),
			}

			global.fetch = vitest.fn().mockResolvedValue(mockResponse)

			const generator = handler.streamFim("prefix", "suffix")
			await expect(generator.next()).rejects.toThrow("FIM streaming failed: 400 Bad Request - Invalid request")
		})

		it("uses correct endpoint for codestral models", async () => {
			const handler = new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-latest",
			})

			;(streamSse as any).mockImplementation(async function* () {
				yield { choices: [{ delta: { content: "test" } }] }
			})

			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
			} as Response

			global.fetch = vitest.fn().mockResolvedValue(mockResponse)

			const generator = handler.streamFim("prefix", "suffix")
			await generator.next()

			expect(global.fetch).toHaveBeenCalledWith(
				expect.objectContaining({
					href: "https://codestral.mistral.ai/v1/fim/completions",
				}),
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						Authorization: "Bearer test-api-key",
					}),
				}),
			)
		})

		it("uses custom codestral URL when provided", async () => {
			const handler = new MistralHandler({
				...mockOptions,
				apiModelId: "codestral-latest",
				mistralCodestralUrl: "https://custom.codestral.url",
			})

			;(streamSse as any).mockImplementation(async function* () {
				yield { choices: [{ delta: { content: "test" } }] }
			})

			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
			} as Response

			global.fetch = vitest.fn().mockResolvedValue(mockResponse)

			const generator = handler.streamFim("prefix", "suffix")
			await generator.next()

			expect(global.fetch).toHaveBeenCalledWith(
				expect.objectContaining({
					href: "https://custom.codestral.url/v1/fim/completions",
				}),
				expect.any(Object),
			)
		})
	})
})

// npx vitest run api/providers/__tests__/openai-responses-mode.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"

import { OpenAiHandler } from "../openai"
import type { ApiHandlerOptions } from "../../../shared/api"

// Wir mocken den OpenAI-SDK-Client, damit keine echten HTTP-Calls passieren.
const mockCreate = vi.fn()

vi.mock("openai", () => {
	const createClient = (kind: "openai" | "azure") => ({
		__kind: kind,
		chat: {
			completions: {
				create: mockCreate.mockImplementation(async (_options, _requestOptions) => {
					// Non-streaming Antwort
					if (!_options.stream) {
						return {
							id: "test-completion",
							choices: [
								{
									message: { role: "assistant", content: "Test response", refusal: null },
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

					// Streaming Antwort
					return {
						[Symbol.asyncIterator]: async function* () {
							yield {
								choices: [
									{
										delta: { content: "Test response" },
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
	})

	const OpenAI = vi.fn().mockImplementation(() => createClient("openai"))
	const AzureOpenAI = vi.fn().mockImplementation(() => createClient("azure"))

	return {
		__esModule: true,
		default: OpenAI,
		AzureOpenAI,
	}
})

// Responses-Adapter partiell mocken, damit wir Aufrufe beobachten können.
vi.mock("../utils/openai-responses-adapter", async () => {
	const actual = await vi.importActual<typeof import("../utils/openai-responses-adapter")>(
		"../utils/openai-responses-adapter",
	)
	return {
		...actual,
		streamResponsesAsApiStream: vi.fn(actual.streamResponsesAsApiStream),
		completePromptViaResponses: vi.fn(actual.completePromptViaResponses),
		buildResponsesRequestBody: vi.fn(actual.buildResponsesRequestBody),
	}
})

import {
	streamResponsesAsApiStream,
	completePromptViaResponses,
	buildResponsesRequestBody,
} from "../utils/openai-responses-adapter"

describe("OpenAiHandler Responses-Mode-Entscheidungslogik", () => {
	const systemPrompt = "You are a helpful assistant."
	const messages = [
		{
			role: "user" as const,
			content: [
				{
					type: "text" as const,
					text: "Hello!",
				},
			],
		},
	]

	let baseOptions: ApiHandlerOptions

	beforeEach(() => {
		baseOptions = {
			openAiApiKey: "test-api-key",
			openAiModelId: "gpt-4",
			openAiBaseUrl: "https://myendpoint.openai.azure.com",
		}
		mockCreate.mockClear()
		;(streamResponsesAsApiStream as any).mockClear()
		;(completePromptViaResponses as any).mockClear()
		;(buildResponsesRequestBody as any).mockClear()
	})

	describe("createMessage (Streaming)", () => {
		it("verwendet niemals Responses-API, wenn openAiApiMode = 'completions'", async () => {
			const handler = new OpenAiHandler({
				...baseOptions,
				openAiApiMode: "completions" as any,
				openAiResponsesMode: "force",
			})

			const stream = handler.createMessage(systemPrompt, messages as any)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(streamResponsesAsApiStream).not.toHaveBeenCalled()
			expect(chunks.length).toBeGreaterThan(0)
			const textChunk = chunks.find((c) => c.type === "text")
			expect(textChunk?.text).toBe("Test response")
		})

		it("verwendet Responses-API, wenn openAiApiMode = 'responses' und openAiResponsesMode = 'force'", async () => {
			const handler = new OpenAiHandler({
				...baseOptions,
				openAiApiMode: "responses" as any,
				openAiResponsesMode: "force",
			})

			// Wir liefern einen Fake-AsyncIterable zurück, damit streamResponsesAsApiStream etwas zu iterieren hat.
			;(streamResponsesAsApiStream as any).mockImplementationOnce(async function* (args: any) {
				expect(args.requestBody.model).toBe(baseOptions.openAiModelId)
				// MUST use non-Azure client for Responses (AzureOpenAI would append api-version)
				expect(args.client.__kind).toBe("openai")
				yield { type: "text", text: "Responses API text" }
				yield { type: "usage", inputTokens: 1, outputTokens: 2 }
			})

			const stream = handler.createMessage(systemPrompt, messages as any)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(streamResponsesAsApiStream).toHaveBeenCalled()
			const textChunk = chunks.find((c) => c.type === "text")
			expect(textChunk?.text).toBe("Responses API text")
		})

		it("verwendet Responses-API nicht, wenn openAiResponsesMode = 'off', selbst bei openAiApiMode = 'responses'", async () => {
			const handler = new OpenAiHandler({
				...baseOptions,
				openAiApiMode: "responses" as any,
				openAiResponsesMode: "off",
			})

			const stream = handler.createMessage(systemPrompt, messages as any)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(streamResponsesAsApiStream).not.toHaveBeenCalled()
			expect(chunks.length).toBeGreaterThan(0)
		})

		it("übergibt openAiResponsesStoreEnabled als store an buildResponsesRequestBody", async () => {
			const handler = new OpenAiHandler({
				...baseOptions,
				openAiApiMode: "responses" as any,
				openAiResponsesMode: "force",
				openAiResponsesStoreEnabled: true,
			})

			;(streamResponsesAsApiStream as any).mockImplementationOnce(async function* () {
				yield { type: "text", text: "Responses API text" }
			})

			const stream = handler.createMessage(systemPrompt, messages as any)
			for await (const _chunk of stream) {
				// nur Konsum
			}

			expect(buildResponsesRequestBody).toHaveBeenCalled()
			const lastCallArgs = (buildResponsesRequestBody as any).mock.calls.at(-1)?.[0]
			expect(lastCallArgs.store).toBe(true)
		})
	})

	describe("completePrompt (Non-Streaming)", () => {
		it("verwendet keine Responses-API, wenn openAiApiMode = 'completions'", async () => {
			const handler = new OpenAiHandler({
				...baseOptions,
				openAiApiMode: "completions" as any,
				openAiResponsesMode: "force",
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(completePromptViaResponses).not.toHaveBeenCalled()
		})

		it("verwendet Responses-API, wenn openAiApiMode = 'responses' und openAiResponsesMode = 'force'", async () => {
			const handler = new OpenAiHandler({
				...baseOptions,
				openAiApiMode: "responses" as any,
				openAiResponsesMode: "force",
			})

			;(completePromptViaResponses as any).mockImplementationOnce(async (args: any) => {
				// MUST use non-Azure client for Responses (AzureOpenAI would append api-version)
				expect(args.client.__kind).toBe("openai")
				return "Responses completePrompt"
			})

			const result = await handler.completePrompt("Test prompt")
			expect(completePromptViaResponses).toHaveBeenCalled()
			expect(result).toBe("Responses completePrompt")
		})

		it("übergibt openAiResponsesStoreEnabled als store an buildResponsesRequestBody in completePrompt", async () => {
			const handler = new OpenAiHandler({
				...baseOptions,
				openAiApiMode: "responses" as any,
				openAiResponsesMode: "force",
				openAiResponsesStoreEnabled: true,
			})

			;(completePromptViaResponses as any).mockResolvedValueOnce("Responses completePrompt")

			await handler.completePrompt("Test prompt")

			expect(buildResponsesRequestBody).toHaveBeenCalled()
			const lastCallArgs = (buildResponsesRequestBody as any).mock.calls.at(-1)?.[0]
			expect(lastCallArgs.store).toBe(true)
		})
	})
})

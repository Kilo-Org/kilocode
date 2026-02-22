// kilocode_change - new file
// npx vitest run api/providers/__tests__/openai-responses.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"

import { OpenAiCompatibleResponsesHandler } from "../openai-responses"
import { ApiHandlerOptions } from "../../../shared/api"

const mockResponsesCreate = vi.fn()

vitest.mock("openai", () => {
	return {
		__esModule: true,
		default: vi.fn().mockImplementation(() => ({
			responses: {
				create: mockResponsesCreate,
			},
		})),
		AzureOpenAI: vi.fn().mockImplementation(() => ({
			responses: {
				create: mockResponsesCreate,
			},
		})),
	}
})

describe("OpenAiCompatibleResponsesHandler", () => {
	const systemPrompt = "You are a helpful assistant."
	const messages: Anthropic.Messages.MessageParam[] = [
		{
			role: "user",
			content: "Hello!",
		},
	]

	const createMockSseResponse = () => ({
		ok: true,
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('data: {"type":"response.text.delta","delta":"Hello"}\n\n'))
				controller.enqueue(
					new TextEncoder().encode('data: {"type":"response.text.delta","delta":" world"}\n\n'),
				)
				controller.enqueue(
					new TextEncoder().encode(
						'data: {"type":"response.done","response":{"usage":{"prompt_tokens":10,"completion_tokens":2}}}\n\n',
					),
				)
				controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
				controller.close()
			},
		}),
	})

	beforeEach(() => {
		mockResponsesCreate.mockReset()
		if ((global as any).fetch) {
			delete (global as any).fetch
		}
	})

	afterEach(() => {
		if ((global as any).fetch) {
			delete (global as any).fetch
		}
	})

	it("initializes with provided options", () => {
		const handler = new OpenAiCompatibleResponsesHandler({
			openAiApiKey: "test-key",
			openAiModelId: "gpt-4o",
		} satisfies ApiHandlerOptions)

		expect(handler.getModel().id).toBe("gpt-4o")
	})

	it("streams responses via fetch fallback", async () => {
		const handler = new OpenAiCompatibleResponsesHandler({
			openAiApiKey: "test-key",
			openAiBaseUrl: "https://api.example.com",
			openAiModelId: "gpt-4o",
		} satisfies ApiHandlerOptions)

		const mockFetch = vi.fn().mockResolvedValue(createMockSseResponse())
		global.fetch = mockFetch as any

		mockResponsesCreate.mockRejectedValue(new Error("SDK not available"))

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks: any[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks.filter((chunk) => chunk.type === "text").map((c) => c.text)).toEqual(["Hello", " world"])
		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.example.com/v1/responses",
			expect.objectContaining({
				method: "POST",
			}),
		)
	})

	it("normalizes fallback URL without duplicating /v1", async () => {
		const handler = new OpenAiCompatibleResponsesHandler({
			openAiApiKey: "test-key",
			openAiBaseUrl: "https://api.example.com/v1",
			openAiModelId: "gpt-4o",
		} satisfies ApiHandlerOptions)

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
					controller.close()
				},
			}),
		})
		global.fetch = mockFetch as any
		mockResponsesCreate.mockRejectedValue(new Error("SDK not available"))

		const stream = handler.createMessage(systemPrompt, messages)
		for await (const _chunk of stream) {
		}

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.example.com/v1/responses",
			expect.objectContaining({
				method: "POST",
			}),
		)
	})

	it("rejects Azure AI Inference endpoints for Responses API", async () => {
		const handler = new OpenAiCompatibleResponsesHandler({
			openAiApiKey: "test-key",
			openAiBaseUrl: "https://myresource.services.ai.azure.com/models",
			openAiModelId: "gpt-5.2-codex",
		} satisfies ApiHandlerOptions)

		const stream = handler.createMessage(systemPrompt, messages)

		await expect(async () => {
			for await (const _chunk of stream) {
			}
		}).rejects.toThrow("Azure AI Inference endpoints")

		await expect(handler.completePrompt("Test prompt")).rejects.toThrow("Azure AI Inference endpoints")
	})

	it("does not pass chat-completions path override for Azure OpenAI Responses calls", async () => {
		const handler = new OpenAiCompatibleResponsesHandler({
			openAiApiKey: "test-key",
			openAiBaseUrl: "https://myresource.openai.azure.com/openai/v1",
			openAiUseAzure: true,
			openAiModelId: "my-deployment",
		} satisfies ApiHandlerOptions)

		mockResponsesCreate.mockResolvedValueOnce({
			[Symbol.asyncIterator]: async function* () {
				yield { type: "response.text.delta", delta: "hello" }
				yield {
					type: "response.done",
					response: {
						usage: {
							prompt_tokens: 1,
							completion_tokens: 1,
						},
					},
				}
			},
		})

		const stream = handler.createMessage(systemPrompt, messages)
		for await (const _chunk of stream) {
		}

		expect(mockResponsesCreate).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				signal: expect.any(AbortSignal),
			}),
		)
		const options = mockResponsesCreate.mock.calls[0][1]
		expect(options.path).toBeUndefined()
	})

	it("uses Azure fallback auth and normalizes Azure deployment chat URL to /openai/v1/responses without api-version", async () => {
		const handler = new OpenAiCompatibleResponsesHandler({
			openAiApiKey: "test-key",
			openAiBaseUrl:
				"https://myresource.openai.azure.com/openai/deployments/my-deployment/chat/completions?api-version=2024-05-01-preview",
			openAiUseAzure: true,
			azureApiVersion: "2024-08-01-preview",
			openAiModelId: "my-deployment",
		} satisfies ApiHandlerOptions)

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
					controller.close()
				},
			}),
		})
		global.fetch = mockFetch as any
		mockResponsesCreate.mockRejectedValue(new Error("SDK not available"))

		const stream = handler.createMessage(systemPrompt, messages)
		for await (const _chunk of stream) {
		}

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const [requestUrl, requestOptions] = mockFetch.mock.calls[0]
		expect(requestUrl).toBe("https://myresource.openai.azure.com/openai/v1/responses")
		expect(requestUrl).not.toContain("api-version=")
		expect(requestOptions.headers["api-key"]).toBe("test-key")
		expect(requestOptions.headers.Authorization).toBeUndefined()
	})

	it("normalizes cognitiveservices Azure endpoint to /openai/v1/responses without api-version", async () => {
		const handler = new OpenAiCompatibleResponsesHandler({
			openAiApiKey: "test-key",
			openAiBaseUrl: "https://myresource.cognitiveservices.azure.com",
			openAiUseAzure: true,
			azureApiVersion: "2024-08-01-preview",
			openAiModelId: "my-deployment",
		} satisfies ApiHandlerOptions)

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
					controller.close()
				},
			}),
		})
		global.fetch = mockFetch as any
		mockResponsesCreate.mockRejectedValue(new Error("SDK not available"))

		const stream = handler.createMessage(systemPrompt, messages)
		for await (const _chunk of stream) {
		}

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const [requestUrl, requestOptions] = mockFetch.mock.calls[0]
		expect(requestUrl).toBe("https://myresource.cognitiveservices.azure.com/openai/v1/responses")
		expect(requestUrl).not.toContain("api-version=")
		expect(requestOptions.headers["api-key"]).toBe("test-key")
		expect(requestOptions.headers.Authorization).toBeUndefined()
	})
})

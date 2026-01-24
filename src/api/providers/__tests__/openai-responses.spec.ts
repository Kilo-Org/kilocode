// kilocode_change - new file
// npx vitest run api/providers/__tests__/openai-responses.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

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

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode('data: {"type":"response.text.delta","delta":"Hello"}\n\n'),
					)
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
})

import { ClaudeCodeNativeHandler } from "../claudecodenative"
import { AnthropicHandler } from "../anthropic"
import { ApiHandlerOptions } from "../../../shared/api"
import { Anthropic } from "@anthropic-ai/sdk"

const mockCreate = vitest.fn()

vitest.mock("@anthropic-ai/sdk", () => {
	return {
		Anthropic: vitest.fn().mockImplementation(() => ({
			messages: {
				create: mockCreate,
				countTokens: vitest.fn(),
			},
		})),
	}
})

describe("ClaudeCodeNativeHandler", () => {
	let handler: ClaudeCodeNativeHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			apiKey: "test-api-key",
			apiModelId: "claude-3-5-sonnet-20241022",
		}
		handler = new ClaudeCodeNativeHandler(mockOptions)
		mockCreate.mockClear()
	})

	it("should be an instance of AnthropicHandler", () => {
		expect(handler).toBeInstanceOf(AnthropicHandler)
	})

	it("should be an instance of ClaudeCodeNativeHandler", () => {
		expect(handler).toBeInstanceOf(ClaudeCodeNativeHandler)
	})

	it("should initialize with provided options", () => {
		expect(handler.getModel().id).toBe(mockOptions.apiModelId)
	})

	it("should include the required system message", async () => {
		const systemPrompt = "User provided system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

		// Mock the stream response
		mockCreate.mockResolvedValue({
			[Symbol.asyncIterator]: async function* () {
				yield { type: "message_start", message: { usage: {} } }
				yield { type: "message_stop" }
			},
		})

		const stream = handler.createMessage(systemPrompt, messages)
		for await (const _ of stream) {
			// Consume stream
		}

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				system: expect.arrayContaining([
					expect.objectContaining({
						type: "text",
						text: "You are Claude Code, Anthropic's official CLI for Claude.",
					}),
					expect.objectContaining({
						type: "text",
						text: systemPrompt,
					}),
				]),
			}),
			{
				headers: {
					"anthropic-beta": "oauth-2025-04-20,prompt-caching-2024-07-31",
				},
			},
		)

		// Verify order: required message first
		const callArgs = mockCreate.mock.calls[0][0]
		expect(callArgs.system[0]).toEqual(
			expect.objectContaining({
				type: "text",
				text: "You are Claude Code, Anthropic's official CLI for Claude.",
			}),
		)
		expect(callArgs.system[1]).toEqual(
			expect.objectContaining({
				type: "text",
				text: systemPrompt,
			}),
		)
	})
})

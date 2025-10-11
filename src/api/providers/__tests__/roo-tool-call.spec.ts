// npx vitest run api/providers/__tests__/roo-tool-call.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { ApiHandlerOptions } from "../../../shared/api"

// Mock OpenAI client
const mockCreate = vitest.fn()

vitest.mock("openai", () => {
	return {
		__esModule: true,
		default: vitest.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate.mockImplementation(async (options) => {
						if (!options.stream) {
							return {
								id: "test-completion",
								choices: [
									{
										message: { role: "assistant", content: "Test response" },
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

						return {
							[Symbol.asyncIterator]: async function* () {
								yield {
									choices: [
										{
											delta: {
												tool_calls: [
													{
														index: 0,
														id: "tool-call-1",
														function: {
															name: "test-tool",
															arguments: '{"arg1":"value1"}',
														},
														type: "function",
													},
												],
											},
											index: 0,
										},
									],
									usage: null,
								}
								yield {
									choices: [
										{
											delta: {},
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
		})),
	}
})

// Mock CloudService
const mockGetSessionTokenFn = vitest.fn()
const mockHasInstanceFn = vitest.fn()

vitest.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: () => mockHasInstanceFn(),
		get instance() {
			return {
				authService: {
					getSessionToken: () => mockGetSessionTokenFn(),
				},
				on: vitest.fn(),
				off: vitest.fn(),
			}
		},
	},
}))

// Import after mocks are set up
import { RooHandler } from "../roo"

describe("RooHandler Tool Call", () => {
	let handler: RooHandler
	let mockOptions: ApiHandlerOptions
	const systemPrompt = "You are a helpful assistant."
	const messages: Anthropic.Messages.MessageParam[] = [
		{
			role: "user",
			content: "Hello!",
		},
	]

	beforeEach(() => {
		mockOptions = {
			apiModelId: "xai/grok-code-fast-1",
		}
		mockHasInstanceFn.mockReturnValue(true)
		mockGetSessionTokenFn.mockReturnValue("test-session-token")
		mockCreate.mockClear()
		vitest.clearAllMocks()
	})

	it("should handle tool_calls in streaming responses", async () => {
		handler = new RooHandler(mockOptions)
		const stream = handler.createMessage(systemPrompt, messages)
		const chunks: any[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const toolCallChunks = chunks.filter((chunk) => chunk.type === "tool_call")
		expect(toolCallChunks).toHaveLength(1)
		expect(toolCallChunks[0].toolCalls).toEqual([
			{
				index: 0,
				id: "tool-call-1",
				function: {
					name: "test-tool",
					arguments: '{"arg1":"value1"}',
				},
				type: "function",
			},
		])
	})
})

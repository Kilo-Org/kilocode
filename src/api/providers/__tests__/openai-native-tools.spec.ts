import OpenAI from "openai"

import { OpenAiHandler } from "../openai"

describe("OpenAiHandler native tools", () => {
	it("includes tools in request when custom model info lacks supportsNativeTools (regression test)", async () => {
		const mockCreate = vi.fn().mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [{ delta: { content: "Test response" } }],
				}
			},
		}))

		// Set openAiCustomModelInfo WITHOUT supportsNativeTools to simulate
		// a user-provided custom model info that doesn't specify native tool support.
		// The getModel() fix should merge NATIVE_TOOL_DEFAULTS to ensure
		// supportsNativeTools defaults to true.
		const handler = new OpenAiHandler({
			openAiApiKey: "test-key",
			openAiBaseUrl: "https://example.com/v1",
			openAiModelId: "test-model",
			openAiCustomModelInfo: {
				maxTokens: 4096,
				contextWindow: 128000,
			},
		} as unknown as import("../../../shared/api").ApiHandlerOptions)

		// Patch the OpenAI client call
		const mockClient = {
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		} as unknown as OpenAI
		;(handler as unknown as { client: OpenAI }).client = mockClient

		const tools: OpenAI.Chat.ChatCompletionTool[] = [
			{
				type: "function",
				function: {
					name: "test_tool",
					description: "test",
					parameters: { type: "object", properties: {} },
				},
			},
		]

		// Mimic the behavior in Task.attemptApiRequest() where tools are only
		// included when modelInfo.supportsNativeTools is true. This is the
		// actual regression path being tested - without the getModel() fix,
		// supportsNativeTools would be undefined and tools wouldn't be passed.
		const modelInfo = handler.getModel().info
		const supportsNativeTools = modelInfo.supportsNativeTools ?? false

		const stream = handler.createMessage("system", [], {
			taskId: "test-task-id",
			...(supportsNativeTools && { tools }),
			...(supportsNativeTools && { toolProtocol: "native" as const }),
		})
		await stream.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				tools: expect.arrayContaining([
					expect.objectContaining({
						type: "function",
						function: expect.objectContaining({ name: "test_tool" }),
					}),
				]),
				parallel_tool_calls: false,
			}),
			expect.anything(),
		)
	})
})

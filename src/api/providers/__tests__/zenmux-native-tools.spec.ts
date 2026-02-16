// kilocode_change - new file
import OpenAI from "openai"

import type { ApiHandlerCreateMessageMetadata } from "../../index"
import type { ApiHandlerOptions } from "../../../shared/api"
import { ZenMuxHandler } from "../zenmux"

vi.mock("../fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
}))

function createMockStream() {
	return {
		async *[Symbol.asyncIterator]() {
			yield {
				choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
			}
		},
	}
}

async function consume(generator: AsyncGenerator<unknown>) {
	for await (const _chunk of generator) {
		// Consume all chunks
	}
}

describe("ZenMuxHandler native tools and message pipeline", () => {
	const baseOptions: ApiHandlerOptions = {
		zenmuxApiKey: "test-key",
		zenmuxModelId: "z-ai/glm-5",
		zenmuxBaseUrl: "https://test.zenmux.ai/api/v1",
	}

	it("merges native tool defaults when model cache entry lacks native metadata", () => {
		const handler = new ZenMuxHandler(baseOptions)
		;(handler as unknown as { models: Record<string, unknown> }).models = {
			"z-ai/glm-5": {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "GLM 5",
			},
		}

		const model = handler.getModel()
		expect(model.info.supportsNativeTools).toBe(true)
		expect(model.info.defaultToolProtocol).toBe("native")
	})

	it("passes tools and tool choice to stream creation when task protocol is native", async () => {
		const handler = new ZenMuxHandler(baseOptions)

		vi.spyOn(handler, "fetchModel").mockResolvedValue({
			id: "z-ai/glm-5",
			info: {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsNativeTools: true,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "GLM 5",
			},
		} as any)

		const streamSpy = vi.spyOn(handler, "createZenMuxStream").mockResolvedValue(createMockStream() as any)

		const tools: OpenAI.Chat.ChatCompletionTool[] = [
			{
				type: "function",
				function: {
					name: "attempt_completion",
					description: "Complete the task",
					parameters: { type: "object", properties: {} },
				},
			},
		]
		const metadata: ApiHandlerCreateMessageMetadata = {
			taskId: "task-native",
			toolProtocol: "native",
			tools,
			tool_choice: "auto",
			parallelToolCalls: true,
		}

		await consume(handler.createMessage("system", [{ role: "user", content: "hi" }], metadata))

		expect(streamSpy).toHaveBeenCalledTimes(1)
		expect(streamSpy.mock.calls[0][6]).toEqual(tools)
		expect(streamSpy.mock.calls[0][7]).toBe("auto")
		expect(streamSpy.mock.calls[0][8]).toBe(true)
	})

	it("omits tools when task protocol is xml even if tools are provided", async () => {
		const handler = new ZenMuxHandler(baseOptions)

		vi.spyOn(handler, "fetchModel").mockResolvedValue({
			id: "z-ai/glm-5",
			info: {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsNativeTools: true,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "GLM 5",
			},
		} as any)

		const streamSpy = vi.spyOn(handler, "createZenMuxStream").mockResolvedValue(createMockStream() as any)

		const tools: OpenAI.Chat.ChatCompletionTool[] = [
			{
				type: "function",
				function: {
					name: "ask_followup_question",
					description: "Ask a follow-up question",
					parameters: { type: "object", properties: {} },
				},
			},
		]

		await consume(
			handler.createMessage("system", [{ role: "user", content: "hi" }], {
				taskId: "task-xml",
				toolProtocol: "xml",
				tools,
				tool_choice: "auto",
				parallelToolCalls: true,
			}),
		)

		expect(streamSpy).toHaveBeenCalledTimes(1)
		expect(streamSpy.mock.calls[0][6]).toBeUndefined()
		expect(streamSpy.mock.calls[0][7]).toBeUndefined()
		expect(streamSpy.mock.calls[0][8]).toBe(false)
	})

	it("passes transformed DeepSeek R1 messages into stream creation", async () => {
		const handler = new ZenMuxHandler({
			...baseOptions,
			zenmuxModelId: "deepseek/deepseek-r1",
		})

		vi.spyOn(handler, "fetchModel").mockResolvedValue({
			id: "deepseek/deepseek-r1",
			info: {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsNativeTools: true,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "DeepSeek R1",
			},
		} as any)

		const streamSpy = vi.spyOn(handler, "createZenMuxStream").mockResolvedValue(createMockStream() as any)

		await consume(handler.createMessage("system prompt", [{ role: "user", content: "hi" }], { taskId: "task-r1" }))

		expect(streamSpy).toHaveBeenCalledTimes(1)
		const sentMessages = streamSpy.mock.calls[0][1] as OpenAI.Chat.ChatCompletionMessageParam[]
		expect(sentMessages.some((message: any) => message.role === "system")).toBe(false)
		expect((sentMessages[0] as any).role).toBe("user")
	})
})

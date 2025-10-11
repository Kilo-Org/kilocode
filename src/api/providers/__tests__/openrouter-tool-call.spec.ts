// npx vitest run src/api/providers/__tests__/openrouter-tool-call.spec.ts

// Mock vscode first to avoid import errors
vitest.mock("vscode", () => ({}))

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { OpenRouterHandler } from "../openrouter"
import { ApiHandlerOptions } from "../../../shared/api"
import { Package } from "../../../shared/package"
import { getToolRegistry } from "../../../core/prompts/tools/schemas/tool-registry"
import { ApiHandlerCreateMessageMetadata } from "../.."

// Mock dependencies
vitest.mock("openai")
vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))
vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"anthropic/claude-sonnet-4": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 3.7 Sonnet",
				thinking: false,
				supportsComputerUse: true,
			},
		})
	}),
}))
vitest.mock("../../../core/prompts/tools/schemas/tool-registry")

describe("OpenRouterHandler Tool Call", () => {
	const mockOptions: ApiHandlerOptions = {
		openRouterApiKey: "test-key",
		openRouterModelId: "anthropic/claude-sonnet-4",
	}

	beforeEach(() => {
		vitest.clearAllMocks()
		const mockToolRegistry = {
			generateFunctionCallSchemas: vitest.fn().mockReturnValue([
				{
					type: "function",
					function: {
						name: "read_file",
						description: "A test tool",
						parameters: {
							type: "object",
							properties: {},
							required: [],
						},
					},
				},
			]),
		}
		;(getToolRegistry as any).mockReturnValue(mockToolRegistry)
	})

	it("should include tool call parameters when tools are provided", async () => {
		const handler = new OpenRouterHandler(mockOptions)

		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					id: mockOptions.openRouterModelId,
					choices: [{ delta: { content: "test response" } }],
				}
			},
		}

		const mockCreate = vitest.fn().mockResolvedValue(mockStream)

		;(OpenAI as any).prototype.chat = {
			completions: { create: mockCreate },
		} as any

		const systemPrompt = "test system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]
		const metadata: ApiHandlerCreateMessageMetadata = {
			taskId: "test-task-id",
			tools: ["read_file"],
			toolArgs: {} as any,
		}

		const generator = handler.createMessage(systemPrompt, messages, metadata)
		await generator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				tools: [
					{
						type: "function",
						function: {
							name: "read_file",
							description: "A test tool",
							parameters: {
								type: "object",
								properties: {},
								required: [],
							},
						},
					},
				],
				tool_choice: "auto",
			}),
			undefined,
		)
	})

	it("should yield tool_call chunk when tool_calls are in the stream", async () => {
		const handler = new OpenRouterHandler(mockOptions)
		const toolCalls = [
			{
				index: 0,
				id: "tool-call-1",
				function: { name: "read_file", arguments: "{}" },
				type: "function",
			},
		]
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					id: mockOptions.openRouterModelId,
					choices: [{ delta: { tool_calls: toolCalls } }],
				}
			},
		}

		const mockCreate = vitest.fn().mockResolvedValue(mockStream)

		;(OpenAI as any).prototype.chat = {
			completions: { create: mockCreate },
		} as any

		const systemPrompt = "test system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]
		const metadata: ApiHandlerCreateMessageMetadata = {
			taskId: "test-task-id",
			tools: ["read_file"],
			toolArgs: {} as any,
		}

		const generator = handler.createMessage(systemPrompt, messages, metadata)
		const chunks = []
		for await (const chunk of generator) {
			chunks.push(chunk)
		}

		expect(chunks).toContainEqual({
			type: "tool_call",
			toolCalls,
			toolCallType: "openai",
		})
	})
})

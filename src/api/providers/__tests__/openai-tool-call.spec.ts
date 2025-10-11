// npx vitest run api/providers/__tests__/openai-tool-call.spec.ts

import { OpenAiHandler } from "../openai"
import { ApiHandlerOptions } from "../../../shared/api"
import OpenAI from "openai"
import { getToolRegistry } from "../../../core/prompts/tools/schemas/tool-registry"
import { ToolName } from "@roo-code/types"

const mockCreate = vitest.fn()
const mockGenerateFunctionCallSchemas = vitest.fn()

vitest.mock("openai", () => {
	const mockConstructor = vitest.fn()
	return {
		__esModule: true,
		default: mockConstructor.mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		})),
	}
})

vitest.mock("../../../core/prompts/tools/schemas/tool-registry", () => ({
	getToolRegistry: () => ({
		generateFunctionCallSchemas: mockGenerateFunctionCallSchemas,
	}),
}))

describe("OpenAiHandler Tool Call", () => {
	let handler: OpenAiHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			openAiApiKey: "test-api-key",
			openAiModelId: "gpt-4",
			openAiBaseUrl: "https://api.openai.com/v1",
		}
		handler = new OpenAiHandler(mockOptions)
		mockCreate.mockClear()
		mockGenerateFunctionCallSchemas.mockClear()
	})

	it("should include tools and tool_choice in the request when metadata.tools are provided", async () => {
		const systemPrompt = "You are a helpful assistant."
		const messages = [
			{
				role: "user" as const,
				content: "Hello!",
			},
		]
		const metadata = {
			taskId: "test-task-id",
			tools: ["read_file" as ToolName],
			toolArgs: { cwd: ".", supportsComputerUse: true },
		}

		mockGenerateFunctionCallSchemas.mockReturnValue([
			{
				type: "function" as const,
				function: {
					name: "read_file",
					description: "A function to interact with files.",
					parameters: {},
				},
			},
		])

		mockCreate.mockImplementation(async function* () {
			yield {
				choices: [
					{
						delta: { content: "Test response" },
						index: 0,
					},
				],
				usage: null,
			}
		})

		const stream = handler.createMessage(systemPrompt, messages, metadata)

		for await (const _ of stream) {
			// Consume stream
		}

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				tools: [
					{
						type: "function",
						function: {
							name: "read_file",
							description: "A function to interact with files.",
							parameters: {},
						},
					},
				],
				tool_choice: "auto",
			}),
			expect.any(Object),
		)
	})

	it("should yield a tool_call event when the API returns tool_calls", async () => {
		const systemPrompt = "You are a helpful assistant."
		const messages = [
			{
				role: "user" as const,
				content: "Hello!",
			},
		]
		const metadata = {
			taskId: "test-task-id",
			tools: ["write_to_file" as ToolName],
			toolArgs: { cwd: ".", supportsComputerUse: true },
		}

		mockCreate.mockImplementation(async function* () {
			yield {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_123",
									type: "function",
									function: {
										name: "write_to_file",
										arguments: '{"query":"test"}',
									},
								},
							],
						},
						index: 0,
					},
				],
			}
		})

		const stream = handler.createMessage(systemPrompt, messages, metadata)
		const chunks: any[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const toolCallChunk = chunks.find((chunk) => chunk.type === "tool_call")

		expect(toolCallChunk).toBeDefined()
		expect(toolCallChunk.toolCalls).toEqual([
			{
				index: 0,
				id: "call_123",
				type: "function",
				function: {
					name: "write_to_file",
					arguments: '{"query":"test"}',
				},
			},
		])
	})

	it("should not include tools and tool_choice in the request when metadata.tools are not provided", async () => {
		const systemPrompt = "You are a helpful assistant."
		const messages = [
			{
				role: "user" as const,
				content: "Hello!",
			},
		]

		mockCreate.mockImplementation(async function* () {
			yield {
				choices: [
					{
						delta: { content: "Test response" },
						index: 0,
					},
				],
				usage: null,
			}
		})

		const stream = handler.createMessage(systemPrompt, messages)
		for await (const _ of stream) {
			// Consume stream
		}

		expect(mockCreate).toHaveBeenCalledWith(
			expect.not.objectContaining({
				tools: expect.any(Array),
				tool_choice: expect.any(String),
			}),
			expect.any(Object),
		)
	})
})

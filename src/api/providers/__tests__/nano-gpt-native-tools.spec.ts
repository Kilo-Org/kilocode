// kilocode_change - new file
import OpenAI from "openai"

import { NanoGptHandler } from "../nano-gpt"
import type { ApiHandlerOptions } from "../../../shared/api"
import { nanoGptDefaultModelId, nanoGptDefaultModelInfo } from "@roo-code/types"

// Helper to create a mock model result with all required fields
function createMockModelResult(overrides?: Record<string, any>) {
	return {
		id: nanoGptDefaultModelId,
		info: nanoGptDefaultModelInfo,
		format: "openai" as const,
		reasoning: undefined,
		maxTokens: 4096,
		temperature: 0,
		reasoningEffort: undefined,
		reasoningBudget: undefined,
		verbosity: undefined,
		...overrides,
	}
}

describe("NanoGptHandler native tools", () => {
	it("includes tools in request when provided", async () => {
		const mockCreate = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [{ delta: { content: "Test response" } }],
				}
			},
		}))

		const handler = new NanoGptHandler({
			nanoGptApiKey: "test-key",
			nanoGptModelId: nanoGptDefaultModelId,
		} as ApiHandlerOptions)

		// Mock fetchModel to avoid actual API calls
		vi.spyOn(handler, "fetchModel").mockResolvedValue(createMockModelResult())

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
					parameters: { type: "object", properties: { arg1: { type: "string" } } },
				},
			},
		]

		const stream = handler.createMessage("system", [], {
			taskId: "test-task-id",
			tools,
			toolProtocol: "native" as const,
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
			}),
		)
	})

	it("includes parallel_tool_calls: false when toolProtocol is native", async () => {
		const mockCreate = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [{ delta: { content: "Test response" } }],
				}
			},
		}))

		const handler = new NanoGptHandler({
			nanoGptApiKey: "test-key",
			nanoGptModelId: nanoGptDefaultModelId,
		} as ApiHandlerOptions)

		vi.spyOn(handler, "fetchModel").mockResolvedValue(createMockModelResult())

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

		const stream = handler.createMessage("system", [], {
			taskId: "test-task-id",
			tools,
			toolProtocol: "native" as const,
		})
		await stream.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				parallel_tool_calls: false,
			}),
		)
	})

	it("emits tool_call_partial chunks for native tool calls", async () => {
		const mockCreate = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_123",
										function: {
											name: "test_tool",
											arguments: '{"arg":',
										},
									},
								],
							},
						},
					],
				}
				yield {
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										function: {
											arguments: '"value"}',
										},
									},
								],
							},
						},
					],
				}
				yield {
					choices: [
						{
							finish_reason: "tool_calls",
							delta: {},
						},
					],
				}
			},
		}))

		const handler = new NanoGptHandler({
			nanoGptApiKey: "test-key",
			nanoGptModelId: nanoGptDefaultModelId,
		} as ApiHandlerOptions)

		vi.spyOn(handler, "fetchModel").mockResolvedValue(createMockModelResult())

		const mockClient = {
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		} as unknown as OpenAI
		;(handler as unknown as { client: OpenAI }).client = mockClient

		const stream = handler.createMessage("system", [], {
			taskId: "test-task-id",
			tools: [
				{
					type: "function",
					function: {
						name: "test_tool",
						description: "test",
						parameters: { type: "object", properties: {} },
					},
				},
			],
			toolProtocol: "native" as const,
		})

		const chunks: any[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const toolCallPartials = chunks.filter((c) => c.type === "tool_call_partial")
		expect(toolCallPartials).toHaveLength(2)
		expect(toolCallPartials[0]).toEqual({
			type: "tool_call_partial",
			index: 0,
			id: "call_123",
			name: "test_tool",
			arguments: '{"arg":',
		})
		expect(toolCallPartials[1]).toEqual({
			type: "tool_call_partial",
			index: 0,
			id: undefined,
			name: undefined,
			arguments: '"value"}',
		})
	})

	it("emits tool_call_end chunks when finish_reason is tool_calls", async () => {
		const mockCreate = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_123",
										function: {
											name: "test_tool",
											arguments: '{"arg":"value"}',
										},
									},
								],
							},
						},
					],
				}
				yield {
					choices: [
						{
							finish_reason: "tool_calls",
							delta: {},
						},
					],
				}
			},
		}))

		const handler = new NanoGptHandler({
			nanoGptApiKey: "test-key",
			nanoGptModelId: nanoGptDefaultModelId,
		} as ApiHandlerOptions)

		vi.spyOn(handler, "fetchModel").mockResolvedValue(createMockModelResult())

		const mockClient = {
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		} as unknown as OpenAI
		;(handler as unknown as { client: OpenAI }).client = mockClient

		const stream = handler.createMessage("system", [], {
			taskId: "test-task-id",
			tools: [
				{
					type: "function",
					function: {
						name: "test_tool",
						description: "test",
						parameters: { type: "object", properties: {} },
					},
				},
			],
			toolProtocol: "native" as const,
		})

		const chunks: any[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const toolCallEnds = chunks.filter((c) => c.type === "tool_call_end")
		expect(toolCallEnds).toHaveLength(1)
		expect(toolCallEnds[0]).toEqual({
			type: "tool_call_end",
			id: "call_123",
		})
	})

	it("does not include parallel_tool_calls when toolProtocol is not native", async () => {
		const mockCreate = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [{ delta: { content: "Test response" } }],
				}
			},
		}))

		const handler = new NanoGptHandler({
			nanoGptApiKey: "test-key",
			nanoGptModelId: nanoGptDefaultModelId,
		} as ApiHandlerOptions)

		vi.spyOn(handler, "fetchModel").mockResolvedValue(createMockModelResult())

		const mockClient = {
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		} as unknown as OpenAI
		;(handler as unknown as { client: OpenAI }).client = mockClient

		const stream = handler.createMessage("system", [], {
			taskId: "test-task-id",
		})
		await stream.next()

		const callArgs = mockCreate.mock.calls[0][0]
		expect(callArgs).not.toHaveProperty("parallel_tool_calls")
	})

	it("includes tool_choice when provided", async () => {
		const mockCreate = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [{ delta: { content: "Test response" } }],
				}
			},
		}))

		const handler = new NanoGptHandler({
			nanoGptApiKey: "test-key",
			nanoGptModelId: nanoGptDefaultModelId,
		} as ApiHandlerOptions)

		vi.spyOn(handler, "fetchModel").mockResolvedValue(createMockModelResult())

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

		const stream = handler.createMessage("system", [], {
			taskId: "test-task-id",
			tools,
			tool_choice: { type: "function", function: { name: "test_tool" } },
			toolProtocol: "native" as const,
		})
		await stream.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				tool_choice: { type: "function", function: { name: "test_tool" } },
			}),
		)
	})
})

// npx vitest run api/providers/__tests__/lmstudio-native-tools.spec.ts

// Mock OpenAI client - must come before other imports
const mockCreate = vi.fn()
vi.mock("openai", () => {
	return {
		__esModule: true,
		default: vi.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate,
				},
			},
		})),
	}
})

import { LmStudioHandler } from "../lm-studio"
import { NativeToolCallParser } from "../../../core/assistant-message/NativeToolCallParser"
import type { ApiHandlerOptions } from "../../../shared/api"

describe("LmStudioHandler Native Tools", () => {
	let handler: LmStudioHandler
	let mockOptions: ApiHandlerOptions

	const testTools = [
		{
			type: "function" as const,
			function: {
				name: "test_tool",
				description: "A test tool",
				parameters: {
					type: "object",
					properties: {
						arg1: { type: "string", description: "First argument" },
					},
					required: ["arg1"],
				},
			},
		},
	]

	beforeEach(() => {
		vi.clearAllMocks()

		mockOptions = {
			apiModelId: "local-model",
			lmStudioModelId: "local-model",
			lmStudioBaseUrl: "http://localhost:1234",
		}
		handler = new LmStudioHandler(mockOptions)

		// Clear NativeToolCallParser state before each test
		NativeToolCallParser.clearRawChunkState()
	})

	describe("Native Tool Calling Support", () => {
		it("should include tools in request when model supports native tools and tools are provided", async () => {
			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [{ delta: { content: "Test response" } }],
					}
				},
			}))

			const stream = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
			})
			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tools: expect.arrayContaining([
						expect.objectContaining({
							type: "function",
							function: expect.objectContaining({
								name: "test_tool",
							}),
						}),
					]),
					parallel_tool_calls: false,
				}),
			)
		})

		it("should include tool_choice when provided", async () => {
			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [{ delta: { content: "Test response" } }],
					}
				},
			}))

			const stream = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				tool_choice: "auto",
			})
			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tool_choice: "auto",
				}),
			)
		})

		it("should not include tools when toolProtocol is xml", async () => {
			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [{ delta: { content: "Test response" } }],
					}
				},
			}))

			const stream = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				toolProtocol: "xml",
			})
			await stream.next()

			const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0]
			expect(callArgs).not.toHaveProperty("tools")
			expect(callArgs).not.toHaveProperty("tool_choice")
		})

		it("should yield tool_call_partial chunks during streaming", async () => {
			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {
									tool_calls: [
										{
											index: 0,
											id: "call_lmstudio_123",
											function: {
												name: "test_tool",
												arguments: '{"arg1":',
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
				},
			}))

			const stream = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
			})

			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks).toContainEqual({
				type: "tool_call_partial",
				index: 0,
				id: "call_lmstudio_123",
				name: "test_tool",
				arguments: '{"arg1":',
			})

			expect(chunks).toContainEqual({
				type: "tool_call_partial",
				index: 0,
				id: undefined,
				name: undefined,
				arguments: '"value"}',
			})
		})

		it("should set parallel_tool_calls based on metadata", async () => {
			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [{ delta: { content: "Test response" } }],
					}
				},
			}))

			const stream = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				parallelToolCalls: true,
			})
			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					parallel_tool_calls: true,
				}),
			)
		})

		it("should yield tool_call_end events when finish_reason is tool_calls", async () => {
			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {
									tool_calls: [
										{
											index: 0,
											id: "call_lmstudio_test",
											function: {
												name: "test_tool",
												arguments: '{"arg1":"value"}',
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
								delta: {},
								finish_reason: "tool_calls",
							},
						],
					}
				},
			}))

			const stream = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
			})

			const chunks = []
			for await (const chunk of stream) {
				// Simulate what Task.ts does: when we receive tool_call_partial,
				// process it through NativeToolCallParser to populate rawChunkTracker
				if (chunk.type === "tool_call_partial") {
					NativeToolCallParser.processRawChunk({
						index: chunk.index,
						id: chunk.id,
						name: chunk.name,
						arguments: chunk.arguments,
					})
				}
				chunks.push(chunk)
			}

			// Should have tool_call_partial and tool_call_end
			const partialChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
			const endChunks = chunks.filter((chunk) => chunk.type === "tool_call_end")

			expect(partialChunks).toHaveLength(1)
			expect(endChunks).toHaveLength(1)
			expect(endChunks[0].id).toBe("call_lmstudio_test")
		})

		it("should work with parallel tool calls disabled", async () => {
			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [{ delta: { content: "Response" } }],
					}
				},
			}))

			const stream = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
				parallelToolCalls: false,
			})
			await stream.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					parallel_tool_calls: false,
				}),
			)
		})

		it("should handle reasoning content alongside tool calls", async () => {
			mockCreate.mockImplementationOnce(() => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {
									content: "<think>Thinking about this...</think>",
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
											id: "call_after_think",
											function: {
												name: "test_tool",
												arguments: '{"arg1":"result"}',
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
								delta: {},
								finish_reason: "tool_calls",
							},
						],
					}
				},
			}))

			const stream = handler.createMessage("test prompt", [], {
				taskId: "test-task-id",
				tools: testTools,
			})

			const chunks = []
			for await (const chunk of stream) {
				if (chunk.type === "tool_call_partial") {
					NativeToolCallParser.processRawChunk({
						index: chunk.index,
						id: chunk.id,
						name: chunk.name,
						arguments: chunk.arguments,
					})
				}
				chunks.push(chunk)
			}

			// Should have reasoning, tool_call_partial, and tool_call_end
			const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning")
			const partialChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
			const endChunks = chunks.filter((chunk) => chunk.type === "tool_call_end")

			expect(reasoningChunks).toHaveLength(1)
			expect(reasoningChunks[0].text).toBe("Thinking about this...")
			expect(partialChunks).toHaveLength(1)
			expect(endChunks).toHaveLength(1)
		})
	})
})

import OpenAI from "openai"

import { OpenAiHandler } from "../openai"
import { OpenAiNativeHandler } from "../openai-native"
import type { ApiHandlerOptions } from "../../../shared/api"

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
			}),
			expect.anything(),
		)
		// Verify parallel_tool_calls is NOT included when parallelToolCalls is not explicitly true
		// This is required for LiteLLM/Bedrock compatibility (see COM-406)
		const callArgs = mockCreate.mock.calls[0][0]
		expect(callArgs).not.toHaveProperty("parallel_tool_calls")
	})
})

describe("OpenAiNativeHandler MCP tool schema handling", () => {
	it("should add additionalProperties: false to MCP tools while keeping strict: false", async () => {
		let capturedRequestBody: any

		const handler = new OpenAiNativeHandler({
			openAiNativeApiKey: "test-key",
			apiModelId: "gpt-4o",
		} as ApiHandlerOptions)

		// Mock the responses API call
		const mockClient = {
			responses: {
				create: vi.fn().mockImplementation((body: any) => {
					capturedRequestBody = body
					return {
						[Symbol.asyncIterator]: async function* () {
							yield {
								type: "response.done",
								response: {
									output: [{ type: "message", content: [{ type: "output_text", text: "test" }] }],
									usage: { input_tokens: 10, output_tokens: 5 },
								},
							}
						},
					}
				}),
			},
		}
		;(handler as any).client = mockClient

		const mcpTools: OpenAI.Chat.ChatCompletionTool[] = [
			{
				type: "function",
				function: {
					name: "mcp--github--get_me",
					description: "Get current GitHub user",
					parameters: {
						type: "object",
						properties: {
							token: { type: "string", description: "API token" },
						},
						required: ["token"],
					},
				},
			},
		]

		const stream = handler.createMessage("system prompt", [], {
			taskId: "test-task-id",
			tools: mcpTools,
			toolProtocol: "native" as const,
		})

		// Consume the stream
		for await (const _ of stream) {
			// Just consume
		}

		// Verify the request body
		expect(capturedRequestBody.tools).toBeDefined()
		expect(capturedRequestBody.tools.length).toBe(1)

		const tool = capturedRequestBody.tools[0]
		expect(tool.name).toBe("mcp--github--get_me")
		expect(tool.strict).toBe(false) // MCP tools should have strict: false
		expect(tool.parameters.additionalProperties).toBe(false) // Should have additionalProperties: false
		expect(tool.parameters.required).toEqual(["token"]) // Should preserve original required array
	})

	it("should add additionalProperties: false and required array to non-MCP tools with strict: true", async () => {
		let capturedRequestBody: any

		const handler = new OpenAiNativeHandler({
			openAiNativeApiKey: "test-key",
			apiModelId: "gpt-4o",
		} as ApiHandlerOptions)

		// Mock the responses API call
		const mockClient = {
			responses: {
				create: vi.fn().mockImplementation((body: any) => {
					capturedRequestBody = body
					return {
						[Symbol.asyncIterator]: async function* () {
							yield {
								type: "response.done",
								response: {
									output: [{ type: "message", content: [{ type: "output_text", text: "test" }] }],
									usage: { input_tokens: 10, output_tokens: 5 },
								},
							}
						},
					}
				}),
			},
		}
		;(handler as any).client = mockClient

		const regularTools: OpenAI.Chat.ChatCompletionTool[] = [
			{
				type: "function",
				function: {
					name: "read_file",
					description: "Read a file from the filesystem",
					parameters: {
						type: "object",
						properties: {
							path: { type: "string", description: "File path" },
							encoding: { type: "string", description: "File encoding" },
						},
					},
				},
			},
		]

		const stream = handler.createMessage("system prompt", [], {
			taskId: "test-task-id",
			tools: regularTools,
			toolProtocol: "native" as const,
		})

		// Consume the stream
		for await (const _ of stream) {
			// Just consume
		}

		// Verify the request body
		expect(capturedRequestBody.tools).toBeDefined()
		expect(capturedRequestBody.tools.length).toBe(1)

		const tool = capturedRequestBody.tools[0]
		expect(tool.name).toBe("read_file")
		expect(tool.strict).toBe(true) // Non-MCP tools should have strict: true
		expect(tool.parameters.additionalProperties).toBe(false) // Should have additionalProperties: false
		expect(tool.parameters.required).toEqual(["path", "encoding"]) // Should have all properties as required
	})

	it("should recursively add additionalProperties: false to nested objects in MCP tools", async () => {
		let capturedRequestBody: any

		const handler = new OpenAiNativeHandler({
			openAiNativeApiKey: "test-key",
			apiModelId: "gpt-4o",
		} as ApiHandlerOptions)

		// Mock the responses API call
		const mockClient = {
			responses: {
				create: vi.fn().mockImplementation((body: any) => {
					capturedRequestBody = body
					return {
						[Symbol.asyncIterator]: async function* () {
							yield {
								type: "response.done",
								response: {
									output: [{ type: "message", content: [{ type: "output_text", text: "test" }] }],
									usage: { input_tokens: 10, output_tokens: 5 },
								},
							}
						},
					}
				}),
			},
		}
		;(handler as any).client = mockClient

		const mcpToolsWithNestedObjects: OpenAI.Chat.ChatCompletionTool[] = [
			{
				type: "function",
				function: {
					name: "mcp--linear--create_issue",
					description: "Create a Linear issue",
					parameters: {
						type: "object",
						properties: {
							title: { type: "string" },
							metadata: {
								type: "object",
								properties: {
									priority: { type: "number" },
									labels: {
										type: "array",
										items: {
											type: "object",
											properties: {
												name: { type: "string" },
											},
										},
									},
								},
							},
						},
					},
				},
			},
		]

		const stream = handler.createMessage("system prompt", [], {
			taskId: "test-task-id",
			tools: mcpToolsWithNestedObjects,
			toolProtocol: "native" as const,
		})

		// Consume the stream
		for await (const _ of stream) {
			// Just consume
		}

		// Verify the request body
		const tool = capturedRequestBody.tools[0]
		expect(tool.strict).toBe(false) // MCP tool should have strict: false
		expect(tool.parameters.additionalProperties).toBe(false) // Root level
		expect(tool.parameters.properties.metadata.additionalProperties).toBe(false) // Nested object
		expect(tool.parameters.properties.metadata.properties.labels.items.additionalProperties).toBe(false) // Array items
	})

	it("should handle missing call_id and name in tool_call_arguments.delta by using pending tool identity", async () => {
		const handler = new OpenAiNativeHandler({
			openAiNativeApiKey: "test-key",
			apiModelId: "gpt-4o",
		} as ApiHandlerOptions)

		const mockClient = {
			responses: {
				create: vi.fn().mockImplementation(() => {
					return {
						[Symbol.asyncIterator]: async function* () {
							// 1. Emit output_item.added with tool identity
							yield {
								type: "response.output_item.added",
								item: {
									type: "function_call",
									call_id: "call_123",
									name: "read_file",
									arguments: "",
								},
							}

							// 2. Emit tool_call_arguments.delta WITHOUT identity (just args)
							yield {
								type: "response.function_call_arguments.delta",
								delta: '{"path":',
							}

							// 3. Emit another delta
							yield {
								type: "response.function_call_arguments.delta",
								delta: '"/tmp/test.txt"}',
							}

							// 4. Emit output_item.done
							yield {
								type: "response.output_item.done",
								item: {
									type: "function_call",
									call_id: "call_123",
									name: "read_file",
									arguments: '{"path":"/tmp/test.txt"}',
								},
							}
						},
					}
				}),
			},
		}
		;(handler as any).client = mockClient

		const stream = handler.createMessage("system prompt", [], {
			taskId: "test-task-id",
		})

		const chunks: any[] = []
		for await (const chunk of stream) {
			if (chunk.type === "tool_call_partial") {
				chunks.push(chunk)
			}
		}

		expect(chunks.length).toBe(2)
		expect(chunks[0]).toEqual({
			type: "tool_call_partial",
			index: 0,
			id: "call_123", // Should be filled from pendingToolCallId
			name: "read_file", // Should be filled from pendingToolCallName
			arguments: '{"path":',
		})
		expect(chunks[1]).toEqual({
			type: "tool_call_partial",
			index: 0,
			id: "call_123",
			name: "read_file",
			arguments: '"/tmp/test.txt"}',
		})
	})
})

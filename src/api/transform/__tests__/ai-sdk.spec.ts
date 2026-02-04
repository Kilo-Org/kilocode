import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import {
	convertToAiSdkMessages,
	convertToolsForAiSdk,
	processAiSdkStreamPart,
	mapToolChoice,
	extractAiSdkErrorMessage,
	handleAiSdkError,
	flattenAiSdkMessagesToStringContent,
} from "../ai-sdk"

vitest.mock("ai", () => ({
	tool: vitest.fn((t) => t),
	jsonSchema: vitest.fn((s) => s),
}))

describe("AI SDK conversion utilities", () => {
	describe("convertToAiSdkMessages", () => {
		it("converts simple string messages", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there" },
			]

			const result = convertToAiSdkMessages(messages)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ role: "user", content: "Hello" })
			expect(result[1]).toEqual({ role: "assistant", content: "Hi there" })
		})

		it("converts user messages with text content blocks", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [{ type: "text", text: "Hello world" }],
				},
			]

			const result = convertToAiSdkMessages(messages)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				role: "user",
				content: [{ type: "text", text: "Hello world" }],
			})
		})

		it("converts user messages with image content", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "What is in this image?" },
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: "base64encodeddata",
							},
						},
					],
				},
			]

			const result = convertToAiSdkMessages(messages)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				role: "user",
				content: [
					{ type: "text", text: "What is in this image?" },
					{
						type: "image",
						image: "data:image/png;base64,base64encodeddata",
						mimeType: "image/png",
					},
				],
			})
		})

		it("converts user messages with URL image content", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "What is in this image?" },
						{
							type: "image",
							source: {
								type: "url",
								url: "https://example.com/image.png",
							},
						} as any,
					],
				},
			]

			const result = convertToAiSdkMessages(messages)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				role: "user",
				content: [
					{ type: "text", text: "What is in this image?" },
					{
						type: "image",
						image: "https://example.com/image.png",
					},
				],
			})
		})

		it("converts tool results into separate tool role messages with resolved tool names", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_123",
							name: "read_file",
							input: { path: "test.ts" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_123",
							content: "Tool result content",
						},
					],
				},
			]

			const result = convertToAiSdkMessages(messages)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_123",
						toolName: "read_file",
						input: { path: "test.ts" },
					},
				],
			})
			// Tool results now go to role: "tool" messages per AI SDK v6 schema
			expect(result[1]).toEqual({
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_123",
						toolName: "read_file",
						output: { type: "text", value: "Tool result content" },
					},
				],
			})
		})

		it("uses unknown_tool for tool results without matching tool call", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_orphan",
							content: "Orphan result",
						},
					],
				},
			]

			const result = convertToAiSdkMessages(messages)

			expect(result).toHaveLength(1)
			// Tool results go to role: "tool" messages
			expect(result[0]).toEqual({
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_orphan",
						toolName: "unknown_tool",
						output: { type: "text", value: "Orphan result" },
					},
				],
			})
		})

		it("separates tool results and text content into different messages", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_123",
							name: "read_file",
							input: { path: "test.ts" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_123",
							content: "File contents here",
						},
						{
							type: "text",
							text: "Please analyze this file",
						},
					],
				},
			]

			const result = convertToAiSdkMessages(messages)

			expect(result).toHaveLength(3)
			expect(result[0]).toEqual({
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_123",
						toolName: "read_file",
						input: { path: "test.ts" },
					},
				],
			})
			// Tool results go first in a "tool" message
			expect(result[1]).toEqual({
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_123",
						toolName: "read_file",
						output: { type: "text", value: "File contents here" },
					},
				],
			})
			// Text content goes in a separate "user" message
			expect(result[2]).toEqual({
				role: "user",
				content: [{ type: "text", text: "Please analyze this file" }],
			})
		})

		it("converts assistant messages with tool use", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Let me read that file" },
						{
							type: "tool_use",
							id: "call_456",
							name: "read_file",
							input: { path: "test.ts" },
						},
					],
				},
			]

			const result = convertToAiSdkMessages(messages)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				role: "assistant",
				content: [
					{ type: "text", text: "Let me read that file" },
					{
						type: "tool-call",
						toolCallId: "call_456",
						toolName: "read_file",
						input: { path: "test.ts" },
					},
				],
			})
		})

		it("handles empty assistant content", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [],
				},
			]

			const result = convertToAiSdkMessages(messages)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				role: "assistant",
				content: [{ type: "text", text: "" }],
			})
		})
	})

	describe("convertToolsForAiSdk", () => {
		it("returns undefined for empty tools", () => {
			expect(convertToolsForAiSdk(undefined)).toBeUndefined()
			expect(convertToolsForAiSdk([])).toBeUndefined()
		})

		it("converts function tools to AI SDK format", () => {
			const tools: OpenAI.Chat.ChatCompletionTool[] = [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read a file from disk",
						parameters: {
							type: "object",
							properties: {
								path: { type: "string", description: "File path" },
							},
							required: ["path"],
						},
					},
				},
			]

			const result = convertToolsForAiSdk(tools)

			expect(result).toBeDefined()
			expect(result!.read_file).toBeDefined()
			expect(result!.read_file.description).toBe("Read a file from disk")
		})

		it("converts multiple tools", () => {
			const tools: OpenAI.Chat.ChatCompletionTool[] = [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read a file",
						parameters: {},
					},
				},
				{
					type: "function",
					function: {
						name: "write_file",
						description: "Write a file",
						parameters: {},
					},
				},
			]

			const result = convertToolsForAiSdk(tools)

			expect(result).toBeDefined()
			expect(Object.keys(result!)).toHaveLength(2)
			expect(result!.read_file).toBeDefined()
			expect(result!.write_file).toBeDefined()
		})
	})

	describe("processAiSdkStreamPart", () => {
		it("processes text-delta chunks", () => {
			const part = { type: "text-delta" as const, id: "1", text: "Hello" }
			const chunks = [...processAiSdkStreamPart(part)]

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({ type: "text", text: "Hello" })
		})

		it("processes text chunks (fullStream format)", () => {
			const part = { type: "text" as const, text: "Hello from fullStream" }
			const chunks = [...processAiSdkStreamPart(part as any)]

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({ type: "text", text: "Hello from fullStream" })
		})

		it("processes reasoning-delta chunks", () => {
			const part = { type: "reasoning-delta" as const, id: "1", text: "thinking..." }
			const chunks = [...processAiSdkStreamPart(part)]

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({ type: "reasoning", text: "thinking..." })
		})

		it("processes reasoning chunks (fullStream format)", () => {
			const part = { type: "reasoning" as const, text: "reasoning from fullStream" }
			const chunks = [...processAiSdkStreamPart(part as any)]

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({ type: "reasoning", text: "reasoning from fullStream" })
		})

		it("processes tool-input-start chunks", () => {
			const part = { type: "tool-input-start" as const, id: "call_1", toolName: "read_file" }
			const chunks = [...processAiSdkStreamPart(part)]

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({ type: "tool_call_start", id: "call_1", name: "read_file" })
		})

		it("processes tool-input-delta chunks", () => {
			const part = { type: "tool-input-delta" as const, id: "call_1", delta: '{"path":' }
			const chunks = [...processAiSdkStreamPart(part)]

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({ type: "tool_call_delta", id: "call_1", delta: '{"path":' })
		})

		it("processes tool-input-end chunks", () => {
			const part = { type: "tool-input-end" as const, id: "call_1" }
			const chunks = [...processAiSdkStreamPart(part)]

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({ type: "tool_call_end", id: "call_1" })
		})

		it("ignores tool-call chunks to prevent duplicate tools in UI", () => {
			// tool-call is intentionally ignored because tool-input-start/delta/end already
			// provide complete tool call information. Emitting tool-call would cause duplicate
			// tools in the UI for AI SDK providers (e.g., DeepSeek, Moonshot).
			const part = {
				type: "tool-call" as const,
				toolCallId: "call_1",
				toolName: "read_file",
				input: { path: "test.ts" },
			}
			const chunks = [...processAiSdkStreamPart(part)]

			expect(chunks).toHaveLength(0)
		})

		it("processes source chunks with URL", () => {
			const part = {
				type: "source" as const,
				url: "https://example.com",
				title: "Example Source",
			}
			const chunks = [...processAiSdkStreamPart(part as any)]

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({
				type: "grounding",
				sources: [
					{
						title: "Example Source",
						url: "https://example.com",
						snippet: undefined,
					},
				],
			})
		})

		it("processes error chunks", () => {
			const part = { type: "error" as const, error: new Error("Test error") }
			const chunks = [...processAiSdkStreamPart(part)]

			expect(chunks).toHaveLength(1)
			expect(chunks[0]).toEqual({
				type: "error",
				error: "StreamError",
				message: "Test error",
			})
		})

		it("ignores lifecycle events", () => {
			const lifecycleEvents = [
				{ type: "text-start" as const },
				{ type: "text-end" as const },
				{ type: "reasoning-start" as const },
				{ type: "reasoning-end" as const },
				{ type: "start-step" as const },
				{ type: "finish-step" as const },
				{ type: "start" as const },
				{ type: "finish" as const },
				{ type: "abort" as const },
			]

			for (const event of lifecycleEvents) {
				const chunks = [...processAiSdkStreamPart(event as any)]
				expect(chunks).toHaveLength(0)
			}
		})
	})

	describe("mapToolChoice", () => {
		it("should return undefined for null or undefined", () => {
			expect(mapToolChoice(null)).toBeUndefined()
			expect(mapToolChoice(undefined)).toBeUndefined()
		})

		it("should handle string tool choices", () => {
			expect(mapToolChoice("auto")).toBe("auto")
			expect(mapToolChoice("none")).toBe("none")
			expect(mapToolChoice("required")).toBe("required")
		})

		it("should return auto for unknown string values", () => {
			expect(mapToolChoice("unknown")).toBe("auto")
			expect(mapToolChoice("invalid")).toBe("auto")
		})

		it("should handle object tool choice with function name", () => {
			const result = mapToolChoice({
				type: "function",
				function: { name: "my_tool" },
			})

			expect(result).toEqual({ type: "tool", toolName: "my_tool" })
		})

		it("should return undefined for object without function name", () => {
			const result = mapToolChoice({
				type: "function",
				function: {},
			})

			expect(result).toBeUndefined()
		})

		it("should return undefined for object with non-function type", () => {
			const result = mapToolChoice({
				type: "other",
				function: { name: "my_tool" },
			})

			expect(result).toBeUndefined()
		})
	})

	describe("extractAiSdkErrorMessage", () => {
		it("should return 'Unknown error' for null/undefined", () => {
			expect(extractAiSdkErrorMessage(null)).toBe("Unknown error")
			expect(extractAiSdkErrorMessage(undefined)).toBe("Unknown error")
		})

		it("should extract message from AI_RetryError", () => {
			const retryError = {
				name: "AI_RetryError",
				message: "Failed after 3 attempts",
				errors: [new Error("Error 1"), new Error("Error 2"), new Error("Too Many Requests")],
				lastError: { message: "Too Many Requests", status: 429 },
			}

			const result = extractAiSdkErrorMessage(retryError)
			expect(result).toBe("Failed after 3 attempts (429): Too Many Requests")
		})

		it("should handle AI_RetryError without status", () => {
			const retryError = {
				name: "AI_RetryError",
				message: "Failed after 2 attempts",
				errors: [new Error("Error 1"), new Error("Connection failed")],
				lastError: { message: "Connection failed" },
			}

			const result = extractAiSdkErrorMessage(retryError)
			expect(result).toBe("Failed after 2 attempts: Connection failed")
		})

		it("should extract message from AI_APICallError", () => {
			const apiError = {
				name: "AI_APICallError",
				message: "Rate limit exceeded",
				status: 429,
			}

			const result = extractAiSdkErrorMessage(apiError)
			expect(result).toBe("API Error (429): Rate limit exceeded")
		})

		it("should handle AI_APICallError without status", () => {
			const apiError = {
				name: "AI_APICallError",
				message: "Connection timeout",
			}

			const result = extractAiSdkErrorMessage(apiError)
			expect(result).toBe("Connection timeout")
		})

		it("should extract message from standard Error", () => {
			const error = new Error("Something went wrong")
			expect(extractAiSdkErrorMessage(error)).toBe("Something went wrong")
		})

		it("should convert non-Error to string", () => {
			expect(extractAiSdkErrorMessage("string error")).toBe("string error")
			expect(extractAiSdkErrorMessage({ custom: "object" })).toBe("[object Object]")
		})
	})

	describe("handleAiSdkError", () => {
		it("should wrap error with provider name", () => {
			const error = new Error("API Error")
			const result = handleAiSdkError(error, "Fireworks")

			expect(result.message).toBe("Fireworks: API Error")
		})

		it("should preserve status code from AI_RetryError", () => {
			const retryError = {
				name: "AI_RetryError",
				errors: [new Error("Too Many Requests")],
				lastError: { message: "Too Many Requests", status: 429 },
			}

			const result = handleAiSdkError(retryError, "Groq")

			expect(result.message).toContain("Groq:")
			expect(result.message).toContain("429")
			expect((result as any).status).toBe(429)
		})

		it("should preserve status code from AI_APICallError", () => {
			const apiError = {
				name: "AI_APICallError",
				message: "Unauthorized",
				status: 401,
			}

			const result = handleAiSdkError(apiError, "DeepSeek")

			expect(result.message).toContain("DeepSeek:")
			expect(result.message).toContain("401")
			expect((result as any).status).toBe(401)
		})

		it("should preserve original error as cause", () => {
			const originalError = new Error("Original error")
			const result = handleAiSdkError(originalError, "Cerebras")

			expect((result as any).cause).toBe(originalError)
		})
	})

	describe("flattenAiSdkMessagesToStringContent", () => {
		it("should return messages unchanged if content is already a string", () => {
			const messages = [
				{ role: "user" as const, content: "Hello" },
				{ role: "assistant" as const, content: "Hi there" },
			]

			const result = flattenAiSdkMessagesToStringContent(messages)

			expect(result).toEqual(messages)
		})

		it("should flatten user messages with only text parts to string", () => {
			const messages = [
				{
					role: "user" as const,
					content: [
						{ type: "text" as const, text: "Hello" },
						{ type: "text" as const, text: "World" },
					],
				},
			]

			const result = flattenAiSdkMessagesToStringContent(messages)

			expect(result).toHaveLength(1)
			expect(result[0].role).toBe("user")
			expect(result[0].content).toBe("Hello\nWorld")
		})

		it("should flatten assistant messages with only text parts to string", () => {
			const messages = [
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "I am an assistant" }],
				},
			]

			const result = flattenAiSdkMessagesToStringContent(messages)

			expect(result).toHaveLength(1)
			expect(result[0].role).toBe("assistant")
			expect(result[0].content).toBe("I am an assistant")
		})

		it("should not flatten user messages with image parts", () => {
			const messages = [
				{
					role: "user" as const,
					content: [
						{ type: "text" as const, text: "Look at this" },
						{ type: "image" as const, image: "data:image/png;base64,abc123" },
					],
				},
			]

			const result = flattenAiSdkMessagesToStringContent(messages)

			expect(result).toEqual(messages)
		})

		it("should not flatten assistant messages with tool calls", () => {
			const messages = [
				{
					role: "assistant" as const,
					content: [
						{ type: "text" as const, text: "Let me use a tool" },
						{
							type: "tool-call" as const,
							toolCallId: "123",
							toolName: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
			]

			const result = flattenAiSdkMessagesToStringContent(messages)

			expect(result).toEqual(messages)
		})

		it("should not flatten tool role messages", () => {
			const messages = [
				{
					role: "tool" as const,
					content: [
						{
							type: "tool-result" as const,
							toolCallId: "123",
							toolName: "test",
							output: { type: "text" as const, value: "result" },
						},
					],
				},
			] as any

			const result = flattenAiSdkMessagesToStringContent(messages)

			expect(result).toEqual(messages)
		})

		it("should respect flattenUserMessages option", () => {
			const messages = [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: "Hello" }],
				},
			]

			const result = flattenAiSdkMessagesToStringContent(messages, { flattenUserMessages: false })

			expect(result).toEqual(messages)
		})

		it("should respect flattenAssistantMessages option", () => {
			const messages = [
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Hi" }],
				},
			]

			const result = flattenAiSdkMessagesToStringContent(messages, { flattenAssistantMessages: false })

			expect(result).toEqual(messages)
		})

		it("should handle mixed message types correctly", () => {
			const messages = [
				{ role: "user" as const, content: "Simple string" },
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: "Text parts" }],
				},
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Assistant text" }],
				},
				{
					role: "assistant" as const,
					content: [
						{ type: "text" as const, text: "With tool" },
						{ type: "tool-call" as const, toolCallId: "456", toolName: "test", input: {} },
					],
				},
			]

			const result = flattenAiSdkMessagesToStringContent(messages)

			expect(result[0].content).toBe("Simple string") // unchanged
			expect(result[1].content).toBe("Text parts") // flattened
			expect(result[2].content).toBe("Assistant text") // flattened
			expect(result[3]).toEqual(messages[3]) // unchanged (has tool call)
		})

		it("should handle empty text parts", () => {
			const messages = [
				{
					role: "user" as const,
					content: [
						{ type: "text" as const, text: "" },
						{ type: "text" as const, text: "Hello" },
					],
				},
			]

			const result = flattenAiSdkMessagesToStringContent(messages)

			expect(result[0].content).toBe("\nHello")
		})
	})
})

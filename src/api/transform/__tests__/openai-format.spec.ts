// npx vitest run api/transform/__tests__/openai-format.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { convertToOpenAiMessages } from "../openai-format"
import { normalizeMistralToolCallId } from "../mistral-format"

describe("convertToOpenAiMessages", () => {
	it("should convert simple text messages", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello",
			},
			{
				role: "assistant",
				content: "Hi there!",
			},
		]

		const openAiMessages = convertToOpenAiMessages(anthropicMessages)
		expect(openAiMessages).toHaveLength(2)
		expect(openAiMessages[0]).toEqual({
			role: "user",
			content: "Hello",
		})
		expect(openAiMessages[1]).toEqual({
			role: "assistant",
			content: "Hi there!",
		})
	})

	it("should handle messages with image content", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "What is in this image?",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "base64data",
						},
					},
				],
			},
		]

		const openAiMessages = convertToOpenAiMessages(anthropicMessages)
		expect(openAiMessages).toHaveLength(1)
		expect(openAiMessages[0].role).toBe("user")

		const content = openAiMessages[0].content as Array<{
			type: string
			text?: string
			image_url?: { url: string }
		}>

		expect(Array.isArray(content)).toBe(true)
		expect(content).toHaveLength(2)
		expect(content[0]).toEqual({ type: "text", text: "What is in this image?" })
		expect(content[1]).toEqual({
			type: "image_url",
			image_url: { url: "data:image/jpeg;base64,base64data" },
		})
	})

	it("should handle assistant messages with tool use (no normalization without normalizeToolCallId)", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "Let me check the weather.",
					},
					{
						type: "tool_use",
						id: "weather-123",
						name: "get_weather",
						input: { city: "London" },
					},
				],
			},
		]

		const openAiMessages = convertToOpenAiMessages(anthropicMessages)
		expect(openAiMessages).toHaveLength(1)

		const assistantMessage = openAiMessages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam
		expect(assistantMessage.role).toBe("assistant")
		expect(assistantMessage.content).toBe("Let me check the weather.")
		expect(assistantMessage.tool_calls).toHaveLength(1)
		expect(assistantMessage.tool_calls![0]).toEqual({
			id: "weather-123", // Not normalized without normalizeToolCallId function
			type: "function",
			function: {
				name: "get_weather",
				arguments: JSON.stringify({ city: "London" }),
			},
		})
	})

	it("should handle user messages with tool results (no normalization without normalizeToolCallId)", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "weather-123",
						content: "Current temperature in London: 20°C",
					},
				],
			},
		]

		const openAiMessages = convertToOpenAiMessages(anthropicMessages)
		expect(openAiMessages).toHaveLength(1)

		const toolMessage = openAiMessages[0] as OpenAI.Chat.ChatCompletionToolMessageParam
		expect(toolMessage.role).toBe("tool")
		expect(toolMessage.tool_call_id).toBe("weather-123") // Not normalized without normalizeToolCallId function
		expect(toolMessage.content).toBe("Current temperature in London: 20°C")
	})

	it("should normalize tool call IDs when normalizeToolCallId function is provided", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_5019f900a247472bacde0b82",
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
						tool_use_id: "call_5019f900a247472bacde0b82",
						content: "file contents",
					},
				],
			},
		]

		// With normalizeToolCallId function - should normalize
		const openAiMessages = convertToOpenAiMessages(anthropicMessages, {
			normalizeToolCallId: normalizeMistralToolCallId,
		})

		const assistantMessage = openAiMessages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam
		expect(assistantMessage.tool_calls![0].id).toBe(normalizeMistralToolCallId("call_5019f900a247472bacde0b82"))

		const toolMessage = openAiMessages[1] as OpenAI.Chat.ChatCompletionToolMessageParam
		expect(toolMessage.tool_call_id).toBe(normalizeMistralToolCallId("call_5019f900a247472bacde0b82"))
	})

	it("should not normalize tool call IDs when normalizeToolCallId function is not provided", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_5019f900a247472bacde0b82",
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
						tool_use_id: "call_5019f900a247472bacde0b82",
						content: "file contents",
					},
				],
			},
		]

		// Without normalizeToolCallId function - should NOT normalize
		const openAiMessages = convertToOpenAiMessages(anthropicMessages, {})

		const assistantMessage = openAiMessages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam
		expect(assistantMessage.tool_calls![0].id).toBe("call_5019f900a247472bacde0b82")

		const toolMessage = openAiMessages[1] as OpenAI.Chat.ChatCompletionToolMessageParam
		expect(toolMessage.tool_call_id).toBe("call_5019f900a247472bacde0b82")
	})

	it("should use custom normalization function when provided", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_123",
						name: "test_tool",
						input: {},
					},
				],
			},
		]

		// Custom normalization function that prefixes with "custom_"
		const customNormalizer = (id: string) => `custom_${id}`
		const openAiMessages = convertToOpenAiMessages(anthropicMessages, { normalizeToolCallId: customNormalizer })

		const assistantMessage = openAiMessages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam
		expect(assistantMessage.tool_calls![0].id).toBe("custom_toolu_123")
	})

	describe("mergeToolResultText option", () => {
		it("should merge text content into last tool message when mergeToolResultText is true", () => {
			const anthropicMessages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-123",
							content: "Tool result content",
						},
						{
							type: "text",
							text: "<environment_details>\nSome context\n</environment_details>",
						},
					],
				},
			]

			const openAiMessages = convertToOpenAiMessages(anthropicMessages, { mergeToolResultText: true })

			// Should produce only one tool message with merged content
			expect(openAiMessages).toHaveLength(1)
			const toolMessage = openAiMessages[0] as OpenAI.Chat.ChatCompletionToolMessageParam
			expect(toolMessage.role).toBe("tool")
			expect(toolMessage.tool_call_id).toBe("tool-123")
			expect(toolMessage.content).toBe(
				"Tool result content\n\n<environment_details>\nSome context\n</environment_details>",
			)
		})

		it("should merge text into last tool message when multiple tool results exist", () => {
			const anthropicMessages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_1",
							content: "First result",
						},
						{
							type: "tool_result",
							tool_use_id: "call_2",
							content: "Second result",
						},
						{
							type: "text",
							text: "<environment_details>Context</environment_details>",
						},
					],
				},
			]

			const openAiMessages = convertToOpenAiMessages(anthropicMessages, { mergeToolResultText: true })

			// Should produce two tool messages, with text merged into the last one
			expect(openAiMessages).toHaveLength(2)
			expect((openAiMessages[0] as OpenAI.Chat.ChatCompletionToolMessageParam).content).toBe("First result")
			expect((openAiMessages[1] as OpenAI.Chat.ChatCompletionToolMessageParam).content).toBe(
				"Second result\n\n<environment_details>Context</environment_details>",
			)
		})

		it("should NOT merge text when images are present (fall back to user message)", () => {
			const anthropicMessages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-123",
							content: "Tool result content",
						},
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: "base64data",
							},
						},
					],
				},
			]

			const openAiMessages = convertToOpenAiMessages(anthropicMessages, { mergeToolResultText: true })

			// Should produce a tool message AND a user message (because image is present)
			expect(openAiMessages).toHaveLength(2)
			expect((openAiMessages[0] as OpenAI.Chat.ChatCompletionToolMessageParam).role).toBe("tool")
			expect(openAiMessages[1].role).toBe("user")
		})

		it("should create separate user message when mergeToolResultText is false", () => {
			const anthropicMessages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-123",
							content: "Tool result content",
						},
						{
							type: "text",
							text: "<environment_details>\nSome context\n</environment_details>",
						},
					],
				},
			]

			const openAiMessages = convertToOpenAiMessages(anthropicMessages, { mergeToolResultText: false })

			// Should produce a tool message AND a separate user message (default behavior)
			expect(openAiMessages).toHaveLength(2)
			expect((openAiMessages[0] as OpenAI.Chat.ChatCompletionToolMessageParam).role).toBe("tool")
			expect((openAiMessages[0] as OpenAI.Chat.ChatCompletionToolMessageParam).content).toBe(
				"Tool result content",
			)
			expect(openAiMessages[1].role).toBe("user")
		})

		it("should work with normalizeToolCallId when mergeToolResultText is true", () => {
			const anthropicMessages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_5019f900a247472bacde0b82",
							content: "Tool result content",
						},
						{
							type: "text",
							text: "<environment_details>Context</environment_details>",
						},
					],
				},
			]

			const openAiMessages = convertToOpenAiMessages(anthropicMessages, {
				mergeToolResultText: true,
				normalizeToolCallId: normalizeMistralToolCallId,
			})

			// Should merge AND normalize the ID
			expect(openAiMessages).toHaveLength(1)
			const toolMessage = openAiMessages[0] as OpenAI.Chat.ChatCompletionToolMessageParam
			expect(toolMessage.role).toBe("tool")
			expect(toolMessage.tool_call_id).toBe(normalizeMistralToolCallId("call_5019f900a247472bacde0b82"))
			expect(toolMessage.content).toBe(
				"Tool result content\n\n<environment_details>Context</environment_details>",
			)
		})

		it("should handle user messages with only text content (no tool results)", () => {
			const anthropicMessages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Hello, how are you?",
						},
					],
				},
			]

			const openAiMessages = convertToOpenAiMessages(anthropicMessages, { mergeToolResultText: true })

			// Should produce a normal user message
			expect(openAiMessages).toHaveLength(1)
			expect(openAiMessages[0].role).toBe("user")
		})
	})

	describe("reasoning_details transformation", () => {
		it("should preserve reasoning_details when assistant content is a string", () => {
			const anthropicMessages = [
				{
					role: "assistant" as const,
					content: "Why don't scientists trust atoms? Because they make up everything!",
					reasoning_details: [
						{
							type: "reasoning.summary",
							summary: "The user asked for a joke.",
							format: "xai-responses-v1",
							index: 0,
						},
						{
							type: "reasoning.encrypted",
							data: "encrypted_data_here",
							id: "rs_abc",
							format: "xai-responses-v1",
							index: 0,
						},
					],
				},
			] as any

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any
			expect(assistantMessage.role).toBe("assistant")
			expect(assistantMessage.content).toBe("Why don't scientists trust atoms? Because they make up everything!")
			expect(assistantMessage.reasoning_details).toHaveLength(2)
			expect(assistantMessage.reasoning_details[0].type).toBe("reasoning.summary")
			expect(assistantMessage.reasoning_details[1].type).toBe("reasoning.encrypted")
			expect(assistantMessage.reasoning_details[1].id).toBe("rs_abc")
		})

		it("should strip id from openai-responses-v1 blocks even when assistant content is a string", () => {
			const anthropicMessages = [
				{
					role: "assistant" as const,
					content: "Ok.",
					reasoning_details: [
						{
							type: "reasoning.summary",
							id: "rs_should_be_stripped",
							format: "openai-responses-v1",
							index: 0,
							summary: "internal",
							data: "gAAAAA...",
						},
					],
				},
			] as any

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any
			expect(assistantMessage.reasoning_details).toHaveLength(1)
			expect(assistantMessage.reasoning_details[0].format).toBe("openai-responses-v1")
			expect(assistantMessage.reasoning_details[0].id).toBeUndefined()
		})

		it("should pass through all reasoning_details without extracting to top-level reasoning", () => {
			// This simulates the stored format after receiving from xAI/Roo API
			// The provider (roo.ts) now consolidates all reasoning into reasoning_details
			const anthropicMessages = [
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "I'll help you with that." }],
					reasoning_details: [
						{
							type: "reasoning.summary",
							summary: '<xai:function_call name="update_todo_list">\n\n## Reviewing task progress',
							format: "xai-responses-v1",
							index: 0,
						},
						{
							type: "reasoning.encrypted",
							data: "PParvy65fOb8AhUd9an7yZ3wBF2KCQPL3zhjPNve8parmyG/Xw2K7HZn...",
							id: "rs_ce73018c-40cc-49b1-c589-902c53f4a16a",
							format: "xai-responses-v1",
							index: 0,
						},
					],
				},
			] as any

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any
			expect(assistantMessage.role).toBe("assistant")

			// Should NOT have top-level reasoning field - we only use reasoning_details now
			expect(assistantMessage.reasoning).toBeUndefined()

			// Should pass through all reasoning_details preserving all fields
			expect(assistantMessage.reasoning_details).toHaveLength(2)
			expect(assistantMessage.reasoning_details[0].type).toBe("reasoning.summary")
			expect(assistantMessage.reasoning_details[0].summary).toBe(
				'<xai:function_call name="update_todo_list">\n\n## Reviewing task progress',
			)
			expect(assistantMessage.reasoning_details[1].type).toBe("reasoning.encrypted")
			expect(assistantMessage.reasoning_details[1].id).toBe("rs_ce73018c-40cc-49b1-c589-902c53f4a16a")
			expect(assistantMessage.reasoning_details[1].data).toBe(
				"PParvy65fOb8AhUd9an7yZ3wBF2KCQPL3zhjPNve8parmyG/Xw2K7HZn...",
			)
		})

		it("should strip id from openai-responses-v1 blocks to avoid 404 errors (store: false)", () => {
			// IMPORTANT: OpenAI's API returns a 404 error when we send back an `id` for
			// reasoning blocks with format "openai-responses-v1" because we don't use
			// `store: true` (we handle conversation state client-side). The error message is:
			// "'{id}' not found. Items are not persisted when `store` is set to false."
			const anthropicMessages = [
				{
					role: "assistant" as const,
					content: [
						{
							type: "tool_use" as const,
							id: "call_Tb4KVEmEpEAA8W1QcxjyD5Nh",
							name: "attempt_completion",
							input: {
								result: "Why did the developer go broke?\n\nBecause they used up all their cache.",
							},
						},
					],
					reasoning_details: [
						{
							type: "reasoning.summary",
							id: "rs_0de1fb80387fb36501694ad8d71c3081949934e6bb177e5ec5",
							format: "openai-responses-v1",
							index: 0,
							summary: "It looks like I need to make sure I'm using the tool every time.",
							data: "gAAAAABpStjXioDMX8RUobc7k-eKqax9WrI97bok93IkBI6X6eBY...",
						},
					],
				},
			] as any

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any

			// Should NOT have top-level reasoning field - we only use reasoning_details now
			expect(assistantMessage.reasoning).toBeUndefined()

			// Should pass through reasoning_details preserving most fields BUT stripping id
			expect(assistantMessage.reasoning_details).toHaveLength(1)
			expect(assistantMessage.reasoning_details[0].type).toBe("reasoning.summary")
			// id should be STRIPPED for openai-responses-v1 format to avoid 404 errors
			expect(assistantMessage.reasoning_details[0].id).toBeUndefined()
			expect(assistantMessage.reasoning_details[0].summary).toBe(
				"It looks like I need to make sure I'm using the tool every time.",
			)
			expect(assistantMessage.reasoning_details[0].data).toBe(
				"gAAAAABpStjXioDMX8RUobc7k-eKqax9WrI97bok93IkBI6X6eBY...",
			)
			expect(assistantMessage.reasoning_details[0].format).toBe("openai-responses-v1")

			// Should have tool_calls
			expect(assistantMessage.tool_calls).toHaveLength(1)
			expect(assistantMessage.tool_calls[0].id).toBe("call_Tb4KVEmEpEAA8W1QcxjyD5Nh")
		})

		it("should preserve id for non-openai-responses-v1 formats (e.g., xai-responses-v1)", () => {
			// For other formats like xai-responses-v1, we should preserve the id
			const anthropicMessages = [
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Response" }],
					reasoning_details: [
						{
							type: "reasoning.encrypted",
							id: "rs_ce73018c-40cc-49b1-c589-902c53f4a16a",
							format: "xai-responses-v1",
							data: "encrypted_data_here",
							index: 0,
						},
					],
				},
			] as any

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any

			// Should preserve id for xai-responses-v1 format
			expect(assistantMessage.reasoning_details).toHaveLength(1)
			expect(assistantMessage.reasoning_details[0].id).toBe("rs_ce73018c-40cc-49b1-c589-902c53f4a16a")
			expect(assistantMessage.reasoning_details[0].format).toBe("xai-responses-v1")
		})

		it("should handle assistant messages with tool_calls and reasoning_details", () => {
			// This simulates a message with both tool calls and reasoning
			const anthropicMessages = [
				{
					role: "assistant" as const,
					content: [
						{
							type: "tool_use" as const,
							id: "call_62462410",
							name: "read_file",
							input: { files: [{ path: "alphametics.go" }] },
						},
					],
					reasoning_details: [
						{
							type: "reasoning.summary",
							summary: "## Reading the file to understand the structure",
							format: "xai-responses-v1",
							index: 0,
						},
						{
							type: "reasoning.encrypted",
							data: "encrypted_data_here",
							id: "rs_12345",
							format: "xai-responses-v1",
							index: 0,
						},
					],
				},
			] as any

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any

			// Should NOT have top-level reasoning field
			expect(assistantMessage.reasoning).toBeUndefined()

			// Should pass through all reasoning_details
			expect(assistantMessage.reasoning_details).toHaveLength(2)

			// Should have tool_calls
			expect(assistantMessage.tool_calls).toHaveLength(1)
			expect(assistantMessage.tool_calls[0].id).toBe("call_62462410")
			expect(assistantMessage.tool_calls[0].function.name).toBe("read_file")
		})

		it("should pass through reasoning_details with only encrypted blocks", () => {
			const anthropicMessages = [
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Response text" }],
					reasoning_details: [
						{
							type: "reasoning.encrypted",
							data: "encrypted_data",
							id: "rs_only_encrypted",
							format: "xai-responses-v1",
							index: 0,
						},
					],
				},
			] as any

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any

			// Should NOT have reasoning field
			expect(assistantMessage.reasoning).toBeUndefined()

			// Should still pass through reasoning_details
			expect(assistantMessage.reasoning_details).toHaveLength(1)
			expect(assistantMessage.reasoning_details[0].type).toBe("reasoning.encrypted")
		})

		it("should pass through reasoning_details even when only summary blocks exist (no encrypted)", () => {
			const anthropicMessages = [
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Response text" }],
					reasoning_details: [
						{
							type: "reasoning.summary",
							summary: "Just a summary, no encrypted content",
							format: "xai-responses-v1",
							index: 0,
						},
					],
				},
			] as any

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any

			// Should NOT have top-level reasoning field
			expect(assistantMessage.reasoning).toBeUndefined()

			// Should pass through reasoning_details preserving the summary block
			expect(assistantMessage.reasoning_details).toHaveLength(1)
			expect(assistantMessage.reasoning_details[0].type).toBe("reasoning.summary")
			expect(assistantMessage.reasoning_details[0].summary).toBe("Just a summary, no encrypted content")
		})

		it("should handle messages without reasoning_details", () => {
			const anthropicMessages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [{ type: "text", text: "Simple response" }],
				},
			]

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any

			// Should not have reasoning or reasoning_details
			expect(assistantMessage.reasoning).toBeUndefined()
			expect(assistantMessage.reasoning_details).toBeUndefined()
		})

		it("should pass through multiple reasoning_details blocks preserving all fields", () => {
			const anthropicMessages = [
				{
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Response" }],
					reasoning_details: [
						{
							type: "reasoning.summary",
							summary: "First part of thinking. ",
							format: "xai-responses-v1",
							index: 0,
						},
						{
							type: "reasoning.summary",
							summary: "Second part of thinking.",
							format: "xai-responses-v1",
							index: 1,
						},
						{
							type: "reasoning.encrypted",
							data: "encrypted_data",
							id: "rs_multi",
							format: "xai-responses-v1",
							index: 0,
						},
					],
				},
			] as any

			const openAiMessages = convertToOpenAiMessages(anthropicMessages)

			expect(openAiMessages).toHaveLength(1)
			const assistantMessage = openAiMessages[0] as any

			// Should NOT have top-level reasoning field
			expect(assistantMessage.reasoning).toBeUndefined()

			// Should pass through all reasoning_details
			expect(assistantMessage.reasoning_details).toHaveLength(3)
			expect(assistantMessage.reasoning_details[0].summary).toBe("First part of thinking. ")
			expect(assistantMessage.reasoning_details[1].summary).toBe("Second part of thinking.")
			expect(assistantMessage.reasoning_details[2].data).toBe("encrypted_data")
		})
	})
})

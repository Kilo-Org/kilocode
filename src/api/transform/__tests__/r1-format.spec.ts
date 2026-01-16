// npx vitest run api/transform/__tests__/r1-format.spec.ts

import { convertToR1Format } from "../r1-format"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

describe("convertToR1Format", () => {
	it("should convert basic text messages", () => {
		const input: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there" },
		]

		const expected: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there" },
		]

		expect(convertToR1Format(input)).toEqual(expected)
	})

	it("should merge consecutive messages with same role", () => {
		const input: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "Hello" },
			{ role: "user", content: "How are you?" },
			{ role: "assistant", content: "Hi!" },
			{ role: "assistant", content: "I'm doing well" },
		]

		const expected: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "user", content: "Hello\nHow are you?" },
			{ role: "assistant", content: "Hi!\nI'm doing well" },
		]

		expect(convertToR1Format(input)).toEqual(expected)
	})

	it("should handle image content", () => {
		const input: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
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

		const expected: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: {
							url: "data:image/jpeg;base64,base64data",
						},
					},
				],
			},
		]

		expect(convertToR1Format(input)).toEqual(expected)
	})

	it("should handle mixed text and image content", () => {
		const input: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Check this image:" },
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

		const expected: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Check this image:" },
					{
						type: "image_url",
						image_url: {
							url: "data:image/jpeg;base64,base64data",
						},
					},
				],
			},
		]

		expect(convertToR1Format(input)).toEqual(expected)
	})

	it("should merge mixed content messages with same role", () => {
		const input: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "First image:" },
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "image1",
						},
					},
				],
			},
			{
				role: "user",
				content: [
					{ type: "text", text: "Second image:" },
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "image2",
						},
					},
				],
			},
		]

		const expected: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "First image:" },
					{
						type: "image_url",
						image_url: {
							url: "data:image/jpeg;base64,image1",
						},
					},
					{ type: "text", text: "Second image:" },
					{
						type: "image_url",
						image_url: {
							url: "data:image/png;base64,image2",
						},
					},
				],
			},
		]

		expect(convertToR1Format(input)).toEqual(expected)
	})

	it("should handle empty messages array", () => {
		expect(convertToR1Format([])).toEqual([])
	})

	it("should handle messages with empty content", () => {
		const input: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "" },
			{ role: "assistant", content: "" },
		]

		const expected: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "user", content: "" },
			{ role: "assistant", content: "" },
		]

		expect(convertToR1Format(input)).toEqual(expected)
	})

	describe("tool calls support for DeepSeek interleaved thinking", () => {
		it("should convert assistant messages with tool_use to OpenAI format", () => {
			const input: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "What's the weather?" },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Let me check the weather for you." },
						{
							type: "tool_use",
							id: "call_123",
							name: "get_weather",
							input: { location: "San Francisco" },
						},
					],
				},
			]

			const result = convertToR1Format(input)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ role: "user", content: "What's the weather?" })
			expect(result[1]).toMatchObject({
				role: "assistant",
				content: "Let me check the weather for you.",
				tool_calls: [
					{
						id: "call_123",
						type: "function",
						function: {
							name: "get_weather",
							arguments: '{"location":"San Francisco"}',
						},
					},
				],
			})
		})

		it("should convert user messages with tool_result to OpenAI tool messages", () => {
			const input: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "What's the weather?" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_123",
							name: "get_weather",
							input: { location: "San Francisco" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_123",
							content: "72°F and sunny",
						},
					],
				},
			]

			const result = convertToR1Format(input)

			expect(result).toHaveLength(3)
			expect(result[0]).toEqual({ role: "user", content: "What's the weather?" })
			expect(result[1]).toMatchObject({
				role: "assistant",
				content: null,
				tool_calls: expect.any(Array),
			})
			expect(result[2]).toEqual({
				role: "tool",
				tool_call_id: "call_123",
				content: "72°F and sunny",
			})
		})

		it("should handle tool_result with array content", () => {
			const input: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_456",
							content: [
								{ type: "text", text: "Line 1" },
								{ type: "text", text: "Line 2" },
							],
						},
					],
				},
			]

			const result = convertToR1Format(input)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				role: "tool",
				tool_call_id: "call_456",
				content: "Line 1\nLine 2",
			})
		})

		it("should preserve reasoning_content on assistant messages", () => {
			const input = [
				{ role: "user" as const, content: "Think about this" },
				{
					role: "assistant" as const,
					content: "Here's my answer",
					reasoning_content: "Let me analyze step by step...",
				},
			]

			const result = convertToR1Format(input as Anthropic.Messages.MessageParam[])

			expect(result).toHaveLength(2)
			expect((result[1] as any).reasoning_content).toBe("Let me analyze step by step...")
		})

		it("should handle mixed tool_result and text in user message", () => {
			const input: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_789",
							content: "Tool result",
						},
						{
							type: "text",
							text: "Please continue",
						},
					],
				},
			]

			const result = convertToR1Format(input)

			// Should produce two messages: tool message first, then user message
			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				role: "tool",
				tool_call_id: "call_789",
				content: "Tool result",
			})
			expect(result[1]).toEqual({
				role: "user",
				content: "Please continue",
			})
		})

		it("should handle multiple tool calls in single assistant message", () => {
			const input: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_1",
							name: "tool_a",
							input: { param: "a" },
						},
						{
							type: "tool_use",
							id: "call_2",
							name: "tool_b",
							input: { param: "b" },
						},
					],
				},
			]

			const result = convertToR1Format(input)

			expect(result).toHaveLength(1)
			expect((result[0] as any).tool_calls).toHaveLength(2)
			expect((result[0] as any).tool_calls[0].id).toBe("call_1")
			expect((result[0] as any).tool_calls[1].id).toBe("call_2")
		})

		it("should not merge assistant messages that have tool calls", () => {
			const input: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_1",
							name: "tool_a",
							input: {},
						},
					],
				},
				{
					role: "assistant",
					content: "Follow up response",
				},
			]

			const result = convertToR1Format(input)

			// Should NOT merge because first message has tool calls
			expect(result).toHaveLength(2)
			expect((result[0] as any).tool_calls).toBeDefined()
			expect(result[1]).toEqual({
				role: "assistant",
				content: "Follow up response",
			})
		})

		describe("mergeToolResultText option for DeepSeek interleaved thinking", () => {
			it("should merge text content into last tool message when mergeToolResultText is true", () => {
				const input: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "call_123",
								content: "Tool result content",
							},
							{
								type: "text",
								text: "<environment_details>\nSome context\n</environment_details>",
							},
						],
					},
				]

				const result = convertToR1Format(input, { mergeToolResultText: true })

				// Should produce only one tool message with merged content
				expect(result).toHaveLength(1)
				expect(result[0]).toEqual({
					role: "tool",
					tool_call_id: "call_123",
					content: "Tool result content\n\n<environment_details>\nSome context\n</environment_details>",
				})
			})

			it("should NOT merge text when mergeToolResultText is false (default behavior)", () => {
				const input: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "call_123",
								content: "Tool result content",
							},
							{
								type: "text",
								text: "Please continue",
							},
						],
					},
				]

				// Without option (default behavior)
				const result = convertToR1Format(input)

				// Should produce two messages: tool message + user message
				expect(result).toHaveLength(2)
				expect(result[0]).toEqual({
					role: "tool",
					tool_call_id: "call_123",
					content: "Tool result content",
				})
				expect(result[1]).toEqual({
					role: "user",
					content: "Please continue",
				})
			})

			it("should merge text into last tool message when multiple tool results exist", () => {
				const input: Anthropic.Messages.MessageParam[] = [
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

				const result = convertToR1Format(input, { mergeToolResultText: true })

				// Should produce two tool messages, with text merged into the last one
				expect(result).toHaveLength(2)
				expect(result[0]).toEqual({
					role: "tool",
					tool_call_id: "call_1",
					content: "First result",
				})
				expect(result[1]).toEqual({
					role: "tool",
					tool_call_id: "call_2",
					content: "Second result\n\n<environment_details>Context</environment_details>",
				})
			})

			it("should NOT merge when there are images (images need user message)", () => {
				const input: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "call_123",
								content: "Tool result",
							},
							{
								type: "text",
								text: "Check this image",
							},
							{
								type: "image",
								source: {
									type: "base64",
									media_type: "image/jpeg",
									data: "imagedata",
								},
							},
						],
					},
				]

				const result = convertToR1Format(input, { mergeToolResultText: true })

				// Should produce tool message + user message with image
				expect(result).toHaveLength(2)
				expect(result[0]).toEqual({
					role: "tool",
					tool_call_id: "call_123",
					content: "Tool result",
				})
				expect(result[1]).toMatchObject({
					role: "user",
					content: expect.arrayContaining([
						{ type: "text", text: "Check this image" },
						{ type: "image_url", image_url: expect.any(Object) },
					]),
				})
			})

			it("should NOT merge when there are no tool results (text-only should remain user message)", () => {
				const input: Anthropic.Messages.MessageParam[] = [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Just a regular message",
							},
						],
					},
				]

				const result = convertToR1Format(input, { mergeToolResultText: true })

				// Should produce user message as normal
				expect(result).toHaveLength(1)
				expect(result[0]).toEqual({
					role: "user",
					content: "Just a regular message",
				})
			})

			it("should preserve reasoning_content on assistant messages in same conversation", () => {
				const input = [
					{ role: "user" as const, content: "Start" },
					{
						role: "assistant" as const,
						content: [
							{
								type: "tool_use" as const,
								id: "call_123",
								name: "test_tool",
								input: {},
							},
						],
						reasoning_content: "Let me think about this...",
					},
					{
						role: "user" as const,
						content: [
							{
								type: "tool_result" as const,
								tool_use_id: "call_123",
								content: "Result",
							},
							{
								type: "text" as const,
								text: "<environment_details>Context</environment_details>",
							},
						],
					},
				]

				const result = convertToR1Format(input as Anthropic.Messages.MessageParam[], {
					mergeToolResultText: true,
				})

				// Should have: user, assistant (with reasoning + tool_calls), tool
				expect(result).toHaveLength(3)
				expect(result[0]).toEqual({ role: "user", content: "Start" })
				expect((result[1] as any).reasoning_content).toBe("Let me think about this...")
				expect((result[1] as any).tool_calls).toBeDefined()
				// Tool message should have merged content
				expect(result[2]).toEqual({
					role: "tool",
					tool_call_id: "call_123",
					content: "Result\n\n<environment_details>Context</environment_details>",
				})
				// Most importantly: NO user message after tool message
				expect(result.filter((m) => m.role === "user")).toHaveLength(1)
			})
		})
	})
})

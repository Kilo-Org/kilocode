// npx vitest run src/api/transform/__tests__/bedrock-converse-format.spec.ts

import { convertToBedrockConverseMessages } from "../bedrock-converse-format"
import { Anthropic } from "@anthropic-ai/sdk"
import { ContentBlock, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime"
import { OPENAI_CALL_ID_MAX_LENGTH } from "../../../utils/tool-id"

describe("convertToBedrockConverseMessages", () => {
	it("converts simple text messages correctly", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there" },
		]

		const result = convertToBedrockConverseMessages(messages)

		expect(result).toEqual([
			{
				role: "user",
				content: [{ text: "Hello" }],
			},
			{
				role: "assistant",
				content: [{ text: "Hi there" }],
			},
		])
	})

	it("converts messages with images correctly", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Look at this image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							data: "SGVsbG8=", // "Hello" in base64
							media_type: "image/jpeg" as const,
						},
					},
				],
			},
		]

		const result = convertToBedrockConverseMessages(messages)

		if (!result[0] || !result[0].content) {
			expect.fail("Expected result to have content")
			return
		}

		expect(result[0].role).toBe("user")
		expect(result[0].content).toHaveLength(2)
		expect(result[0].content[0]).toEqual({ text: "Look at this image:" })

		const imageBlock = result[0].content[1] as ContentBlock
		if ("image" in imageBlock && imageBlock.image && imageBlock.image.source) {
			expect(imageBlock.image.format).toBe("jpeg")
			expect(imageBlock.image.source).toBeDefined()
			expect(imageBlock.image.source.bytes).toBeDefined()
		} else {
			expect.fail("Expected image block not found")
		}
	})

	it("converts tool use messages correctly (native tools format; default)", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "test-id",
						name: "read_file",
						input: {
							path: "test.txt",
						},
					},
				],
			},
		]

		const result = convertToBedrockConverseMessages(messages)

		if (!result[0] || !result[0].content) {
			expect.fail("Expected result to have content")
			return
		}

		expect(result[0].role).toBe("assistant")
		const toolBlock = result[0].content[0] as ContentBlock
		if ("toolUse" in toolBlock && toolBlock.toolUse) {
			expect(toolBlock.toolUse).toEqual({
				toolUseId: "test-id",
				name: "read_file",
				input: { path: "test.txt" },
			})
		} else {
			expect.fail("Expected tool use block not found")
		}
	})

	it("converts tool use messages correctly (native tools format)", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "test-id",
						name: "read_file",
						input: {
							path: "test.txt",
						},
					},
				],
			},
		]

		const result = convertToBedrockConverseMessages(messages)

		if (!result[0] || !result[0].content) {
			expect.fail("Expected result to have content")
			return
		}

		expect(result[0].role).toBe("assistant")
		const toolBlock = result[0].content[0] as ContentBlock
		if ("toolUse" in toolBlock && toolBlock.toolUse) {
			expect(toolBlock.toolUse).toEqual({
				toolUseId: "test-id",
				name: "read_file",
				input: { path: "test.txt" },
			})
		} else {
			expect.fail("Expected tool use block not found")
		}
	})

	it("converts tool result messages to native format (default)", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "test-id",
						content: [{ type: "text", text: "File contents here" }],
					},
				],
			},
		]

		const result = convertToBedrockConverseMessages(messages)

		if (!result[0] || !result[0].content) {
			expect.fail("Expected result to have content")
			return
		}

		expect(result[0].role).toBe("user")
		const resultBlock = result[0].content[0] as ContentBlock
		if ("toolResult" in resultBlock && resultBlock.toolResult) {
			const expectedContent: ToolResultContentBlock[] = [{ text: "File contents here" }]
			expect(resultBlock.toolResult).toEqual({
				toolUseId: "test-id",
				content: expectedContent,
				status: "success",
			})
		} else {
			expect.fail("Expected tool result block not found")
		}
	})

	it("converts tool result messages to native format", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "test-id",
						content: [{ type: "text", text: "File contents here" }],
					},
				],
			},
		]

		const result = convertToBedrockConverseMessages(messages)

		if (!result[0] || !result[0].content) {
			expect.fail("Expected result to have content")
			return
		}

		expect(result[0].role).toBe("user")
		const resultBlock = result[0].content[0] as ContentBlock
		if ("toolResult" in resultBlock && resultBlock.toolResult) {
			const expectedContent: ToolResultContentBlock[] = [{ text: "File contents here" }]
			expect(resultBlock.toolResult).toEqual({
				toolUseId: "test-id",
				content: expectedContent,
				status: "success",
			})
		} else {
			expect.fail("Expected tool result block not found")
		}
	})

	it("converts tool result messages with string content to native format (default)", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "test-id",
						content: "File: test.txt\nLines 1-5:\nHello World",
					} as any, // Anthropic types don't allow string content but runtime can have it
				],
			},
		]

		const result = convertToBedrockConverseMessages(messages)

		if (!result[0] || !result[0].content) {
			expect.fail("Expected result to have content")
			return
		}

		expect(result[0].role).toBe("user")
		const resultBlock = result[0].content[0] as ContentBlock
		if ("toolResult" in resultBlock && resultBlock.toolResult) {
			expect(resultBlock.toolResult).toEqual({
				toolUseId: "test-id",
				content: [{ text: "File: test.txt\nLines 1-5:\nHello World" }],
				status: "success",
			})
		} else {
			expect.fail("Expected tool result block not found")
		}
	})

	it("converts tool result messages with string content to native format", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "test-id",
						content: "File: test.txt\nLines 1-5:\nHello World",
					} as any, // Anthropic types don't allow string content but runtime can have it
				],
			},
		]

		const result = convertToBedrockConverseMessages(messages)

		if (!result[0] || !result[0].content) {
			expect.fail("Expected result to have content")
			return
		}

		expect(result[0].role).toBe("user")
		const resultBlock = result[0].content[0] as ContentBlock
		if ("toolResult" in resultBlock && resultBlock.toolResult) {
			expect(resultBlock.toolResult).toEqual({
				toolUseId: "test-id",
				content: [{ text: "File: test.txt\nLines 1-5:\nHello World" }],
				status: "success",
			})
		} else {
			expect.fail("Expected tool result block not found")
		}
	})

	it("keeps both tool_use and tool_result in native format by default", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call-123",
						name: "read_file",
						input: { path: "test.txt" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call-123",
						content: "File contents here",
					} as any,
				],
			},
		]

		const result = convertToBedrockConverseMessages(messages)

		// Both should be native toolUse/toolResult blocks
		const assistantContent = result[0]?.content?.[0] as ContentBlock
		const userContent = result[1]?.content?.[0] as ContentBlock

		expect("toolUse" in assistantContent).toBe(true)
		expect("toolResult" in userContent).toBe(true)
		expect("text" in assistantContent).toBe(false)
		expect("text" in userContent).toBe(false)
	})

	it("handles text content correctly", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Hello world",
					},
				],
			},
		]

		const result = convertToBedrockConverseMessages(messages)

		if (!result[0] || !result[0].content) {
			expect.fail("Expected result to have content")
			return
		}

		expect(result[0].role).toBe("user")
		expect(result[0].content).toHaveLength(1)
		const textBlock = result[0].content[0] as ContentBlock
		expect(textBlock).toEqual({ text: "Hello world" })
	})

	describe("toolUseId sanitization for Bedrock 64-char limit", () => {
		it("truncates toolUseId longer than 64 characters in tool_use blocks", () => {
			const longId = "a".repeat(100)
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: longId,
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
			]

			const result = convertToBedrockConverseMessages(messages)
			const toolBlock = result[0]?.content?.[0] as ContentBlock

			if ("toolUse" in toolBlock && toolBlock.toolUse && toolBlock.toolUse.toolUseId) {
				expect(toolBlock.toolUse.toolUseId.length).toBeLessThanOrEqual(OPENAI_CALL_ID_MAX_LENGTH)
				expect(toolBlock.toolUse.toolUseId.length).toBe(OPENAI_CALL_ID_MAX_LENGTH)
				expect(toolBlock.toolUse.toolUseId).toContain("_")
			} else {
				expect.fail("Expected tool use block not found")
			}
		})

		it("truncates toolUseId longer than 64 characters in tool_result blocks with string content", () => {
			const longId = "b".repeat(100)
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: longId,
							content: "Result content",
						} as any,
					],
				},
			]

			const result = convertToBedrockConverseMessages(messages)
			const resultBlock = result[0]?.content?.[0] as ContentBlock

			if ("toolResult" in resultBlock && resultBlock.toolResult && resultBlock.toolResult.toolUseId) {
				expect(resultBlock.toolResult.toolUseId.length).toBeLessThanOrEqual(OPENAI_CALL_ID_MAX_LENGTH)
				expect(resultBlock.toolResult.toolUseId.length).toBe(OPENAI_CALL_ID_MAX_LENGTH)
				expect(resultBlock.toolResult.toolUseId).toContain("_")
			} else {
				expect.fail("Expected tool result block not found")
			}
		})

		it("truncates toolUseId longer than 64 characters in tool_result blocks with array content", () => {
			const longId = "c".repeat(100)
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: longId,
							content: [{ type: "text", text: "Result content" }],
						},
					],
				},
			]

			const result = convertToBedrockConverseMessages(messages)
			const resultBlock = result[0]?.content?.[0] as ContentBlock

			if ("toolResult" in resultBlock && resultBlock.toolResult && resultBlock.toolResult.toolUseId) {
				expect(resultBlock.toolResult.toolUseId.length).toBeLessThanOrEqual(OPENAI_CALL_ID_MAX_LENGTH)
				expect(resultBlock.toolResult.toolUseId.length).toBe(OPENAI_CALL_ID_MAX_LENGTH)
			} else {
				expect.fail("Expected tool result block not found")
			}
		})

		it("keeps toolUseId unchanged when under 64 characters", () => {
			const shortId = "short-id-123"
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: shortId,
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
			]

			const result = convertToBedrockConverseMessages(messages)
			const toolBlock = result[0]?.content?.[0] as ContentBlock

			if ("toolUse" in toolBlock && toolBlock.toolUse) {
				expect(toolBlock.toolUse.toolUseId).toBe(shortId)
			} else {
				expect.fail("Expected tool use block not found")
			}
		})

		it("produces consistent truncated IDs for the same input", () => {
			const longId = "d".repeat(100)
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: longId,
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
			]

			const result1 = convertToBedrockConverseMessages(messages)
			const result2 = convertToBedrockConverseMessages(messages)

			const toolBlock1 = result1[0]?.content?.[0] as ContentBlock
			const toolBlock2 = result2[0]?.content?.[0] as ContentBlock

			if ("toolUse" in toolBlock1 && toolBlock1.toolUse && "toolUse" in toolBlock2 && toolBlock2.toolUse) {
				expect(toolBlock1.toolUse.toolUseId).toBe(toolBlock2.toolUse.toolUseId)
			} else {
				expect.fail("Expected tool use blocks not found")
			}
		})

		it("produces different truncated IDs for different long inputs", () => {
			const longId1 = "e".repeat(100)
			const longId2 = "f".repeat(100)

			const messages1: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [{ type: "tool_use", id: longId1, name: "read_file", input: {} }],
				},
			]
			const messages2: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [{ type: "tool_use", id: longId2, name: "read_file", input: {} }],
				},
			]

			const result1 = convertToBedrockConverseMessages(messages1)
			const result2 = convertToBedrockConverseMessages(messages2)

			const toolBlock1 = result1[0]?.content?.[0] as ContentBlock
			const toolBlock2 = result2[0]?.content?.[0] as ContentBlock

			if ("toolUse" in toolBlock1 && toolBlock1.toolUse && "toolUse" in toolBlock2 && toolBlock2.toolUse) {
				expect(toolBlock1.toolUse.toolUseId).not.toBe(toolBlock2.toolUse.toolUseId)
			} else {
				expect.fail("Expected tool use blocks not found")
			}
		})

		it("matching tool_use and tool_result IDs are both truncated consistently", () => {
			const longId = "g".repeat(100)
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: longId,
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: longId,
							content: "File contents",
						} as any,
					],
				},
			]

			const result = convertToBedrockConverseMessages(messages)

			const toolUseBlock = result[0]?.content?.[0] as ContentBlock
			const toolResultBlock = result[1]?.content?.[0] as ContentBlock

			if (
				"toolUse" in toolUseBlock &&
				toolUseBlock.toolUse &&
				toolUseBlock.toolUse.toolUseId &&
				"toolResult" in toolResultBlock &&
				toolResultBlock.toolResult &&
				toolResultBlock.toolResult.toolUseId
			) {
				expect(toolUseBlock.toolUse.toolUseId).toBe(toolResultBlock.toolResult.toolUseId)
				expect(toolUseBlock.toolUse.toolUseId.length).toBeLessThanOrEqual(OPENAI_CALL_ID_MAX_LENGTH)
			} else {
				expect.fail("Expected tool use and result blocks not found")
			}
		})
	})
})

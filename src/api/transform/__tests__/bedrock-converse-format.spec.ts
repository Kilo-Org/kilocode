// npx vitest run src/api/transform/__tests__/bedrock-converse-format.spec.ts

import { convertToBedrockConverseMessages } from "../bedrock-converse-format"
import { Anthropic } from "@anthropic-ai/sdk"
import { ContentBlock, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime"

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

	it("converts tool use messages correctly (default XML format)", () => {
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

		// Default behavior (useNativeTools: false) converts tool_use to XML text format
		const result = convertToBedrockConverseMessages(messages)

		if (!result[0] || !result[0].content) {
			expect.fail("Expected result to have content")
			return
		}

		expect(result[0].role).toBe("assistant")
		const textBlock = result[0].content[0] as ContentBlock
		if ("text" in textBlock) {
			expect(textBlock.text).toContain("<tool_use>")
			expect(textBlock.text).toContain("<tool_name>read_file</tool_name>")
			expect(textBlock.text).toContain("test.txt")
		} else {
			expect.fail("Expected text block with XML content not found")
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

		// With useNativeTools: true, keeps tool_use as native format
		const result = convertToBedrockConverseMessages(messages, { useNativeTools: true })

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

	it("converts tool result messages correctly", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
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

		expect(result[0].role).toBe("assistant")
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

	it("converts tool result messages with string content correctly", () => {
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
})

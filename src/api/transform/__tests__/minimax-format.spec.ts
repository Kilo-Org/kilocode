// npx vitest run api/transform/__tests__/minimax-format.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { mergeEnvironmentDetailsForMiniMax } from "../minimax-format"

describe("mergeEnvironmentDetailsForMiniMax", () => {
	it("should pass through simple text messages unchanged", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello",
			},
			{
				role: "assistant",
				content: "Hi there!",
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		expect(result).toHaveLength(2)
		expect(result).toEqual(messages)
	})

	it("should pass through user messages with only tool_result blocks unchanged", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-123",
						content: "Tool result content",
					},
				],
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		expect(result).toHaveLength(1)
		expect(result).toEqual(messages)
	})

	it("should pass through user messages with only text blocks unchanged", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Some user message",
					},
				],
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		expect(result).toHaveLength(1)
		expect(result).toEqual(messages)
	})

	it("should merge text content into last tool_result when both tool_result AND text blocks exist", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
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
						text: "<environment_details>\nCurrent Time: 2024-01-01\n</environment_details>",
					},
				],
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		// The message should have only tool_result with merged content
		expect(result).toHaveLength(1)
		expect(result[0].role).toBe("user")
		const content = result[0].content as Anthropic.Messages.ToolResultBlockParam[]
		expect(content).toHaveLength(1)
		expect(content[0].type).toBe("tool_result")
		expect(content[0].tool_use_id).toBe("tool-123")
		expect(content[0].content).toBe(
			"Tool result content\n\n<environment_details>\nCurrent Time: 2024-01-01\n</environment_details>",
		)
	})

	it("should merge multiple text blocks into last tool_result", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-123",
						content: "Tool result 1",
					},
					{
						type: "text",
						text: "First text block",
					},
					{
						type: "tool_result",
						tool_use_id: "tool-456",
						content: "Tool result 2",
					},
					{
						type: "text",
						text: "Second text block",
					},
				],
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		// The message should have only tool_result blocks, with text merged into the last one
		expect(result).toHaveLength(1)
		const content = result[0].content as Anthropic.Messages.ToolResultBlockParam[]
		expect(content).toHaveLength(2)
		expect(content[0].type).toBe("tool_result")
		expect(content[0].content).toBe("Tool result 1") // First one unchanged
		expect(content[1].type).toBe("tool_result")
		expect(content[1].content).toBe("Tool result 2\n\nFirst text block\n\nSecond text block") // Second has merged text
	})

	it("should NOT merge text when images are present (cannot move images to tool_result)", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
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
						text: "Some text",
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

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		// Message should be unchanged since images are present
		expect(result).toHaveLength(1)
		expect(result).toEqual(messages)
	})

	it("should pass through assistant messages unchanged", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I will help you with that.",
					},
					{
						type: "tool_use",
						id: "tool-123",
						name: "read_file",
						input: { path: "test.ts" },
					},
				],
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		expect(result).toHaveLength(1)
		expect(result).toEqual(messages)
	})

	it("should handle mixed conversation with merging only for eligible messages", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Create a file",
			},
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I'll create the file.",
					},
					{
						type: "tool_use",
						id: "tool-123",
						name: "write_file",
						input: { path: "test.ts", content: "// test" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-123",
						content: "File created successfully",
					},
					{
						type: "text",
						text: "<environment_details>\nCurrent Time: 2024-01-01\n</environment_details>",
					},
				],
			},
			{
				role: "assistant",
				content: "The file has been created.",
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		// Should have all 4 messages
		expect(result).toHaveLength(4)

		// First user message unchanged (simple string)
		expect(result[0]).toEqual(messages[0])

		// Assistant message unchanged
		expect(result[1]).toEqual(messages[1])

		// Third message should have tool_result with merged environment_details
		const thirdMessage = result[2].content as Anthropic.Messages.ToolResultBlockParam[]
		expect(thirdMessage).toHaveLength(1)
		expect(thirdMessage[0].type).toBe("tool_result")
		expect(thirdMessage[0].content).toContain("File created successfully")
		expect(thirdMessage[0].content).toContain("environment_details")

		// Fourth message unchanged
		expect(result[3]).toEqual(messages[3])
	})

	it("should handle string content in user messages", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Just a string message",
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		expect(result).toHaveLength(1)
		expect(result).toEqual(messages)
	})

	it("should handle empty messages array", () => {
		const messages: Anthropic.Messages.MessageParam[] = []

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		expect(result).toHaveLength(0)
	})

	it("should handle tool_result with array content", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-123",
						content: [
							{ type: "text", text: "Part 1" },
							{ type: "text", text: "Part 2" },
						],
					},
					{
						type: "text",
						text: "<environment_details>Context</environment_details>",
					},
				],
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		expect(result).toHaveLength(1)
		const content = result[0].content as Anthropic.Messages.ToolResultBlockParam[]
		expect(content).toHaveLength(1)
		expect(content[0].type).toBe("tool_result")
		// Array content should be concatenated and then merged with text
		expect(content[0].content).toBe("Part 1\nPart 2\n\n<environment_details>Context</environment_details>")
	})

	it("should handle tool_result with empty content", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-123",
						content: "",
					},
					{
						type: "text",
						text: "<environment_details>Context</environment_details>",
					},
				],
			},
		]

		const result = mergeEnvironmentDetailsForMiniMax(messages)

		expect(result).toHaveLength(1)
		const content = result[0].content as Anthropic.Messages.ToolResultBlockParam[]
		expect(content).toHaveLength(1)
		expect(content[0].type).toBe("tool_result")
		expect(content[0].content).toBe("<environment_details>Context</environment_details>")
	})
})

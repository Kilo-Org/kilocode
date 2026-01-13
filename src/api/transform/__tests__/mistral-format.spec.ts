// npx vitest run api/transform/__tests__/mistral-format.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { convertToMistralMessages } from "../mistral-format"

describe("convertToMistralMessages", () => {
	it("should convert simple text messages for user and assistant roles", () => {
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

		const mistralMessages = convertToMistralMessages(anthropicMessages)
		expect(mistralMessages).toHaveLength(2)
		expect(mistralMessages[0]).toEqual({
			role: "user",
			content: "Hello",
		})
		expect(mistralMessages[1]).toEqual({
			role: "assistant",
			content: "Hi there!",
		})
	})

	it("should handle user messages with image content", () => {
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

		const mistralMessages = convertToMistralMessages(anthropicMessages)
		expect(mistralMessages).toHaveLength(1)
		expect(mistralMessages[0].role).toBe("user")

		const content = mistralMessages[0].content as Array<{
			type: string
			text?: string
			imageUrl?: { url: string }
		}>

		expect(Array.isArray(content)).toBe(true)
		expect(content).toHaveLength(2)
		expect(content[0]).toEqual({ type: "text", text: "What is in this image?" })
		expect(content[1]).toEqual({
			type: "image_url",
			imageUrl: { url: "data:image/jpeg;base64,base64data" },
		})
	})

	it("should handle user messages with only tool results", () => {
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

		// Tool results are converted to Mistral "tool" role messages
		const mistralMessages = convertToMistralMessages(anthropicMessages)
		expect(mistralMessages).toHaveLength(1)
		expect(mistralMessages[0].role).toBe("tool")
		expect((mistralMessages[0] as { toolCallId?: string }).toolCallId).toBe("weather-123")
		expect(mistralMessages[0].content).toBe("Current temperature in London: 20°C")
	})

	it("should handle user messages with mixed content (text, image, and tool results)", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's the weather data and an image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "imagedata123",
						},
					},
					{
						type: "tool_result",
						tool_use_id: "weather-123",
						content: "Current temperature in London: 20°C",
					},
				],
			},
		]

		const mistralMessages = convertToMistralMessages(anthropicMessages)
		// Mistral doesn't allow user messages after tool messages, so only tool results are converted
		// User content (text/images) is intentionally skipped when there are tool results
		expect(mistralMessages).toHaveLength(1)

		// Only the tool result should be present
		expect(mistralMessages[0].role).toBe("tool")
		expect((mistralMessages[0] as { toolCallId?: string }).toolCallId).toBe("weather-123")
		expect(mistralMessages[0].content).toBe("Current temperature in London: 20°C")
	})

	it("should handle assistant messages with text content", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I'll help you with that question.",
					},
				],
			},
		]

		const mistralMessages = convertToMistralMessages(anthropicMessages)
		expect(mistralMessages).toHaveLength(1)
		expect(mistralMessages[0].role).toBe("assistant")
		expect(mistralMessages[0].content).toBe("I'll help you with that question.")
	})

	it("should handle assistant messages with tool use", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "Let me check the weather for you.",
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

		const mistralMessages = convertToMistralMessages(anthropicMessages)
		expect(mistralMessages).toHaveLength(1)
		expect(mistralMessages[0].role).toBe("assistant")
		expect(mistralMessages[0].content).toBe("Let me check the weather for you.")
	})

	it("should handle multiple text blocks in assistant messages", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "First paragraph of information.",
					},
					{
						type: "text",
						text: "Second paragraph with more details.",
					},
				],
			},
		]

		const mistralMessages = convertToMistralMessages(anthropicMessages)
		expect(mistralMessages).toHaveLength(1)
		expect(mistralMessages[0].role).toBe("assistant")
		expect(mistralMessages[0].content).toBe("First paragraph of information.\nSecond paragraph with more details.")
	})

	it("should handle a conversation with mixed message types", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "What's in this image?",
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
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "This image shows a landscape with mountains.",
					},
					{
						type: "tool_use",
						id: "search-123",
						name: "search_info",
						input: { query: "mountain types" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "search-123",
						content: "Found information about different mountain types.",
					},
				],
			},
			{
				role: "assistant",
				content: "Based on the search results, I can tell you more about the mountains in the image.",
			},
		]

		const mistralMessages = convertToMistralMessages(anthropicMessages)
		// Tool results are now converted to tool messages
		expect(mistralMessages).toHaveLength(4)

		// User message with image
		expect(mistralMessages[0].role).toBe("user")
		const userContent = mistralMessages[0].content as Array<{
			type: string
			text?: string
			imageUrl?: { url: string }
		}>
		expect(Array.isArray(userContent)).toBe(true)
		expect(userContent).toHaveLength(2)

		// Assistant message with text and toolCalls
		expect(mistralMessages[1].role).toBe("assistant")
		expect(mistralMessages[1].content).toBe("This image shows a landscape with mountains.")

		// Tool result message
		expect(mistralMessages[2].role).toBe("tool")
		expect((mistralMessages[2] as { toolCallId?: string }).toolCallId).toBe("search-123")
		expect(mistralMessages[2].content).toBe("Found information about different mountain types.")

		// Final assistant message
		expect(mistralMessages[3]).toEqual({
			role: "assistant",
			content: "Based on the search results, I can tell you more about the mountains in the image.",
		})
	})

	it("should handle empty content in assistant messages", () => {
		const anthropicMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "search-123",
						name: "search_info",
						input: { query: "test query" },
					},
				],
			},
		]

		const mistralMessages = convertToMistralMessages(anthropicMessages)
		expect(mistralMessages).toHaveLength(1)
		expect(mistralMessages[0].role).toBe("assistant")
		expect(mistralMessages[0].content).toBeUndefined()
	})
})

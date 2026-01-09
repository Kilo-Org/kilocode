// npx vitest run src/api/transform/caching/__tests__/kilocode.spec.ts

import OpenAI from "openai"

import { addAnthropicCacheBreakpoints } from "../kilocode"

describe("addAnthropicCacheBreakpoints (Kilocode)", () => {
	const systemPrompt = "You are a helpful assistant."

	it("should add a cache breakpoint to the system prompt", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "Hello" },
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])
	})

	it("should add a breakpoint to the only user message if only one exists", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" },
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		// System prompt gets cache control
		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])

		// Last user message gets cache control
		expect(messages[1].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])
	})

	it("should add breakpoints to system, last user, and user before last assistant", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" },
			{ role: "assistant", content: "Assistant response 1" },
			{ role: "user", content: "User message 2" },
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		// System prompt gets cache control
		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])

		// User message before last assistant gets cache control
		expect(messages[1].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])

		// Assistant message should not be modified
		expect(messages[2].content).toBe("Assistant response 1")

		// Last user message gets cache control
		expect(messages[3].content).toEqual([
			{ type: "text", text: "User message 2", cache_control: { type: "ephemeral" } },
		])
	})

	it("should handle multiple assistant messages and find the user before the last one", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" },
			{ role: "assistant", content: "Assistant response 1" },
			{ role: "user", content: "User message 2" },
			{ role: "assistant", content: "Assistant response 2" },
			{ role: "user", content: "User message 3" },
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		// System prompt gets cache control
		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])

		// First user message should NOT get cache control (not before last assistant)
		expect(messages[1].content).toBe("User message 1")

		// User message before last assistant (index 4) gets cache control
		expect(messages[3].content).toEqual([
			{ type: "text", text: "User message 2", cache_control: { type: "ephemeral" } },
		])

		// Last user message gets cache control
		expect(messages[5].content).toEqual([
			{ type: "text", text: "User message 3", cache_control: { type: "ephemeral" } },
		])
	})

	it("should handle tool messages the same as user messages", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" },
			{ role: "assistant", content: "Let me use a tool" },
			{ role: "tool", content: "Tool result", tool_call_id: "call_123" },
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		// System prompt gets cache control
		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])

		// User message before last assistant gets cache control
		expect(messages[1].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])

		// Tool message (last user/tool) gets cache control
		expect(messages[3].content).toEqual([
			{ type: "text", text: "Tool result", cache_control: { type: "ephemeral" } },
		])
	})

	it("should handle array content and add cache control to last item", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{
				role: "user",
				content: [
					{ type: "text", text: "First part" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
					{ type: "text", text: "Last part" },
				],
			},
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		expect(messages[1].content).toEqual([
			{ type: "text", text: "First part" },
			{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
			{ type: "text", text: "Last part", cache_control: { type: "ephemeral" } },
		])
	})

	it("should add cache control to last item of array when it's an image", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{
				role: "user",
				content: [
					{ type: "text", text: "Some text" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,..." } },
				],
			},
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		// Cache control should be on the last item (the image)
		expect(messages[1].content).toEqual([
			{ type: "text", text: "Some text" },
			{
				type: "image_url",
				image_url: { url: "data:image/png;base64,..." },
				cache_control: { type: "ephemeral" },
			},
		])
	})

	it("should not add breakpoints when there are no user or tool messages", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "assistant", content: "Hello" },
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		// Only system prompt should get cache control
		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])

		// Assistant message should not be modified
		expect(messages[1].content).toBe("Hello")
	})

	it("should handle case when system prompt is found in messages array", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: "Different system prompt in array" },
			{ role: "user", content: "Hello" },
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		// Should use the system prompt found in messages, not the passed parameter
		expect(messages[0].content).toEqual([
			{ type: "text", text: "Different system prompt in array", cache_control: { type: "ephemeral" } },
		])
	})

	it("should handle when last user message is also user before last assistant (same message)", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "User message 1" },
			{ role: "assistant", content: "Assistant response" },
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		// System prompt gets cache control
		expect(messages[0].content).toEqual([
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
		])

		// User message 1 is both before last assistant and is the last user message
		// It should have cache control set (the function calls setCacheControl twice on same message)
		expect(messages[1].content).toEqual([
			{ type: "text", text: "User message 1", cache_control: { type: "ephemeral" } },
		])
	})

	it("should handle empty messages array gracefully", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

		// Should not throw
		expect(() => addAnthropicCacheBreakpoints(systemPrompt, messages)).not.toThrow()
	})

	it("should handle empty array content", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: [] },
		]

		addAnthropicCacheBreakpoints(systemPrompt, messages)

		// Empty array should remain empty (no last item to add cache control to)
		expect(messages[1].content).toEqual([])
	})
})

import { Anthropic } from "@anthropic-ai/sdk"

import { filterNonAnthropicBlocks, VALID_ANTHROPIC_BLOCK_TYPES } from "../anthropic-filter"

describe("anthropic-filter", () => {
	describe("VALID_ANTHROPIC_BLOCK_TYPES", () => {
		it("should contain all valid Anthropic types", () => {
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("text")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("image")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("tool_use")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("tool_result")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("thinking")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("redacted_thinking")).toBe(true)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("document")).toBe(true)
		})

		it("should not contain internal or provider-specific types", () => {
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("reasoning")).toBe(false)
			expect(VALID_ANTHROPIC_BLOCK_TYPES.has("thoughtSignature")).toBe(false)
		})
	})

	describe("filterNonAnthropicBlocks", () => {
		it("should pass through messages with string content", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
			]

			const result = filterNonAnthropicBlocks(messages)

			expect(result).toEqual(messages)
		})

		it("should pass through messages with valid Anthropic blocks", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "Hi there!" }],
				},
			]

			const result = filterNonAnthropicBlocks(messages)

			expect(result).toEqual(messages)
		})

		it("should filter out reasoning blocks from messages", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: [
						{ type: "reasoning" as any, text: "Internal reasoning" },
						{ type: "text", text: "Response" },
					],
				},
			]

			const result = filterNonAnthropicBlocks(messages)

			expect(result).toHaveLength(2)
			expect(result[1].content).toEqual([{ type: "text", text: "Response" }])
		})

		it("should filter out thoughtSignature blocks from messages", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: [
						{ type: "thoughtSignature", thoughtSignature: "encrypted-sig" } as any,
						{ type: "text", text: "Response" },
					],
				},
			]

			const result = filterNonAnthropicBlocks(messages)

			expect(result).toHaveLength(2)
			expect(result[1].content).toEqual([{ type: "text", text: "Response" }])
		})

		it("should remove messages that become empty after filtering", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: [{ type: "reasoning" as any, text: "Only reasoning" }],
				},
				{ role: "user", content: "Continue" },
			]

			const result = filterNonAnthropicBlocks(messages)

			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Hello")
			expect(result[1].content).toBe("Continue")
		})

		it("should handle mixed content with multiple invalid block types", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{ type: "reasoning", text: "Reasoning" } as any,
						{ type: "text", text: "Text 1" },
						{ type: "thoughtSignature", thoughtSignature: "sig" } as any,
						{ type: "text", text: "Text 2" },
					],
				},
			]

			const result = filterNonAnthropicBlocks(messages)

			expect(result).toHaveLength(1)
			expect(result[0].content).toEqual([
				{ type: "text", text: "Text 1" },
				{ type: "text", text: "Text 2" },
			])
		})

		it("should filter out any unknown block types", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{ type: "unknown_future_type", data: "some data" } as any,
						{ type: "text", text: "Valid text" },
					],
				},
			]

			const result = filterNonAnthropicBlocks(messages)

			expect(result).toHaveLength(1)
			expect(result[0].content).toEqual([{ type: "text", text: "Valid text" }])
		})

		// kilocode_change start
		describe("thinking parameter handling", () => {
			it("should preserve thinking blocks when thinking is enabled", () => {
				const messages: Anthropic.Messages.MessageParam[] = [
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "Let me think...", signature: "abc123" } as any,
							{ type: "text", text: "Here is my response" },
						],
					},
				]

				// When thinking is enabled (has a value), preserve thinking blocks
				const thinkingEnabled = { type: "enabled" as const, budget_tokens: 10000 }
				const result = filterNonAnthropicBlocks(messages, thinkingEnabled)
				expect(result[0].content).toHaveLength(2)
				expect((result[0].content as any[])[0].type).toBe("thinking")
			})

			it("should strip thinking and redacted_thinking blocks when thinking is undefined (disabled)", () => {
				const messages: Anthropic.Messages.MessageParam[] = [
					{ role: "user", content: "First question" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "Thinking about first question" } as any,
							{ type: "text", text: "First response" },
						],
					},
					{ role: "user", content: "Second question" },
					{
						role: "assistant",
						content: [
							{ type: "redacted_thinking", data: "encrypted" } as any,
							{ type: "text", text: "Second response" },
						],
					},
					{
						role: "assistant",
						content: [{ type: "thinking", thinking: "Only thinking, no text" } as any],
					},
				]

				// When thinking is undefined (disabled), strip thinking blocks
				const result = filterNonAnthropicBlocks(messages, undefined)

				// Strips thinking blocks but keeps text content
				expect(result[1].content).toEqual([{ type: "text", text: "First response" }])
				expect(result[3].content).toEqual([{ type: "text", text: "Second response" }])
				// Removes messages that become empty after stripping
				expect(result).toHaveLength(4) // Last assistant message removed (was only thinking)
			})
		})
		// kilocode_change end
	})
})

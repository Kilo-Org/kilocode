import { describe, it, expect } from "vitest"
import { formatContentBlockToMarkdown, ExtendedContentBlock } from "../export-markdown"

describe("export-markdown", () => {
	describe("formatContentBlockToMarkdown", () => {
		it("should format text blocks", () => {
			const block = { type: "text", text: "Hello, world!" } as ExtendedContentBlock
			expect(formatContentBlockToMarkdown(block)).toBe("Hello, world!")
		})

		it("should format image blocks", () => {
			const block = {
				type: "image",
				source: { type: "base64", media_type: "image/png", data: "data" },
			} as ExtendedContentBlock
			expect(formatContentBlockToMarkdown(block)).toBe("[Image]")
		})

		it("should format tool_use blocks with string input", () => {
			const block = { type: "tool_use", name: "read_file", id: "123", input: "file.txt" } as ExtendedContentBlock
			expect(formatContentBlockToMarkdown(block)).toBe("[Tool Use: read_file]\nfile.txt")
		})

		it("should format tool_use blocks with object input", () => {
			const block = {
				type: "tool_use",
				name: "read_file",
				id: "123",
				input: { path: "file.txt", line_count: 10 },
			} as ExtendedContentBlock
			expect(formatContentBlockToMarkdown(block)).toBe("[Tool Use: read_file]\nPath: file.txt\nLine_count: 10")
		})

		it("should format tool_result blocks with string content", () => {
			const block = { type: "tool_result", tool_use_id: "123", content: "File content" } as ExtendedContentBlock
			expect(formatContentBlockToMarkdown(block)).toBe("[Tool]\nFile content")
		})

		it("should format tool_result blocks with error", () => {
			const block = {
				type: "tool_result",
				tool_use_id: "123",
				content: "Error message",
				is_error: true,
			} as ExtendedContentBlock
			expect(formatContentBlockToMarkdown(block)).toBe("[Tool (Error)]\nError message")
		})

		it("should format tool_result blocks with array content", () => {
			const block = {
				type: "tool_result",
				tool_use_id: "123",
				content: [
					{ type: "text", text: "Line 1" },
					{ type: "text", text: "Line 2" },
				],
			} as ExtendedContentBlock
			expect(formatContentBlockToMarkdown(block)).toBe("[Tool]\nLine 1\nLine 2")
		})

		it("should format reasoning blocks", () => {
			const block = { type: "reasoning", text: "Let me think about this..." } as ExtendedContentBlock
			expect(formatContentBlockToMarkdown(block)).toBe("[Reasoning]\nLet me think about this...")
		})

		it("should skip thoughtSignature blocks", () => {
			const block = { type: "thoughtSignature" } as ExtendedContentBlock
			expect(formatContentBlockToMarkdown(block)).toBe("")
		})

		it("should handle unexpected content types", () => {
			const block = { type: "unknown_type" as const } as any
			expect(formatContentBlockToMarkdown(block)).toBe("[Unexpected content type: unknown_type]")
		})
	})
})

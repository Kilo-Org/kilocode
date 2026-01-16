// npx vitest utils/__tests__/tiktoken.spec.ts

import { tiktoken } from "../tiktoken"
import { Anthropic } from "@anthropic-ai/sdk"

describe("tiktoken", () => {
	it("should return 0 for empty content array", async () => {
		const result = await tiktoken([])
		expect(result).toBe(0)
	})

	it("should correctly count tokens for text content", async () => {
		const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "Hello world" }]

		const result = await tiktoken(content)
		// We can't predict the exact token count without mocking,
		// but we can verify it's a positive number
		expect(result).toEqual(3)
	})

	it("should handle empty text content", async () => {
		const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "" }]

		const result = await tiktoken(content)
		expect(result).toBe(0)
	})

	it("should not throw on text content with special tokens", async () => {
		const content: Anthropic.Messages.ContentBlockParam[] = [
			{ type: "text", text: "something<|endoftext|>something" },
		]

		const result = await tiktoken(content)
		expect(result).toBeGreaterThan(0)
	})

	it("should handle missing text content", async () => {
		// Using 'as any' to bypass TypeScript's type checking for this test case
		// since we're specifically testing how the function handles undefined text
		const content = [{ type: "text" }] as any as Anthropic.Messages.ContentBlockParam[]

		const result = await tiktoken(content)
		expect(result).toBe(0)
	})

	it("should correctly count tokens for image content with data", async () => {
		const base64Data =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
		const content: Anthropic.Messages.ContentBlockParam[] = [
			{
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: base64Data,
				},
			},
		]

		const result = await tiktoken(content)
		// For images, we expect a token count based on the square root of the data length
		// plus the fudge factor
		const expectedMinTokens = Math.ceil(Math.sqrt(base64Data.length))
		expect(result).toBeGreaterThanOrEqual(expectedMinTokens)
	})

	it("should use conservative estimate for image content without data", async () => {
		// Using 'as any' to bypass TypeScript's type checking for this test case
		// since we're specifically testing the fallback behavior
		const content = [
			{
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					// data is intentionally missing to test fallback
				},
			},
		] as any as Anthropic.Messages.ContentBlockParam[]

		const result = await tiktoken(content)
		// Conservative estimate is 300 tokens, plus the fudge factor
		const expectedMinTokens = 300
		expect(result).toBeGreaterThanOrEqual(expectedMinTokens)
	})

	it("should correctly count tokens for mixed content", async () => {
		const base64Data =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
		const content: Anthropic.Messages.ContentBlockParam[] = [
			{ type: "text", text: "Hello world" },
			{
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: base64Data,
				},
			},
			{ type: "text", text: "Goodbye world" },
		]

		const result = await tiktoken(content)
		// We expect a positive token count for mixed content
		expect(result).toBeGreaterThan(0)
	})

	it("should apply a fudge factor to the token count", async () => {
		// We can test the fudge factor by comparing the token count with a rough estimate
		const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "Test" }]

		const result = await tiktoken(content)

		// Run the function again with the same content to get a consistent result
		const result2 = await tiktoken(content)

		// Both calls should return the same token count
		expect(result).toBe(result2)

		// The result should be greater than 0
		expect(result).toBeGreaterThan(0)
	})

	it("should reuse the encoder for multiple calls", async () => {
		// We can't directly test the caching behavior without mocking,
		// but we can test that multiple calls with the same content return the same result
		// which indirectly verifies the encoder is working consistently

		const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "Hello world" }]

		const result1 = await tiktoken(content)
		const result2 = await tiktoken(content)

		// Both calls should return the same token count
		expect(result1).toBe(result2)
	})

	describe("tool_use blocks", () => {
		it("should count tokens for tool_use blocks with simple arguments", async () => {
			const content = [
				{
					type: "tool_use",
					id: "tool_123",
					name: "read_file",
					input: { path: "/src/main.ts" },
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const result = await tiktoken(content)
			// Should return a positive token count for the serialized tool call
			expect(result).toBeGreaterThan(0)
		})

		it("should count tokens for tool_use blocks with complex arguments", async () => {
			const content = [
				{
					type: "tool_use",
					id: "tool_456",
					name: "write_to_file",
					input: {
						path: "/src/components/Button.tsx",
						content:
							"import React from 'react';\n\nexport const Button = ({ children, onClick }) => {\n  return <button onClick={onClick}>{children}</button>;\n};",
					},
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const result = await tiktoken(content)
			// Should return a token count reflecting the larger content
			expect(result).toBeGreaterThan(10)
		})

		it("should handle tool_use blocks with empty input", async () => {
			const content = [
				{
					type: "tool_use",
					id: "tool_789",
					name: "list_files",
					input: {},
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const result = await tiktoken(content)
			// Should still count the tool name (and empty args)
			expect(result).toBeGreaterThan(0)
		})
	})

	describe("tool_result blocks", () => {
		it("should count tokens for tool_result blocks with string content", async () => {
			const content = [
				{
					type: "tool_result",
					tool_use_id: "tool_123",
					content: "File content: export const foo = 'bar';",
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const result = await tiktoken(content)
			// Should return a positive token count
			expect(result).toBeGreaterThan(0)
		})

		it("should count tokens for tool_result blocks with array content", async () => {
			const content = [
				{
					type: "tool_result",
					tool_use_id: "tool_456",
					content: [
						{ type: "text", text: "First part of the result" },
						{ type: "text", text: "Second part of the result" },
					],
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const result = await tiktoken(content)
			// Should count tokens from all text parts
			expect(result).toBeGreaterThan(0)
		})

		it("should count tokens for tool_result blocks with error flag", async () => {
			const content = [
				{
					type: "tool_result",
					tool_use_id: "tool_789",
					is_error: true,
					content: "Error: File not found",
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const result = await tiktoken(content)
			// Should include the error indicator and content
			expect(result).toBeGreaterThan(0)
		})

		it("should handle tool_result blocks with image content in array", async () => {
			const content = [
				{
					type: "tool_result",
					tool_use_id: "tool_abc",
					content: [
						{ type: "text", text: "Screenshot captured" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
					],
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const result = await tiktoken(content)
			// Should count text and include placeholder for images
			expect(result).toBeGreaterThan(0)
		})
	})

	describe("mixed content with tools", () => {
		it("should count tokens for conversation with tool_use and tool_result", async () => {
			const content = [
				{ type: "text", text: "Let me read that file for you." },
				{
					type: "tool_use",
					id: "tool_123",
					name: "read_file",
					input: { path: "/src/index.ts" },
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const result = await tiktoken(content)
			// Should count both text and tool_use tokens
			expect(result).toBeGreaterThan(5)
		})

		it("should produce larger count for tool_result with large content vs small content", async () => {
			const smallContent = [
				{
					type: "tool_result",
					tool_use_id: "tool_1",
					content: "OK",
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const largeContent = [
				{
					type: "tool_result",
					tool_use_id: "tool_2",
					content:
						"This is a much longer result that contains a lot more text and should therefore have a significantly higher token count than the small content.",
				},
			] as Anthropic.Messages.ContentBlockParam[]

			const smallResult = await tiktoken(smallContent)
			const largeResult = await tiktoken(largeContent)

			// Large content should have more tokens
			expect(largeResult).toBeGreaterThan(smallResult)
		})
	})
})

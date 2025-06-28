import { truncateIfNeeded } from "../truncateIfNeeded"

describe("truncateIfNeeded", () => {
	describe("when text fits within context window", () => {
		it("should return original text when it fits within 20% of context window", () => {
			const text = "Hello world"
			const contextWindow = 1000
			// Text has ~4 tokens (11 chars / 3), max allowed is 200 tokens (20% of 1000)

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toBe(text)
		})

		it("should return original text for empty string", () => {
			const text = ""
			const contextWindow = 100

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toBe("")
		})

		it("should return original text for single character", () => {
			const text = "a"
			const contextWindow = 100

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toBe("a")
		})
	})

	describe("when text exceeds context window", () => {
		it("should truncate text and add warning message", () => {
			const text = "a".repeat(300) // 300 chars = ~100 tokens
			const contextWindow = 100 // 20% = 20 tokens max

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toContain("**Important:** The output below was truncated")
			expect(result).toContain("due to size limits and is therefore *incomplete*!")
			expect(result).toContain("You *must* notify the user of this!")
		})

		it("should truncate multiline text correctly", () => {
			const lines = [
				"a".repeat(30), // ~10 tokens
				"b".repeat(30), // ~10 tokens
				"c".repeat(30), // ~10 tokens
				"d".repeat(30), // ~10 tokens
				"e".repeat(30), // ~10 tokens
			]
			const text = lines.join("\n")
			const contextWindow = 100 // 20% = 20 tokens max

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toContain("**Important:** The output below was truncated")
			expect(result).toContain("from 5 lines to 2 lines")
			// Should keep first 2 lines (20 tokens total)
			expect(result).toContain(lines[0])
			expect(result).toContain(lines[1])
			expect(result).not.toContain(lines[2])
			expect(result).not.toContain(lines[3])
			expect(result).not.toContain(lines[4])
		})

		it("should handle single long line that exceeds limit", () => {
			const text = "a".repeat(600) // ~200 tokens
			const contextWindow = 100 // 20% = 20 tokens max

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toContain("**Important:** The output below was truncated")
			expect(result).toContain("from 1 lines to 0 lines")
			// Should truncate to empty content since even first line exceeds limit
			expect(result).toMatch(/\*\*Important:\*\*.*\n\n$/)
		})

		it("should preserve line structure in truncated output", () => {
			const lines = [
				"First line",
				"Second line",
				"Third line with more content to exceed token limit and force truncation",
				"Fourth line with even more content to definitely exceed the token limit",
			]
			const text = lines.join("\n")
			const contextWindow = 100 // 20% = 20 tokens max

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toContain("**Important:** The output below was truncated")
			// Should preserve newlines in kept content
			const truncatedContent = result.split("\n\n")[1] // Get content after warning
			expect(truncatedContent).toContain("\n")
		})
	})

	describe("edge cases", () => {
		it("should handle very small context window", () => {
			const text = "Hello world"
			const contextWindow = 1

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toContain("**Important:** The output below was truncated")
			expect(result).toContain("from 1 lines to 0 lines")
		})

		it("should handle context window of zero", () => {
			const text = "Hello world"
			const contextWindow = 0

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toContain("**Important:** The output below was truncated")
			expect(result).toContain("from 1 lines to 0 lines")
		})

		it("should handle text with only newlines", () => {
			const text = "\n\n\n\n"
			const contextWindow = 100

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toBe(text) // Should not truncate as it's very small
		})

		it("should handle mixed empty and non-empty lines", () => {
			const lines = ["", "content", "", "more content", ""]
			const text = lines.join("\n")
			const contextWindow = 1000

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toBe(text) // Should not truncate
		})

		it("should handle many lines of a single character", () => {
			const text = "a\n".repeat(50)
			const contextWindow = 30

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toContain("**Important:** The output below was truncated")
		})
	})

	describe("token estimation accuracy", () => {
		it("should use 3 characters per token estimation", () => {
			// Test the boundary where token estimation matters
			const text = "abc".repeat(20) // 60 chars = exactly 20 tokens
			const contextWindow = 100 // 20% = 20 tokens max

			const result = truncateIfNeeded(text, contextWindow)

			// Should not truncate as it exactly fits
			expect(result).toBe(text)
		})

		it("should truncate when exceeding token estimate by one character", () => {
			const text = "abc".repeat(20) + "d" // 61 chars = ~20.33 tokens
			const contextWindow = 100 // 20% = 20 tokens max

			const result = truncateIfNeeded(text, contextWindow)

			// Should truncate as 61/3 > 21 tokens
			expect(result).toContain("**Important:** The output below was truncated from 1 lines to 0 lines")
		})
	})

	describe("context window fraction calculation", () => {
		it("should use 20% of context window as limit", () => {
			const contextWindow = 1000
			const expectedMaxTokens = Math.floor(0.2 * contextWindow) // 200 tokens
			const text = "a".repeat(expectedMaxTokens * 3) // Exactly at limit

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toBe(text)
		})

		it("should truncate when exceeding 20% of context window", () => {
			const contextWindow = 1000
			const expectedMaxTokens = Math.floor(0.2 * contextWindow) // 200 tokens
			const text = "a".repeat(expectedMaxTokens * 3 + 3) // 3 chars over limit

			const result = truncateIfNeeded(text, contextWindow)

			expect(result).toContain("**Important:** The output below was truncated")
		})
	})
})

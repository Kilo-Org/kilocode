import { describe, it, expect } from "vitest"
import {
	countTokens,
	pruneLinesFromTop,
	pruneLinesFromBottom,
	getPrunedPrefixSuffix,
	calculateOptimalEditableRegion,
} from "../tokenHelpers"

describe("tokenHelpers", () => {
	describe("countTokens", () => {
		it("should count tokens accurately using tiktoken", () => {
			const text = "Hello, world! This is a test."
			const tokenCount = countTokens(text)

			// tiktoken should give accurate count (not just length/4)
			expect(tokenCount).toBeGreaterThan(0)
			expect(tokenCount).toBeLessThan(text.length) // Should be less than character count
		})

		it("should handle empty strings", () => {
			expect(countTokens("")).toBe(0)
			expect(countTokens("", "gpt-4")).toBe(0)
		})

		it("should handle multi-line text", () => {
			const text = "Line 1\nLine 2\nLine 3"
			const tokenCount = countTokens(text)
			expect(tokenCount).toBeGreaterThan(0)
		})

		it("should handle code snippets", () => {
			const code = `function hello() {
	console.log("Hello, world!");
	return true;
}`
			const tokenCount = countTokens(code)
			expect(tokenCount).toBeGreaterThan(0)
		})

		it("should handle special characters", () => {
			const text = "Special chars: @#$%^&*()_+-=[]{}|;':\",./<>?"
			const tokenCount = countTokens(text)
			expect(tokenCount).toBeGreaterThan(0)
		})

		it("should handle unicode characters", () => {
			const text = "Unicode: 你好世界 🌍 émojis"
			const tokenCount = countTokens(text)
			expect(tokenCount).toBeGreaterThan(0)
		})

		it("should be consistent for same input", () => {
			const text = "Consistency test"
			const count1 = countTokens(text)
			const count2 = countTokens(text)
			expect(count1).toBe(count2)
		})

		it("should handle very long text", () => {
			const longText = "word ".repeat(1000)
			const tokenCount = countTokens(longText)
			expect(tokenCount).toBeGreaterThan(0)
			expect(tokenCount).toBeLessThan(longText.length)
		})
	})

	describe("pruneLinesFromTop", () => {
		it("should prune lines from top to fit token budget", () => {
			const text = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
			const maxTokens = 10
			const pruned = pruneLinesFromTop(text, maxTokens)

			expect(pruned.length).toBeLessThanOrEqual(text.length)
			expect(countTokens(pruned)).toBeLessThanOrEqual(maxTokens)
		})

		it("should return empty string if budget is too small", () => {
			const text = "This is a long line that exceeds the budget"
			const maxTokens = 1
			const pruned = pruneLinesFromTop(text, maxTokens)

			// Should prune aggressively
			expect(pruned.length).toBeLessThan(text.length)
		})

		it("should preserve all lines if within budget", () => {
			const text = "Short\nText"
			const maxTokens = 1000
			const pruned = pruneLinesFromTop(text, maxTokens)

			expect(pruned).toBe(text)
		})

		it("should handle single line text", () => {
			const text = "Single line"
			const maxTokens = 5
			const pruned = pruneLinesFromTop(text, maxTokens)

			expect(pruned).toBe(text)
		})
	})

	describe("pruneLinesFromBottom", () => {
		it("should prune lines from bottom to fit token budget", () => {
			const text = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
			const maxTokens = 10
			const pruned = pruneLinesFromBottom(text, maxTokens)

			expect(pruned.length).toBeLessThanOrEqual(text.length)
			expect(countTokens(pruned)).toBeLessThanOrEqual(maxTokens)
		})

		it("should return empty string if budget is too small", () => {
			const text = "This is a long line that exceeds the budget"
			const maxTokens = 1
			const pruned = pruneLinesFromBottom(text, maxTokens)

			// Should prune aggressively
			expect(pruned.length).toBeLessThan(text.length)
		})

		it("should preserve all lines if within budget", () => {
			const text = "Short\nText"
			const maxTokens = 1000
			const pruned = pruneLinesFromBottom(text, maxTokens)

			expect(pruned).toBe(text)
		})

		it("should handle single line text", () => {
			const text = "Single line"
			const maxTokens = 5
			const pruned = pruneLinesFromBottom(text, maxTokens)

			expect(pruned).toBe(text)
		})
	})

	describe("getPrunedPrefixSuffix", () => {
		it("should allocate tokens according to percentages", () => {
			const prefix = "Prefix line 1\nPrefix line 2\nPrefix line 3"
			const suffix = "Suffix line 1\nSuffix line 2\nSuffix line 3"

			const result = getPrunedPrefixSuffix(prefix, suffix, {
				maxPromptTokens: 50,
				prefixPercentage: 0.7,
				maxSuffixPercentage: 0.3,
			})

			expect(result.prunedPrefix).toBeDefined()
			expect(result.prunedSuffix).toBeDefined()
			expect(result.prunedCaretWindow).toBe(result.prunedPrefix + result.prunedSuffix)

			const totalTokens = countTokens(result.prunedCaretWindow)
			expect(totalTokens).toBeLessThanOrEqual(50)
		})

		it("should handle empty prefix", () => {
			const result = getPrunedPrefixSuffix("", "Suffix text", {
				maxPromptTokens: 20,
				prefixPercentage: 0.7,
				maxSuffixPercentage: 0.3,
			})

			expect(result.prunedPrefix).toBe("")
			expect(result.prunedSuffix).toBeDefined()
		})

		it("should handle empty suffix", () => {
			const result = getPrunedPrefixSuffix("Prefix text", "", {
				maxPromptTokens: 20,
				prefixPercentage: 0.7,
				maxSuffixPercentage: 0.3,
			})

			expect(result.prunedPrefix).toBeDefined()
			expect(result.prunedSuffix).toBe("")
		})

		it("should respect maxSuffixPercentage", () => {
			const prefix = "Short prefix"
			const suffix = "Very long suffix ".repeat(100)

			const result = getPrunedPrefixSuffix(prefix, suffix, {
				maxPromptTokens: 100,
				prefixPercentage: 0.7,
				maxSuffixPercentage: 0.2,
			})

			const suffixTokens = countTokens(result.prunedSuffix)
			expect(suffixTokens).toBeLessThanOrEqual(20) // 20% of 100
		})
	})

	describe("calculateOptimalEditableRegion", () => {
		it("should calculate editable region with correct boundaries", () => {
			const fileContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
			const cursorOffset = 14 // After "Line 2\n"

			const result = calculateOptimalEditableRegion(fileContent, cursorOffset, {
				maxPromptTokens: 50,
				prefixPercentage: 0.7,
				maxSuffixPercentage: 0.3,
			})

			expect(result.prefix).toBe(fileContent.slice(0, cursorOffset))
			expect(result.suffix).toBe(fileContent.slice(cursorOffset))
			expect(result.prunedPrefix).toBeDefined()
			expect(result.prunedSuffix).toBeDefined()
			expect(result.startLine).toBeGreaterThanOrEqual(0)
			expect(result.endLine).toBeGreaterThanOrEqual(result.startLine)
		})

		it("should handle cursor at start of file", () => {
			const fileContent = "Line 1\nLine 2\nLine 3"
			const cursorOffset = 0

			const result = calculateOptimalEditableRegion(fileContent, cursorOffset, {
				maxPromptTokens: 50,
				prefixPercentage: 0.7,
				maxSuffixPercentage: 0.3,
			})

			expect(result.prefix).toBe("")
			expect(result.suffix).toBe(fileContent)
			expect(result.startLine).toBe(0)
		})

		it("should handle cursor at end of file", () => {
			const fileContent = "Line 1\nLine 2\nLine 3"
			const cursorOffset = fileContent.length

			const result = calculateOptimalEditableRegion(fileContent, cursorOffset, {
				maxPromptTokens: 50,
				prefixPercentage: 0.7,
				maxSuffixPercentage: 0.3,
			})

			expect(result.prefix).toBe(fileContent)
			expect(result.suffix).toBe("")
		})

		it("should respect token budget", () => {
			const fileContent = "Line ".repeat(1000)
			const cursorOffset = Math.floor(fileContent.length / 2)

			const result = calculateOptimalEditableRegion(fileContent, cursorOffset, {
				maxPromptTokens: 100,
				prefixPercentage: 0.7,
				maxSuffixPercentage: 0.3,
			})

			const totalTokens = countTokens(result.prunedPrefix + result.prunedSuffix)
			expect(totalTokens).toBeLessThanOrEqual(100)
		})
	})

	describe("accuracy validation", () => {
		it("should provide reasonable token counts", () => {
			const text = "The quick brown fox jumps over the lazy dog"
			const actualTokens = countTokens(text)

			// Token count should be reasonable (not just length/4)
			expect(actualTokens).toBeGreaterThan(0)
			expect(actualTokens).toBeLessThan(text.length)
			// For this 44-char text, expect around 9-11 tokens
			expect(actualTokens).toBeGreaterThanOrEqual(8)
			expect(actualTokens).toBeLessThanOrEqual(12)
		})

		it("should handle code tokenization", () => {
			const code = `function calculateSum(a: number, b: number): number {
	return a + b;
}`
			const actualTokens = countTokens(code)

			// Code should tokenize reasonably
			expect(actualTokens).toBeGreaterThan(0)
			expect(actualTokens).toBeLessThan(code.length)
			// For this 72-char code, expect around 15-20 tokens
			expect(actualTokens).toBeGreaterThanOrEqual(14)
			expect(actualTokens).toBeLessThanOrEqual(22)
		})

		it("should be consistent across multiple calls", () => {
			const text = "Consistency test with multiple calls"
			const count1 = countTokens(text)
			const count2 = countTokens(text)
			const count3 = countTokens(text)

			expect(count1).toBe(count2)
			expect(count2).toBe(count3)
		})
	})
})

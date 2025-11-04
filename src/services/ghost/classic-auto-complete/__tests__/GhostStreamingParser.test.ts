import { describe, it, expect } from "vitest"
import { parseGhostResponse } from "../GhostStreamingParser"

describe("GhostStreamingParser", () => {
	const prefix = "function test() {\n  "
	const suffix = "\n}"

	describe("Response parsing with COMPLETION tags", () => {
		it("should extract content between COMPLETION tags", () => {
			const response = "<COMPLETION>return 42</COMPLETION>"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)

			const suggestion = result.suggestions.getFillInAtCursor()
			expect(suggestion?.text).toBe("return 42")
			expect(suggestion?.prefix).toBe(prefix)
			expect(suggestion?.suffix).toBe(suffix)
		})

		it("should handle multiline content in COMPLETION tags", () => {
			const response = "<COMPLETION>const x = 1;\nconst y = 2;\nreturn x + y;</COMPLETION>"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)

			const suggestion = result.suggestions.getFillInAtCursor()
			expect(suggestion?.text).toBe("const x = 1;\nconst y = 2;\nreturn x + y;")
		})

		it("should handle incomplete COMPLETION tag (streaming)", () => {
			const response = "<COMPLETION>return 42"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(false)

			const suggestion = result.suggestions.getFillInAtCursor()
			expect(suggestion?.text).toBeUndefined()
		})

		it("should remove any accidental tag remnants", () => {
			const response = "<COMPLETION>return 42<COMPLETION></COMPLETION>"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			const suggestion = result.suggestions.getFillInAtCursor()
			expect(suggestion?.text).toBe("return 42")
		})

		it("should handle case-insensitive tags", () => {
			const response = "<completion>return 42</completion>"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			const suggestion = result.suggestions.getFillInAtCursor()
			expect(suggestion?.text).toBe("return 42")
		})
	})

	describe("Response parsing without COMPLETION tags (no suggestions)", () => {
		it("should NOT create suggestions when no tags present", () => {
			const response = "return 42"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should NOT create suggestions for multiline response without tags", () => {
			const response = "const x = 1;\nconst y = 2;\nreturn x + y;"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should NOT create suggestions for markdown code blocks without tags", () => {
			const response = "```typescript\nreturn 42\n```"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})
	})

	describe("Edge cases", () => {
		it("should handle empty response", () => {
			const response = ""
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should NOT create suggestions for whitespace-only response without tags", () => {
			const response = "   \n\t  "
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle custom prefix/suffix with COMPLETION tags", () => {
			const customPrefix = "const greeting = "
			const customSuffix = ";"
			const response = '<COMPLETION>"Hello, World!"</COMPLETION>'

			const result = parseGhostResponse(response, customPrefix, customSuffix)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)

			const suggestion = result.suggestions.getFillInAtCursor()
			expect(suggestion?.text).toBe('"Hello, World!"')
			expect(suggestion?.prefix).toBe(customPrefix)
			expect(suggestion?.suffix).toBe(customSuffix)
		})

		it("should handle empty COMPLETION tags", () => {
			const response = "<COMPLETION></COMPLETION>"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle whitespace-only content in COMPLETION tags", () => {
			const response = "<COMPLETION>   </COMPLETION>"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})

		it("should handle response with extra text before COMPLETION tag", () => {
			const response = "Here is the code:\n<COMPLETION>return 42</COMPLETION>"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			const suggestion = result.suggestions.getFillInAtCursor()
			expect(suggestion?.text).toBe("return 42")
		})

		it("should handle response with extra text after COMPLETION tag", () => {
			const response = "<COMPLETION>return 42</COMPLETION>\nThat's the code!"
			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			const suggestion = result.suggestions.getFillInAtCursor()
			expect(suggestion?.text).toBe("return 42")
		})
	})

	describe("performance", () => {
		it("should handle large responses efficiently", () => {
			const largeContent = "x".repeat(10000)
			const response = `<COMPLETION>${largeContent}</COMPLETION>`

			const startTime = performance.now()
			const result = parseGhostResponse(response, prefix, suffix)
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(100)
			expect(result.hasNewSuggestions).toBe(true)
		})
	})
})

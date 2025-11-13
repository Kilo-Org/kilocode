import { postprocessGhostSuggestion } from "../uselessSuggestionFilter"

describe("postprocessGhostSuggestion", () => {
	// Helper function to test filtering (returns undefined)
	const shouldFilter = (suggestion: string, prefix: string, suffix: string, model = "") => {
		return postprocessGhostSuggestion({ suggestion, prefix, suffix, model }) === undefined
	}

	// Helper function to test acceptance (returns processed string)
	const shouldAccept = (suggestion: string, prefix: string, suffix: string, model = "") => {
		const result = postprocessGhostSuggestion({ suggestion, prefix, suffix, model })
		return result !== undefined
	}

	describe("should filter out useless suggestions", () => {
		it("should filter empty suggestions", () => {
			expect(shouldFilter("", "const x = ", " + 1")).toBe(true)
			expect(shouldFilter("   ", "const x = ", " + 1")).toBe(true)
			expect(shouldFilter("\t\n", "const x = ", " + 1")).toBe(true)
		})

		it("should filter suggestions that match the end of prefix", () => {
			// Exact match at the end
			expect(shouldFilter("hello", "const x = hello", "")).toBe(true)
			expect(shouldFilter("world", "hello world", " + 1")).toBe(true)

			// With whitespace variations
			expect(shouldFilter("test", "const test ", "")).toBe(true)
			expect(shouldFilter("foo", "bar foo  ", "")).toBe(true)
		})

		it("should filter suggestions that match the start of suffix", () => {
			// Exact match at the start
			expect(shouldFilter("hello", "const x = ", "hello world")).toBe(true)
			expect(shouldFilter("const", "", "const y = 2")).toBe(true)

			// With whitespace variations
			expect(shouldFilter("test", "const x = ", "  test()")).toBe(true)
			expect(shouldFilter("foo", "", " foo bar")).toBe(true)

			// Trimmed match
			expect(shouldFilter("bar", "const x = ", "  bar  baz")).toBe(true)
		})

		it("should filter suggestions when trimmed version matches", () => {
			expect(shouldFilter("  hello  ", "const x = ", "hello world")).toBe(true)
			expect(shouldFilter("\nhello\t", "test hello", "")).toBe(true)
		})

		it("should filter suggestions that rewrite the line above", () => {
			// This is a new behavior from postprocessCompletion
			const prefix = "function test() {\n  return true\n  "
			const suggestion = "return true"
			expect(shouldFilter(suggestion, prefix, "")).toBe(true)
		})
	})

	describe("should accept useful suggestions", () => {
		it("should accept suggestions that add new content", () => {
			expect(shouldAccept("newValue", "const x = ", "")).toBe(true)
			expect(shouldAccept("42", "const x = ", " + y")).toBe(true)
			expect(shouldAccept("middle", "const x = ", " + y")).toBe(true)
		})

		it("should accept suggestions that don't match prefix end or suffix start", () => {
			expect(shouldAccept("hello", "const x = ", "world")).toBe(true)
			expect(shouldAccept("test", "const x = ", "const y = 2")).toBe(true)
			expect(shouldAccept("foo", "bar", "baz")).toBe(true)
		})

		it("should accept partial matches that are still useful", () => {
			// Suggestion "hello world" with prefix ending in "hello" should be accepted
			// because the full suggestion doesn't match what's at the end of the prefix
			expect(shouldAccept("hello world", "const x = hello", "")).toBe(true)
			expect(shouldAccept("test123", "test", "456")).toBe(true)
		})

		it("should accept suggestions with meaningful content between prefix and suffix", () => {
			expect(shouldAccept("= 42", "const x ", " + y")).toBe(true)
			expect(shouldAccept("()", "myFunction", ".then()")).toBe(true)
		})
	})

	describe("edge cases", () => {
		it("should handle empty prefix and suffix", () => {
			expect(shouldAccept("hello", "", "")).toBe(true)
			expect(shouldFilter("", "", "")).toBe(true)
		})

		it("should handle very long strings", () => {
			const longString = "a".repeat(1000)
			expect(shouldAccept("different", longString, longString)).toBe(true)
			expect(shouldFilter("different", longString + "different", "")).toBe(true)
		})

		it("should handle special characters", () => {
			expect(shouldFilter("${}", "const template = `", "${}`")).toBe(true)
			expect(shouldFilter("\\n", "const x = ", "\\n")).toBe(true)
			expect(shouldFilter("/**/", "const x = /**/", "")).toBe(true)
		})

		it("should handle unicode characters", () => {
			expect(shouldFilter("😀", "const emoji = ", "😀")).toBe(true)
			expect(shouldFilter("你好", "const greeting = 你好", "")).toBe(true)
			expect(shouldAccept("🚀", "launch", "🌟")).toBe(true)
		})
	})

	describe("model-specific postprocessing", () => {
		it("should remove markdown code fences", () => {
			const suggestion = "```javascript\nconst x = 1\n```"
			const result = postprocessGhostSuggestion({
				suggestion,
				prefix: "",
				suffix: "",
				model: "gpt-4",
			})
			expect(result).toBe("const x = 1")
		})

		it("should handle Codestral-specific quirks", () => {
			// Codestral sometimes adds extra leading space
			const result = postprocessGhostSuggestion({
				suggestion: " test",
				prefix: "const x = ",
				suffix: "\n",
				model: "codestral",
			})
			expect(result).toBe("test")
		})

		it("should handle Mercury/Granite prefix duplication", () => {
			const result = postprocessGhostSuggestion({
				suggestion: "const x = 42",
				prefix: "const x = ",
				suffix: "",
				model: "granite-20b",
			})
			expect(result).toBe("42")
		})

		it("should handle Gemini/Gemma file separator", () => {
			const result = postprocessGhostSuggestion({
				suggestion: "const x = 1<|file_separator|>",
				prefix: "",
				suffix: "",
				model: "gemini-pro",
			})
			expect(result).toBe("const x = 1")
		})
	})

	describe("extreme repetition filtering", () => {
		it("should filter extreme repetition", () => {
			const repetitive = "test\ntest\ntest\ntest\ntest\ntest\ntest\ntest\ntest\n"
			expect(shouldFilter(repetitive, "", "")).toBe(true)
		})

		it("should allow normal repetition", () => {
			const normal = "test1\ntest2\ntest3\ntest4\n"
			expect(shouldAccept(normal, "", "")).toBe(true)
		})
	})
})

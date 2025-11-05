import { refuseUselessSuggestion } from "../uselessSuggestionFilter"

describe("refuseUselessSuggestion", () => {
	describe("should refuse useless suggestions", () => {
		it("should refuse empty suggestions", () => {
			expect(refuseUselessSuggestion("", "const x = ", " + 1")).toBe(true)
			expect(refuseUselessSuggestion("   ", "const x = ", " + 1")).toBe(true)
			expect(refuseUselessSuggestion("\t\n", "const x = ", " + 1")).toBe(true)
		})

		it("should refuse suggestions that match the end of prefix", () => {
			// Exact match at the end
			expect(refuseUselessSuggestion("hello", "const x = hello", "")).toBe(true)
			expect(refuseUselessSuggestion("world", "hello world", " + 1")).toBe(true)

			// With whitespace variations
			expect(refuseUselessSuggestion("test", "const test ", "")).toBe(true)
			expect(refuseUselessSuggestion("foo", "bar foo  ", "")).toBe(true)
		})

		it("should refuse suggestions that match the start of suffix", () => {
			// Exact match at the start
			expect(refuseUselessSuggestion("hello", "const x = ", "hello world")).toBe(true)
			expect(refuseUselessSuggestion("const", "", "const y = 2")).toBe(true)

			// With whitespace variations
			expect(refuseUselessSuggestion("test", "const x = ", "  test()")).toBe(true)
			expect(refuseUselessSuggestion("foo", "", " foo bar")).toBe(true)

			// Trimmed match
			expect(refuseUselessSuggestion("bar", "const x = ", "  bar  baz")).toBe(true)
		})

		it("should refuse suggestions when trimmed version matches", () => {
			expect(refuseUselessSuggestion("  hello  ", "const x = ", "hello world")).toBe(true)
			expect(refuseUselessSuggestion("\nhello\t", "test hello", "")).toBe(true)
		})
	})

	describe("should accept useful suggestions", () => {
		it("should accept suggestions that add new content", () => {
			expect(refuseUselessSuggestion("newValue", "const x = ", "")).toBe(false)
			expect(refuseUselessSuggestion("42", "const x = ", " + y")).toBe(false)
			expect(refuseUselessSuggestion("middle", "const x = ", " + y")).toBe(false)
		})

		it("should accept suggestions that don't match prefix end or suffix start", () => {
			expect(refuseUselessSuggestion("hello", "const x = ", "world")).toBe(false)
			expect(refuseUselessSuggestion("test", "const x = ", "const y = 2")).toBe(false)
			expect(refuseUselessSuggestion("foo", "bar", "baz")).toBe(false)
		})

		it("should accept partial matches that are still useful", () => {
			// Suggestion contains but doesn't exactly match
			expect(refuseUselessSuggestion("hello world", "const x = hello", "")).toBe(false)
			expect(refuseUselessSuggestion("test123", "test", "456")).toBe(false)
		})

		it("should accept suggestions with meaningful content between prefix and suffix", () => {
			expect(refuseUselessSuggestion("= 42", "const x ", " + y")).toBe(false)
			expect(refuseUselessSuggestion("()", "myFunction", ".then()")).toBe(false)
		})
	})

	describe("edge cases", () => {
		it("should handle empty prefix and suffix", () => {
			expect(refuseUselessSuggestion("hello", "", "")).toBe(false)
			expect(refuseUselessSuggestion("", "", "")).toBe(true)
		})

		it("should handle very long strings", () => {
			const longString = "a".repeat(1000)
			expect(refuseUselessSuggestion("different", longString, longString)).toBe(false)
			expect(refuseUselessSuggestion("different", longString + "different", "")).toBe(true)
		})

		it("should handle special characters", () => {
			expect(refuseUselessSuggestion("${}", "const template = `", "${}`")).toBe(true)
			expect(refuseUselessSuggestion("\\n", "const x = ", "\\n")).toBe(true)
			expect(refuseUselessSuggestion("/**/", "const x = /**/", "")).toBe(true)
		})

		it("should handle unicode characters", () => {
			expect(refuseUselessSuggestion("😀", "const emoji = ", "😀")).toBe(true)
			expect(refuseUselessSuggestion("你好", "const greeting = 你好", "")).toBe(true)
			expect(refuseUselessSuggestion("🚀", "launch", "🌟")).toBe(false)
		})
	})
})

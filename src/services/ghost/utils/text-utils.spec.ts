import {
	lineIsRepeated,
	linesMatchPerfectly,
	linesMatch,
	longestCommonSubsequence,
	matchLine,
	isOnlyWhitespace,
	isBlank,
	isExtremeRepetition,
	containsRepetitivePhrase,
	removePrefixOverlap,
	rewritesLineAbove,
	removeBackticks,
} from "./text-utils"

describe("text-utils", () => {
	describe("lineIsRepeated", () => {
		it("returns true for similar lines", () => {
			expect(lineIsRepeated("const x = 5;", "const x = 6;")).toBe(true)
		})

		it("returns false for different lines", () => {
			expect(lineIsRepeated("const x = 5;", "let y = 10;")).toBe(false)
		})

		it("returns false for short lines", () => {
			expect(lineIsRepeated("x=5", "x=6")).toBe(false)
		})

		it("returns false when either line is too short", () => {
			expect(lineIsRepeated("ab", "const x = 5;")).toBe(false)
			expect(lineIsRepeated("const x = 5;", "ab")).toBe(false)
		})
	})

	describe("linesMatchPerfectly", () => {
		it("returns true for exact matches", () => {
			expect(linesMatchPerfectly("hello world", "hello world")).toBe(true)
		})

		it("returns false for different lines", () => {
			expect(linesMatchPerfectly("hello", "world")).toBe(false)
		})

		it("returns false for empty lines", () => {
			expect(linesMatchPerfectly("", "")).toBe(false)
		})
	})

	describe("linesMatch", () => {
		it("returns true for exact trimmed matches", () => {
			expect(linesMatch("  hello world  ", "hello world")).toBe(true)
		})

		it("returns true for similar lines within threshold", () => {
			expect(linesMatch("const x = 5;", "const x = 6;")).toBe(true)
		})

		it("returns false for very different lines", () => {
			expect(linesMatch("const x = 5;", "function foo() {}")).toBe(false)
		})

		it("requires exact match for bracket-only lines", () => {
			expect(linesMatch("}", "}")).toBe(true)
			expect(linesMatch("}", "{")).toBe(false)
		})

		it("returns false for empty lines", () => {
			expect(linesMatch("", "")).toBe(false)
			expect(linesMatch("   ", "   ")).toBe(false)
		})
	})

	describe("longestCommonSubsequence", () => {
		it("finds common subsequence", () => {
			expect(longestCommonSubsequence("ABCD", "ACDF")).toBe("ACD")
		})

		it("returns empty string for no common chars", () => {
			expect(longestCommonSubsequence("ABC", "XYZ")).toBe("")
		})

		it("handles empty strings", () => {
			expect(longestCommonSubsequence("", "ABC")).toBe("")
			expect(longestCommonSubsequence("ABC", "")).toBe("")
		})
	})

	describe("matchLine", () => {
		it("matches empty lines only if next", () => {
			const result = matchLine("", ["", "hello"])
			expect(result.matchIndex).toBe(0)
			expect(result.isPerfectMatch).toBe(true)
		})

		it("finds perfect match", () => {
			const result = matchLine("hello", ["world", "hello", "foo"])
			expect(result.matchIndex).toBe(1)
			expect(result.isPerfectMatch).toBe(true)
		})

		it("returns -1 for no match", () => {
			const result = matchLine("hello", ["world", "foo", "bar"])
			expect(result.matchIndex).toBe(-1)
		})

		it("does not match end brackets too far away", () => {
			const result = matchLine("}", ["a", "b", "c", "d", "e", "}"])
			expect(result.matchIndex).toBe(-1)
		})
	})

	describe("isOnlyWhitespace", () => {
		it("returns true for whitespace only", () => {
			expect(isOnlyWhitespace("   ")).toBe(true)
			expect(isOnlyWhitespace("\t\n")).toBe(true)
		})

		it("returns false for non-whitespace", () => {
			expect(isOnlyWhitespace("hello")).toBe(false)
			expect(isOnlyWhitespace(" hello ")).toBe(false)
		})

		it("returns false for empty string", () => {
			expect(isOnlyWhitespace("")).toBe(false)
		})
	})

	describe("isBlank", () => {
		it("returns true for empty string", () => {
			expect(isBlank("")).toBe(true)
		})

		it("returns true for whitespace only", () => {
			expect(isBlank("   ")).toBe(true)
			expect(isBlank("\t\n")).toBe(true)
		})

		it("returns false for non-blank", () => {
			expect(isBlank("hello")).toBe(false)
		})
	})

	describe("isExtremeRepetition", () => {
		it("returns false for short completions", () => {
			expect(isExtremeRepetition("hello\nworld")).toBe(false)
		})

		it("detects extreme repetition", () => {
			const repeated = Array(10).fill("const x = 5;").join("\n")
			expect(isExtremeRepetition(repeated)).toBe(true)
		})

		it("returns false for varied content", () => {
			const varied = [
				"function foo() {",
				"  const x = 1;",
				"  const y = 2;",
				"  return x + y;",
				"}",
				"function bar() {",
				"  return 42;",
			].join("\n")
			expect(isExtremeRepetition(varied)).toBe(false)
		})
	})

	describe("containsRepetitivePhrase", () => {
		it("returns false for short suggestions", () => {
			expect(containsRepetitivePhrase("hello world")).toBe(false)
		})

		it("detects repetitive phrases", () => {
			const phrase = "We are going to start from the beginning. "
			const repetitive = phrase.repeat(5)
			expect(containsRepetitivePhrase(repetitive)).toBe(true)
		})

		it("returns false for non-repetitive text", () => {
			const text =
				"This is a long piece of text that does not repeat itself and contains various different words and phrases throughout."
			expect(containsRepetitivePhrase(text)).toBe(false)
		})
	})

	describe("removePrefixOverlap", () => {
		it("removes overlapping prefix", () => {
			expect(removePrefixOverlap("world hello", "hello world")).toBe(" hello")
		})

		it("removes last word overlap", () => {
			expect(removePrefixOverlap("world!", "hello world")).toBe("!")
		})

		it("returns unchanged if no overlap", () => {
			expect(removePrefixOverlap("foo", "bar")).toBe("foo")
		})
	})

	describe("rewritesLineAbove", () => {
		it("returns true when first line repeats last prefix line", () => {
			expect(rewritesLineAbove("const x = 5;", "function foo() {\nconst x = 6;")).toBe(true)
		})

		it("returns false for different lines", () => {
			expect(rewritesLineAbove("let y = 10;", "function foo() {\nconst x = 5;")).toBe(false)
		})

		it("returns false for empty prefix", () => {
			expect(rewritesLineAbove("hello", "")).toBe(false)
		})

		it("returns false for empty completion", () => {
			expect(rewritesLineAbove("", "hello")).toBe(false)
		})
	})

	describe("removeBackticks", () => {
		it("removes markdown code block delimiters", () => {
			expect(removeBackticks("```javascript\nconst x = 5;\n```")).toBe("const x = 5;")
		})

		it("removes only opening backticks", () => {
			expect(removeBackticks("```\nconst x = 5;")).toBe("const x = 5;")
		})

		it("removes only closing backticks", () => {
			expect(removeBackticks("const x = 5;\n```")).toBe("const x = 5;")
		})

		it("returns unchanged if no backticks", () => {
			expect(removeBackticks("const x = 5;")).toBe("const x = 5;")
		})

		it("handles empty string", () => {
			expect(removeBackticks("")).toBe("")
		})
	})
})

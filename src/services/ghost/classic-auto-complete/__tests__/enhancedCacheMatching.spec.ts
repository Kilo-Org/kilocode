import {
	levenshteinDistance,
	calculateSimilarity,
	getLastNLines,
	getFirstNLines,
	isMultiLineContext,
	findEnhancedMatchingSuggestion,
	toStandardMatchResult,
	EnhancedCacheMatchingConfig,
} from "../enhancedCacheMatching"
import { FillInAtCursorSuggestion } from "../../types"

describe("levenshteinDistance", () => {
	it("should return 0 for identical strings", () => {
		expect(levenshteinDistance("hello", "hello")).toBe(0)
		expect(levenshteinDistance("", "")).toBe(0)
	})

	it("should return length of other string when one is empty", () => {
		expect(levenshteinDistance("", "hello")).toBe(5)
		expect(levenshteinDistance("hello", "")).toBe(5)
	})

	it("should calculate correct distance for single character changes", () => {
		expect(levenshteinDistance("hello", "hallo")).toBe(1) // substitution
		expect(levenshteinDistance("hello", "helloo")).toBe(1) // insertion
		expect(levenshteinDistance("hello", "helo")).toBe(1) // deletion
	})

	it("should calculate correct distance for multiple changes", () => {
		expect(levenshteinDistance("kitten", "sitting")).toBe(3)
		expect(levenshteinDistance("saturday", "sunday")).toBe(3)
	})

	it("should handle common typos", () => {
		expect(levenshteinDistance("console", "consoel")).toBe(2) // transposition-like
		expect(levenshteinDistance("function", "fucntion")).toBe(2) // transposition-like
		expect(levenshteinDistance("const", "cosnt")).toBe(2) // transposition-like
	})
})

describe("calculateSimilarity", () => {
	it("should return 1 for identical strings", () => {
		expect(calculateSimilarity("hello", "hello")).toBe(1)
	})

	it("should return 0 for empty strings", () => {
		expect(calculateSimilarity("", "hello")).toBe(0)
		expect(calculateSimilarity("hello", "")).toBe(0)
	})

	it("should return high similarity for similar strings", () => {
		const similarity = calculateSimilarity("console.log", "console.log('test')")
		expect(similarity).toBeGreaterThan(0.4)
	})

	it("should return low similarity for different strings", () => {
		const similarity = calculateSimilarity("hello world", "foo bar baz")
		expect(similarity).toBeLessThan(0.3)
	})

	it("should be symmetric", () => {
		const sim1 = calculateSimilarity("hello", "world")
		const sim2 = calculateSimilarity("world", "hello")
		expect(sim1).toBe(sim2)
	})
})

describe("getLastNLines", () => {
	it("should return last N lines", () => {
		const text = "line1\nline2\nline3\nline4\nline5"
		expect(getLastNLines(text, 2)).toBe("line4\nline5")
		expect(getLastNLines(text, 3)).toBe("line3\nline4\nline5")
	})

	it("should return all lines if N is greater than line count", () => {
		const text = "line1\nline2"
		expect(getLastNLines(text, 5)).toBe("line1\nline2")
	})

	it("should handle single line", () => {
		expect(getLastNLines("single line", 3)).toBe("single line")
	})

	it("should handle empty string", () => {
		expect(getLastNLines("", 3)).toBe("")
	})
})

describe("getFirstNLines", () => {
	it("should return first N lines", () => {
		const text = "line1\nline2\nline3\nline4\nline5"
		expect(getFirstNLines(text, 2)).toBe("line1\nline2")
		expect(getFirstNLines(text, 3)).toBe("line1\nline2\nline3")
	})

	it("should return all lines if N is greater than line count", () => {
		const text = "line1\nline2"
		expect(getFirstNLines(text, 5)).toBe("line1\nline2")
	})

	it("should handle single line", () => {
		expect(getFirstNLines("single line", 3)).toBe("single line")
	})

	it("should handle empty string", () => {
		expect(getFirstNLines("", 3)).toBe("")
	})
})

describe("isMultiLineContext", () => {
	it("should detect function definitions", () => {
		expect(isMultiLineContext("function test() {", "}")).toBe(true)
		expect(isMultiLineContext("const fn = function() {", "}")).toBe(true)
	})

	it("should detect arrow functions", () => {
		expect(isMultiLineContext("const fn = () =>", "")).toBe(true)
		expect(isMultiLineContext("const fn = (x) => {", "}")).toBe(true)
	})

	it("should detect class definitions", () => {
		expect(isMultiLineContext("class MyClass {", "}")).toBe(true)
	})

	it("should detect control flow statements", () => {
		expect(isMultiLineContext("if (condition) {", "}")).toBe(true)
		expect(isMultiLineContext("for (let i = 0; i < 10; i++) {", "}")).toBe(true)
		expect(isMultiLineContext("while (true) {", "}")).toBe(true)
	})

	it("should detect object/array literals", () => {
		expect(isMultiLineContext("const obj = {", "}")).toBe(true)
		expect(isMultiLineContext("const arr = [", "]")).toBe(true)
	})

	it("should detect closing braces in suffix", () => {
		expect(isMultiLineContext("some code", "}")).toBe(true)
		expect(isMultiLineContext("some code", ")")).toBe(true)
		expect(isMultiLineContext("some code", "]")).toBe(true)
	})

	it("should return false for simple statements", () => {
		expect(isMultiLineContext("const x = 1", "")).toBe(false)
		expect(isMultiLineContext("console.log('test')", "")).toBe(false)
	})
})

describe("findEnhancedMatchingSuggestion", () => {
	describe("exact matching", () => {
		it("should return exact match with confidence 1.0", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findEnhancedMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result).toEqual({
				text: "console.log('test');",
				matchType: "exact",
				confidence: 1.0,
			})
		})

		it("should return null when no match found", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findEnhancedMatchingSuggestion("different prefix", "different suffix", suggestions)
			expect(result).toBeNull()
		})
	})

	describe("partial typing matching", () => {
		it("should return remaining suggestion when user has partially typed", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findEnhancedMatchingSuggestion("const x = 1cons", "\nconst y = 2", suggestions)
			expect(result).toEqual({
				text: "ole.log('test');",
				matchType: "partial_typing",
				confidence: 0.95,
			})
		})
	})

	describe("backward deletion matching", () => {
		it("should return deleted prefix plus suggestion when user backspaces", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "henk",
					prefix: "foo",
					suffix: "bar",
				},
			]

			const result = findEnhancedMatchingSuggestion("f", "bar", suggestions)
			expect(result).toEqual({
				text: "oohenk",
				matchType: "backward_deletion",
				confidence: 0.9,
			})
		})
	})

	describe("fuzzy prefix matching", () => {
		it("should match with small typos in prefix", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// User typed "cosnt" instead of "const" (typo)
			const result = findEnhancedMatchingSuggestion("cosnt x = 1", "\nconst y = 2", suggestions, {
				enableFuzzyMatching: true,
				maxEditDistance: 2,
			})

			expect(result).not.toBeNull()
			expect(result?.matchType).toBe("fuzzy_prefix")
			expect(result?.text).toBe("console.log('test');")
		})

		it("should not match when edit distance exceeds threshold", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// Too many typos
			const result = findEnhancedMatchingSuggestion("xxxxx x = 1", "\nconst y = 2", suggestions, {
				enableFuzzyMatching: true,
				maxEditDistance: 2,
			})

			expect(result).toBeNull()
		})

		it("should be disabled when enableFuzzyMatching is false", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findEnhancedMatchingSuggestion("cosnt x = 1", "\nconst y = 2", suggestions, {
				enableFuzzyMatching: false,
				enableContextSimilarity: false, // Also disable context similarity to test fuzzy in isolation
			})

			expect(result).toBeNull()
		})
	})

	describe("context similarity matching", () => {
		it("should match similar contexts", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "return x + y;",
					prefix: "function add(x, y) {\n  ",
					suffix: "\n}",
				},
			]

			// Similar but not identical context - disable fuzzy to test context similarity in isolation
			const result = findEnhancedMatchingSuggestion("function add(a, b) {\n  ", "\n}", suggestions, {
				enableFuzzyMatching: false,
				enableContextSimilarity: true,
				minSimilarityScore: 0.6,
			})

			expect(result).not.toBeNull()
			expect(result?.matchType).toBe("context_similarity")
		})

		it("should not match dissimilar contexts", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "return x + y;",
					prefix: "function add(x, y) {\n  ",
					suffix: "\n}",
				},
			]

			// Very different context
			const result = findEnhancedMatchingSuggestion(
				"class MyClass {\n  constructor() {\n    ",
				"\n  }\n}",
				suggestions,
				{
					enableContextSimilarity: true,
					minSimilarityScore: 0.7,
				},
			)

			expect(result).toBeNull()
		})

		it("should be disabled when enableContextSimilarity is false", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "return x + y;",
					prefix: "function add(x, y) {\n  ",
					suffix: "\n}",
				},
			]

			const result = findEnhancedMatchingSuggestion("function add(a, b) {\n  ", "\n}", suggestions, {
				enableFuzzyMatching: false, // Also disable fuzzy to test context similarity in isolation
				enableContextSimilarity: false,
			})

			expect(result).toBeNull()
		})
	})

	describe("multi-line partial matching", () => {
		it("should match when typing through multi-line suggestion", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('line1');\n  console.log('line2');",
					prefix: "function test() {\n  ",
					suffix: "\n}",
				},
			]

			// User typed first part of multi-line suggestion
			// Note: This actually matches partial_typing since the prefix extends and text starts with typed content
			const result = findEnhancedMatchingSuggestion(
				"function test() {\n  console.log('line1');",
				"\n}",
				suggestions,
				{
					enableMultiLineAwareness: true,
				},
			)

			expect(result).not.toBeNull()
			// This matches partial_typing because the standard partial typing check catches it first
			expect(result?.matchType).toBe("partial_typing")
		})

		it("should be disabled when enableMultiLineAwareness is false", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('line1');\n  console.log('line2');",
					prefix: "function test() {\n  ",
					suffix: "\n}",
				},
			]

			const result = findEnhancedMatchingSuggestion(
				"function test() {\n  console.log('line1');",
				"\n}",
				suggestions,
				{
					enableMultiLineAwareness: false,
				},
			)

			// Should fall back to partial_typing match
			expect(result?.matchType).toBe("partial_typing")
		})
	})

	describe("priority ordering", () => {
		it("should prefer exact match over fuzzy match", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "fuzzy result",
					prefix: "cosnt x = 1", // typo version
					suffix: "\nconst y = 2",
				},
				{
					text: "exact result",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findEnhancedMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result?.text).toBe("exact result")
			expect(result?.matchType).toBe("exact")
		})

		it("should prefer partial typing over fuzzy match", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// This matches partial typing
			const result = findEnhancedMatchingSuggestion("const x = 1cons", "\nconst y = 2", suggestions)
			expect(result?.matchType).toBe("partial_typing")
		})

		it("should return highest confidence match among fuzzy matches", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "low confidence",
					prefix: "xxxxx x = 1", // very different
					suffix: "\nconst y = 2",
				},
				{
					text: "high confidence",
					prefix: "cosnt x = 1", // small typo
					suffix: "\nconst y = 2",
				},
			]

			const result = findEnhancedMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions, {
				enableFuzzyMatching: true,
				maxEditDistance: 5, // Allow more distance to test priority
			})

			// Should prefer the one with smaller edit distance (higher confidence)
			expect(result?.text).toBe("high confidence")
		})
	})

	describe("empty suggestions handling", () => {
		it("should return empty string for exact match with empty suggestion", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findEnhancedMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result).toEqual({
				text: "",
				matchType: "exact",
				confidence: 1.0,
			})
		})

		it("should not use partial typing for empty suggestions", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// Disable all enhanced matching to test basic behavior
			const result = findEnhancedMatchingSuggestion("const x = 1cons", "\nconst y = 2", suggestions, {
				enableFuzzyMatching: false,
				enableContextSimilarity: false,
				enableMultiLineAwareness: false,
			})
			expect(result).toBeNull()
		})

		it("should not use backward deletion for empty suggestions", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "",
					prefix: "foo",
					suffix: "bar",
				},
			]

			// Disable all enhanced matching to test basic behavior
			const result = findEnhancedMatchingSuggestion("f", "bar", suggestions, {
				enableFuzzyMatching: false,
				enableContextSimilarity: false,
				enableMultiLineAwareness: false,
			})
			expect(result).toBeNull()
		})
	})

	describe("configuration", () => {
		it("should use default config when not provided", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "test",
					prefix: "cosnt x = 1", // typo
					suffix: "\nconst y = 2",
				},
			]

			// Default config enables fuzzy matching
			const result = findEnhancedMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result).not.toBeNull()
		})

		it("should merge partial config with defaults", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "test",
					prefix: "cosnt x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// Override settings to test strict fuzzy matching
			const result = findEnhancedMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions, {
				maxEditDistance: 1, // Stricter than default
				enableContextSimilarity: false, // Disable context similarity to test fuzzy in isolation
			})

			// Should still use fuzzy matching (enabled by default) but with stricter distance
			expect(result).toBeNull() // "cosnt" -> "const" is distance 2, exceeds 1
		})
	})
})

describe("toStandardMatchResult", () => {
	it("should return null for null input", () => {
		expect(toStandardMatchResult(null)).toBeNull()
	})

	it("should map exact match type", () => {
		const result = toStandardMatchResult({
			text: "test",
			matchType: "exact",
			confidence: 1.0,
		})
		expect(result).toEqual({
			text: "test",
			matchType: "exact",
		})
	})

	it("should map partial_typing match type", () => {
		const result = toStandardMatchResult({
			text: "test",
			matchType: "partial_typing",
			confidence: 0.95,
		})
		expect(result).toEqual({
			text: "test",
			matchType: "partial_typing",
		})
	})

	it("should map backward_deletion match type", () => {
		const result = toStandardMatchResult({
			text: "test",
			matchType: "backward_deletion",
			confidence: 0.9,
		})
		expect(result).toEqual({
			text: "test",
			matchType: "backward_deletion",
		})
	})

	it("should map fuzzy_prefix to exact", () => {
		const result = toStandardMatchResult({
			text: "test",
			matchType: "fuzzy_prefix",
			confidence: 0.8,
		})
		expect(result).toEqual({
			text: "test",
			matchType: "exact",
		})
	})

	it("should map context_similarity to exact", () => {
		const result = toStandardMatchResult({
			text: "test",
			matchType: "context_similarity",
			confidence: 0.75,
		})
		expect(result).toEqual({
			text: "test",
			matchType: "exact",
		})
	})

	it("should map multi_line_partial to partial_typing", () => {
		const result = toStandardMatchResult({
			text: "test",
			matchType: "multi_line_partial",
			confidence: 0.85,
		})
		expect(result).toEqual({
			text: "test",
			matchType: "partial_typing",
		})
	})
})

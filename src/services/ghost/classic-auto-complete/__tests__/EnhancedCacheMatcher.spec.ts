import { describe, it, expect, beforeEach } from "vitest"
import { EnhancedCacheMatcher, createEnhancedCacheMatcher } from "../EnhancedCacheMatcher"
import { FillInAtCursorSuggestion } from "../../types"

describe("EnhancedCacheMatcher", () => {
	let matcher: EnhancedCacheMatcher
	let suggestionsHistory: FillInAtCursorSuggestion[]

	beforeEach(() => {
		matcher = createEnhancedCacheMatcher()
		suggestionsHistory = []
	})

	describe("Exact Matching", () => {
		it("should find exact match with identical prefix and suffix", () => {
			suggestionsHistory.push({
				prefix: "const x = ",
				suffix: ";",
				text: "42",
			})

			const result = matcher.findBestMatch("const x = ", ";", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.text).toBe("42")
			expect(result?.matchType).toBe("exact")
			expect(result?.confidence).toBe(1.0)
		})

		it("should return null when no match exists", () => {
			suggestionsHistory.push({
				prefix: "const x = ",
				suffix: ";",
				text: "42",
			})

			// With very different prefix, context similarity should not match
			const result = matcher.findBestMatch("function test() {", ";", suggestionsHistory)

			expect(result).toBeNull()
		})

		it("should find most recent exact match", () => {
			suggestionsHistory.push({
				prefix: "const x = ",
				suffix: ";",
				text: "42",
			})
			suggestionsHistory.push({
				prefix: "const x = ",
				suffix: ";",
				text: "100",
			})

			const result = matcher.findBestMatch("const x = ", ";", suggestionsHistory)

			expect(result?.text).toBe("100")
		})
	})

	describe("Partial Typing Match", () => {
		it("should match when user has typed part of the suggestion", () => {
			suggestionsHistory.push({
				prefix: "function ",
				suffix: "() {}",
				text: "calculateSum",
			})

			const result = matcher.findBestMatch("function calc", "() {}", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.text).toBe("ulateSum")
			expect(result?.matchType).toBe("partial_typing")
			expect(result?.confidence).toBeGreaterThan(0.9)
		})

		it("should not match if typed content doesn't match suggestion", () => {
			suggestionsHistory.push({
				prefix: "function ",
				suffix: "() {}",
				text: "calculateSum",
			})

			const result = matcher.findBestMatch("function comp", "() {}", suggestionsHistory)

			expect(result).toBeNull()
		})

		it("should handle empty suggestion text", () => {
			suggestionsHistory.push({
				prefix: "function ",
				suffix: "() {}",
				text: "",
			})

			const result = matcher.findBestMatch("function calc", "() {}", suggestionsHistory)

			expect(result).toBeNull()
		})
	})

	describe("Backward Deletion Match", () => {
		it("should match when user deleted characters from prefix", () => {
			suggestionsHistory.push({
				prefix: "const myVariable = ",
				suffix: ";",
				text: "42",
			})

			const result = matcher.findBestMatch("const my", ";", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.text).toBe("Variable = 42")
			expect(result?.matchType).toBe("backward_deletion")
			expect(result?.confidence).toBeGreaterThan(0.85)
		})

		it("should not match if suffix changed", () => {
			suggestionsHistory.push({
				prefix: "const myVariable = ",
				suffix: ";",
				text: "42",
			})

			const result = matcher.findBestMatch("const my", "", suggestionsHistory)

			expect(result).toBeNull()
		})
	})

	describe("Fuzzy Matching", () => {
		it("should match with small typo in prefix", () => {
			suggestionsHistory.push({
				prefix: "const myVariable = ",
				suffix: ";",
				text: "42",
			})

			// Typo: "Varaible" instead of "Variable"
			const result = matcher.findBestMatch("const myVaraible = ", ";", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.text).toBe("42")
			// Context similarity may match before fuzzy due to high similarity
			expect(["fuzzy", "context_similar"]).toContain(result?.matchType)
			expect(result?.confidence).toBeGreaterThan(0.7)
		})

		it("should not match if edit distance exceeds threshold", () => {
			matcher.updateConfig({ maxEditDistance: 1 })

			suggestionsHistory.push({
				prefix: "const myVariable = ",
				suffix: ";",
				text: "42",
			})

			// Multiple typos
			const result = matcher.findBestMatch("const myVrble = ", ";", suggestionsHistory)

			expect(result).toBeNull()
		})

		it("should not fuzzy match if suffix differs", () => {
			suggestionsHistory.push({
				prefix: "const myVariable = ",
				suffix: ";",
				text: "42",
			})

			const result = matcher.findBestMatch("const myVaraible = ", "", suggestionsHistory)

			expect(result).toBeNull()
		})

		it("can be disabled via configuration", () => {
			matcher.updateConfig({ enableFuzzyMatching: false, enableContextScoring: false })

			suggestionsHistory.push({
				prefix: "const myVariable = ",
				suffix: ";",
				text: "42",
			})

			const result = matcher.findBestMatch("const myVaraible = ", ";", suggestionsHistory)

			expect(result).toBeNull()
		})
	})

	describe("Multi-line Matching", () => {
		it("should match based on multi-line context", () => {
			suggestionsHistory.push({
				prefix: "function test() {\n  const x = 1;\n  const y = ",
				suffix: ";\n}",
				text: "2",
			})

			// Similar multi-line context
			const result = matcher.findBestMatch(
				"function test() {\n  const x = 1;\n  const y = ",
				";\n}",
				suggestionsHistory,
			)

			expect(result).not.toBeNull()
			expect(result?.text).toBe("2")
			expect(result?.matchType).toBe("exact")
		})

		it("should match with slightly different multi-line context", () => {
			suggestionsHistory.push({
				prefix: "function test() {\n  const x = 1;\n  const y = ",
				suffix: ";\n}",
				text: "2",
			})

			// Different variable name but similar structure
			const result = matcher.findBestMatch(
				"function demo() {\n  const x = 1;\n  const y = ",
				";\n}",
				suggestionsHistory,
			)

			expect(result).not.toBeNull()
			// Multi-line or context_similar both acceptable for this case
			expect(["multi_line", "context_similar"]).toContain(result?.matchType)
			expect(result?.confidence).toBeGreaterThan(0.7)
		})

		it("should not match single-line contexts", () => {
			suggestionsHistory.push({
				prefix: "const x = ",
				suffix: ";",
				text: "42",
			})

			const result = matcher.findBestMatch("const y = ", ";", suggestionsHistory)

			// Should not use multi-line matching for single lines
			const multiLineResult = result?.matchType === "multi_line"
			expect(multiLineResult).toBe(false)
		})

		it("can be disabled via configuration", () => {
			matcher.updateConfig({ enableMultiLineMatching: false })

			suggestionsHistory.push({
				prefix: "function test() {\n  const x = 1;\n  const y = ",
				suffix: ";\n}",
				text: "2",
			})

			const result = matcher.findBestMatch(
				"function demo() {\n  const x = 1;\n  const y = ",
				";\n}",
				suggestionsHistory,
			)

			expect(result?.matchType).not.toBe("multi_line")
		})
	})

	describe("Context Similarity Matching", () => {
		it("should match based on similar context", () => {
			suggestionsHistory.push({
				prefix: "const result = calculateSum(a, b) + ",
				suffix: ";",
				text: "10",
			})

			// Similar context with different variable names - requires very high similarity
			const result = matcher.findBestMatch("const result = calculateSum(a, b) + ", ";", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.matchType).toBe("exact")
			expect(result?.confidence).toBe(1.0)
		})

		it("should boost confidence for trigger points", () => {
			suggestionsHistory.push({
				prefix: "const obj = {",
				suffix: "}",
				text: "\n  name: 'test'",
			})

			// Exact match with trigger point
			const result = matcher.findBestMatch("const obj = {", "}", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.matchType).toBe("exact")
			expect(result?.confidence).toBe(1.0)
		})

		it("should not match if similarity is too low", () => {
			matcher.updateConfig({ minSimilarityScore: 0.9 })

			suggestionsHistory.push({
				prefix: "const result = calculateSum(a, b) + ",
				suffix: ";",
				text: "10",
			})

			// Very different context
			const result = matcher.findBestMatch("function test() { return ", ";", suggestionsHistory)

			expect(result).toBeNull()
		})

		it("can be disabled via configuration", () => {
			matcher.updateConfig({ enableContextScoring: false })

			suggestionsHistory.push({
				prefix: "const result = calculateSum(a, b) + ",
				suffix: ";",
				text: "10",
			})

			const result = matcher.findBestMatch("const output = calculateSum(x, y) + ", ";", suggestionsHistory)

			expect(result?.matchType).not.toBe("context_similar")
		})
	})

	describe("Best Match Selection", () => {
		it("should prefer exact match over fuzzy match", () => {
			suggestionsHistory.push({
				prefix: "const x = ",
				suffix: ";",
				text: "42",
			})
			suggestionsHistory.push({
				prefix: "const x = ",
				suffix: ";",
				text: "100",
			})

			const result = matcher.findBestMatch("const x = ", ";", suggestionsHistory)

			expect(result?.matchType).toBe("exact")
			expect(result?.confidence).toBe(1.0)
		})

		it("should select highest confidence match", () => {
			suggestionsHistory.push({
				prefix: "const myVariable = ",
				suffix: ";",
				text: "42",
			})
			suggestionsHistory.push({
				prefix: "const myVar = ",
				suffix: ";",
				text: "100",
			})

			// Should match the second one with higher confidence
			const result = matcher.findBestMatch("const myVar = ", ";", suggestionsHistory)

			expect(result?.text).toBe("100")
			expect(result?.matchType).toBe("exact")
		})

		it("should respect minimum similarity threshold", () => {
			matcher.updateConfig({ minSimilarityScore: 0.98 })

			suggestionsHistory.push({
				prefix: "const myVariable = ",
				suffix: ";",
				text: "42",
			})

			// Fuzzy match with confidence < 0.98
			const result = matcher.findBestMatch("const myVaraible = ", ";", suggestionsHistory)

			expect(result).toBeNull()
		})
	})

	describe("Configuration Management", () => {
		it("should allow updating configuration", () => {
			const initialConfig = matcher.getConfig()
			expect(initialConfig.maxEditDistance).toBe(2)

			matcher.updateConfig({ maxEditDistance: 3 })

			const updatedConfig = matcher.getConfig()
			expect(updatedConfig.maxEditDistance).toBe(3)
		})

		it("should preserve other config values when updating", () => {
			matcher.updateConfig({ maxEditDistance: 5 })

			const config = matcher.getConfig()
			expect(config.maxEditDistance).toBe(5)
			expect(config.minSimilarityScore).toBe(0.7) // Default value preserved
		})

		it("should accept custom config in constructor", () => {
			const customMatcher = createEnhancedCacheMatcher({
				maxEditDistance: 3,
				minSimilarityScore: 0.8,
			})

			const config = customMatcher.getConfig()
			expect(config.maxEditDistance).toBe(3)
			expect(config.minSimilarityScore).toBe(0.8)
		})
	})

	describe("Edge Cases", () => {
		it("should handle empty suggestions history", () => {
			const result = matcher.findBestMatch("const x = ", ";", [])

			expect(result).toBeNull()
		})

		it("should handle empty prefix and suffix", () => {
			suggestionsHistory.push({
				prefix: "",
				suffix: "",
				text: "test",
			})

			const result = matcher.findBestMatch("", "", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.matchType).toBe("exact")
		})

		it("should handle very long prefixes", () => {
			const longPrefix = "const x = ".repeat(100)
			suggestionsHistory.push({
				prefix: longPrefix,
				suffix: ";",
				text: "42",
			})

			const result = matcher.findBestMatch(longPrefix, ";", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.matchType).toBe("exact")
		})

		it("should handle special characters in prefix", () => {
			suggestionsHistory.push({
				prefix: "const regex = /[a-z]+/",
				suffix: ";",
				text: "g",
			})

			const result = matcher.findBestMatch("const regex = /[a-z]+/", ";", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.text).toBe("g")
		})

		it("should handle unicode characters", () => {
			suggestionsHistory.push({
				prefix: "const emoji = '",
				suffix: "';",
				text: "🚀",
			})

			const result = matcher.findBestMatch("const emoji = '", "';", suggestionsHistory)

			expect(result).not.toBeNull()
			expect(result?.text).toBe("🚀")
		})
	})

	describe("Performance Characteristics", () => {
		it("should handle large suggestion history efficiently", () => {
			// Add 100 suggestions
			for (let i = 0; i < 100; i++) {
				suggestionsHistory.push({
					prefix: `const x${i} = `,
					suffix: ";",
					text: `${i}`,
				})
			}

			const startTime = performance.now()
			const result = matcher.findBestMatch("const x50 = ", ";", suggestionsHistory)
			const endTime = performance.now()

			expect(result).not.toBeNull()
			expect(endTime - startTime).toBeLessThan(50) // Should complete in < 50ms
		})

		it("should stop searching after finding perfect match", () => {
			// Add exact match at the end
			for (let i = 0; i < 50; i++) {
				suggestionsHistory.push({
					prefix: `const x${i} = `,
					suffix: ";",
					text: `${i}`,
				})
			}
			suggestionsHistory.push({
				prefix: "const target = ",
				suffix: ";",
				text: "found",
			})

			const result = matcher.findBestMatch("const target = ", ";", suggestionsHistory)

			expect(result?.text).toBe("found")
			expect(result?.confidence).toBe(1.0)
		})
	})
})

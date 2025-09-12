import { describe, it, expect } from "vitest"
import { calculateDiff } from "../CharacterDiff"

describe("CharacterDiff", () => {
	describe("calculateDiff", () => {
		it("should handle simple addition", () => {
			const result = calculateDiff("abc", "abcd")
			expect(result).toEqual([
				{ start: 0, end: 3, type: "unchanged" },
				{ start: 3, end: 4, type: "added" },
			])
		})

		it("should handle variable name changes", () => {
			const result = calculateDiff("const userName = 'john'", "const fullName = 'john'")
			// Should preserve common parts and highlight the word change
			expect(result.some((r) => r.type === "unchanged")).toBe(true)
			expect(result.some((r) => r.type === "modified")).toBe(true)
		})

		it("should handle empty strings", () => {
			expect(calculateDiff("", "abc")).toEqual([{ start: 0, end: 3, type: "added" }])
			expect(calculateDiff("abc", "")).toEqual([])
			expect(calculateDiff("", "")).toEqual([])
		})

		it("should handle identical strings", () => {
			const result = calculateDiff("hello", "hello")
			expect(result).toEqual([{ start: 0, end: 5, type: "unchanged" }])
		})
	})
})

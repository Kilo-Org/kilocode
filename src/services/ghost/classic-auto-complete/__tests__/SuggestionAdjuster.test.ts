import { describe, it, expect } from "vitest"
import { SuggestionAdjuster } from "../SuggestionAdjuster"
import { FillInAtCursorSuggestion } from "../HoleFiller"

describe("SuggestionAdjuster", () => {
	describe("adjust", () => {
		it("should return suggestion text for exact match", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "function test() {}",
				prefix: "const x = ",
				suffix: "\nconst y = 2",
			}

			const result = SuggestionAdjuster.adjust(suggestion, "const x = ", "\nconst y = 2")

			expect(result).toBe("function test() {}")
		})

		it("should return null when prefix does not match", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "function test() {}",
				prefix: "const x = ",
				suffix: "\nconst y = 2",
			}

			const result = SuggestionAdjuster.adjust(suggestion, "const z = ", "\nconst y = 2")

			expect(result).toBeNull()
		})

		it("should return null when suffix does not match", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "function test() {}",
				prefix: "const x = ",
				suffix: "\nconst y = 2",
			}

			const result = SuggestionAdjuster.adjust(suggestion, "const x = ", "\nconst z = 3")

			expect(result).toBeNull()
		})

		it("should adjust suggestion when user types ahead", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "function test() {}",
				prefix: "const x = ",
				suffix: "\nconst y = 2",
			}

			// User typed "fun" ahead
			const result = SuggestionAdjuster.adjust(suggestion, "const x = fun", "\nconst y = 2")

			expect(result).toBe("ction test() {}")
		})

		it("should return null when typed ahead text does not match suggestion", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "function test() {}",
				prefix: "const x = ",
				suffix: "\nconst y = 2",
			}

			// User typed "class" which doesn't match "function"
			const result = SuggestionAdjuster.adjust(suggestion, "const x = class", "\nconst y = 2")

			expect(result).toBeNull()
		})

		it("should return empty string when user types entire suggestion", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "test",
				prefix: "const x = ",
				suffix: "",
			}

			// User typed the entire suggestion
			const result = SuggestionAdjuster.adjust(suggestion, "const x = test", "")

			expect(result).toBe("")
		})

		it("should return null for empty suggestion text when typing ahead", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "",
				prefix: "const x = ",
				suffix: "",
			}

			const result = SuggestionAdjuster.adjust(suggestion, "const x = f", "")

			expect(result).toBeNull()
		})

		it("should return empty string for exact match with empty suggestion", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "",
				prefix: "const x = ",
				suffix: "",
			}

			const result = SuggestionAdjuster.adjust(suggestion, "const x = ", "")

			expect(result).toBe("")
		})
	})

	describe("adjustSuggestion", () => {
		it("should return adjusted suggestion with updated prefix/suffix", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "function test() {}",
				prefix: "const x = ",
				suffix: "\nconst y = 2",
			}

			const result = SuggestionAdjuster.adjustSuggestion(suggestion, "const x = fun", "\nconst y = 2")

			expect(result).toEqual({
				text: "ction test() {}",
				prefix: "const x = fun",
				suffix: "\nconst y = 2",
			})
		})

		it("should return null when no match", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "function test() {}",
				prefix: "const x = ",
				suffix: "\nconst y = 2",
			}

			const result = SuggestionAdjuster.adjustSuggestion(suggestion, "const z = ", "\nconst y = 2")

			expect(result).toBeNull()
		})

		it("should return exact match with same prefix/suffix", () => {
			const suggestion: FillInAtCursorSuggestion = {
				text: "function test() {}",
				prefix: "const x = ",
				suffix: "\nconst y = 2",
			}

			const result = SuggestionAdjuster.adjustSuggestion(suggestion, "const x = ", "\nconst y = 2")

			expect(result).toEqual({
				text: "function test() {}",
				prefix: "const x = ",
				suffix: "\nconst y = 2",
			})
		})
	})

	describe("findInHistory", () => {
		it("should find exact match in history", () => {
			const history: FillInAtCursorSuggestion[] = [
				{ text: "old suggestion", prefix: "old ", suffix: "" },
				{ text: "function test() {}", prefix: "const x = ", suffix: "\nconst y = 2" },
			]

			const result = SuggestionAdjuster.findInHistory("const x = ", "\nconst y = 2", history)

			expect(result).toBe("function test() {}")
		})

		it("should return most recent match when multiple matches exist", () => {
			const history: FillInAtCursorSuggestion[] = [
				{ text: "old function", prefix: "const x = ", suffix: "\nconst y = 2" },
				{ text: "new function", prefix: "const x = ", suffix: "\nconst y = 2" },
			]

			const result = SuggestionAdjuster.findInHistory("const x = ", "\nconst y = 2", history)

			expect(result).toBe("new function")
		})

		it("should find and adjust typed-ahead match in history", () => {
			const history: FillInAtCursorSuggestion[] = [
				{ text: "function test() {}", prefix: "const x = ", suffix: "\nconst y = 2" },
			]

			const result = SuggestionAdjuster.findInHistory("const x = fun", "\nconst y = 2", history)

			expect(result).toBe("ction test() {}")
		})

		it("should return null when no match in history", () => {
			const history: FillInAtCursorSuggestion[] = [
				{ text: "function test() {}", prefix: "const x = ", suffix: "\nconst y = 2" },
			]

			const result = SuggestionAdjuster.findInHistory("const z = ", "\nconst y = 2", history)

			expect(result).toBeNull()
		})

		it("should return null for empty history", () => {
			const result = SuggestionAdjuster.findInHistory("const x = ", "\nconst y = 2", [])

			expect(result).toBeNull()
		})

		it("should skip non-matching entries and find match", () => {
			const history: FillInAtCursorSuggestion[] = [
				{ text: "match", prefix: "const x = ", suffix: "" },
				{ text: "no match", prefix: "different ", suffix: "" },
				{ text: "also no match", prefix: "another ", suffix: "" },
			]

			const result = SuggestionAdjuster.findInHistory("const x = ", "", history)

			expect(result).toBe("match")
		})
	})
})

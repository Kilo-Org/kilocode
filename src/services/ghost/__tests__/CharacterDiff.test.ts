import { describe, it, expect } from "vitest"
import { calculateCharacterDiff } from "../utils/CharacterDiff"

describe("calculateCharacterDiff", () => {
	it("should handle simple character replacement", () => {
		const result = calculateCharacterDiff("const x = 1", "const y = 2")

		expect(result).toEqual([
			{ start: 0, end: 6, type: "unchanged" }, // "const "
			{ start: 6, end: 11, type: "modified" }, // "x = 1" -> "y = 2"
		])
	})

	it("should handle text addition", () => {
		const result = calculateCharacterDiff("hello", "hello world")

		expect(result).toEqual([
			{ start: 0, end: 5, type: "unchanged" }, // "hello"
			{ start: 5, end: 11, type: "modified" }, // "" -> " world"
		])
	})

	it("should handle function name change", () => {
		const result = calculateCharacterDiff("function foo()", "function bar()")

		expect(result).toEqual([
			{ start: 0, end: 9, type: "unchanged" }, // "function "
			{ start: 9, end: 12, type: "modified" }, // "foo" -> "bar"
			{ start: 12, end: 14, type: "unchanged" }, // "()"
		])
	})

	it("should handle function name insertion", () => {
		const result = calculateCharacterDiff("function multiply(a, b) {", "function multiplyNumbers(a, b) {")

		expect(result).toEqual([
			{ start: 0, end: 17, type: "unchanged" }, // "function multiply"
			{ start: 17, end: 24, type: "modified" }, // "" -> "Numbers"
			{ start: 24, end: 32, type: "unchanged" }, // "(a, b) {"
		])
	})

	it("should handle identical strings", () => {
		const result = calculateCharacterDiff("hello", "hello")

		expect(result).toEqual([
			{ start: 0, end: 5, type: "unchanged" }, // "hello"
		])
	})

	it("should handle empty to text", () => {
		const result = calculateCharacterDiff("", "hello")

		expect(result).toEqual([
			{ start: 0, end: 5, type: "modified" }, // "" -> "hello"
		])
	})
})

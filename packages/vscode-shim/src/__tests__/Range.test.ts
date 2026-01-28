import { Range } from "../classes/Range.js"
import { Position } from "../classes/Position.js"

describe("Range", () => {
	describe("constructor", () => {
		it("should create range from Position objects", () => {
			const start = new Position(0, 0)
			const end = new Position(5, 10)
			const range = new Range(start, end)

			expect(range.start.line).toBe(0)
			expect(range.start.character).toBe(0)
			expect(range.end.line).toBe(5)
			expect(range.end.character).toBe(10)
		})

		it("should create range from numbers", () => {
			const range = new Range(0, 0, 5, 10)

			expect(range.start.line).toBe(0)
			expect(range.start.character).toBe(0)
			expect(range.end.line).toBe(5)
			expect(range.end.character).toBe(10)
		})
	})

	describe("isEmpty", () => {
		it("should return true for empty range", () => {
			const range = new Range(5, 10, 5, 10)
			expect(range.isEmpty).toBe(true)
		})

		it("should return false for non-empty range", () => {
			const range = new Range(5, 10, 5, 15)
			expect(range.isEmpty).toBe(false)
		})
	})

	describe("isSingleLine", () => {
		it("should return true for single line range", () => {
			const range = new Range(5, 0, 5, 10)
			expect(range.isSingleLine).toBe(true)
		})

		it("should return false for multi-line range", () => {
			const range = new Range(5, 0, 6, 10)
			expect(range.isSingleLine).toBe(false)
		})
	})

	describe("contains()", () => {
		it("should return true when range contains position", () => {
			const range = new Range(0, 0, 10, 10)
			const pos = new Position(5, 5)
			expect(range.contains(pos)).toBe(true)
		})

		it("should return false when position is outside range", () => {
			const range = new Range(0, 0, 10, 10)
			const pos = new Position(15, 5)
			expect(range.contains(pos)).toBe(false)
		})

		it("should return true when range contains another range", () => {
			const outer = new Range(0, 0, 10, 10)
			const inner = new Range(2, 2, 8, 8)
			expect(outer.contains(inner)).toBe(true)
		})

		it("should return false when range does not contain another range", () => {
			const range1 = new Range(0, 0, 5, 10)
			const range2 = new Range(6, 0, 10, 10)
			expect(range1.contains(range2)).toBe(false)
		})
	})

	describe("isEqual()", () => {
		it("should return true for equal ranges", () => {
			const range1 = new Range(0, 0, 5, 10)
			const range2 = new Range(0, 0, 5, 10)
			expect(range1.isEqual(range2)).toBe(true)
		})

		it("should return false for different ranges", () => {
			const range1 = new Range(0, 0, 5, 10)
			const range2 = new Range(0, 0, 5, 11)
			expect(range1.isEqual(range2)).toBe(false)
		})
	})

	describe("intersection()", () => {
		it("should return intersection of overlapping ranges", () => {
			const range1 = new Range(0, 0, 10, 10)
			const range2 = new Range(5, 5, 15, 15)
			const intersection = range1.intersection(range2)

			expect(intersection).toBeDefined()
			expect(intersection!.start.line).toBe(5)
			expect(intersection!.start.character).toBe(5)
			expect(intersection!.end.line).toBe(10)
			expect(intersection!.end.character).toBe(10)
		})

		it("should return undefined for non-overlapping ranges", () => {
			const range1 = new Range(0, 0, 5, 10)
			const range2 = new Range(10, 0, 15, 10)
			const intersection = range1.intersection(range2)

			expect(intersection).toBeUndefined()
		})
	})

	describe("union()", () => {
		it("should return union of two ranges", () => {
			const range1 = new Range(0, 0, 5, 10)
			const range2 = new Range(3, 5, 8, 15)
			const union = range1.union(range2)

			expect(union.start.line).toBe(0)
			expect(union.start.character).toBe(0)
			expect(union.end.line).toBe(8)
			expect(union.end.character).toBe(15)
		})

		it("should handle non-overlapping ranges", () => {
			const range1 = new Range(0, 0, 2, 10)
			const range2 = new Range(5, 0, 8, 10)
			const union = range1.union(range2)

			expect(union.start.line).toBe(0)
			expect(union.end.line).toBe(8)
		})
	})

	describe("with()", () => {
		it("should create new range with modified start", () => {
			const range = new Range(0, 0, 5, 10)
			const modified = range.with(new Position(1, 0))

			expect(modified.start.line).toBe(1)
			expect(modified.end.line).toBe(5)
		})

		it("should create new range with change object", () => {
			const range = new Range(0, 0, 5, 10)
			const modified = range.with({ end: new Position(8, 15) })

			expect(modified.start.line).toBe(0)
			expect(modified.end.line).toBe(8)
			expect(modified.end.character).toBe(15)
		})
	})
})

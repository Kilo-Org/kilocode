import { Position } from "../classes/Position.js"

describe("Position", () => {
	describe("constructor", () => {
		it("should create a position with line and character", () => {
			const pos = new Position(5, 10)
			expect(pos.line).toBe(5)
			expect(pos.character).toBe(10)
		})

		it("should reject negative line numbers", () => {
			expect(() => new Position(-1, 0)).toThrow("Line number must be non-negative")
		})

		it("should reject negative character offsets", () => {
			expect(() => new Position(0, -1)).toThrow("Character offset must be non-negative")
		})
	})

	describe("isEqual()", () => {
		it("should return true for equal positions", () => {
			const pos1 = new Position(5, 10)
			const pos2 = new Position(5, 10)
			expect(pos1.isEqual(pos2)).toBe(true)
		})

		it("should return false for different positions", () => {
			const pos1 = new Position(5, 10)
			const pos2 = new Position(5, 11)
			expect(pos1.isEqual(pos2)).toBe(false)
		})
	})

	describe("isBefore()", () => {
		it("should return true when line is before", () => {
			const pos1 = new Position(3, 10)
			const pos2 = new Position(5, 5)
			expect(pos1.isBefore(pos2)).toBe(true)
		})

		it("should return true when same line but character before", () => {
			const pos1 = new Position(5, 8)
			const pos2 = new Position(5, 10)
			expect(pos1.isBefore(pos2)).toBe(true)
		})

		it("should return false when equal", () => {
			const pos1 = new Position(5, 10)
			const pos2 = new Position(5, 10)
			expect(pos1.isBefore(pos2)).toBe(false)
		})

		it("should return false when after", () => {
			const pos1 = new Position(6, 0)
			const pos2 = new Position(5, 10)
			expect(pos1.isBefore(pos2)).toBe(false)
		})
	})

	describe("isAfter()", () => {
		it("should return true when line is after", () => {
			const pos1 = new Position(5, 10)
			const pos2 = new Position(3, 10)
			expect(pos1.isAfter(pos2)).toBe(true)
		})

		it("should return false when equal", () => {
			const pos1 = new Position(5, 10)
			const pos2 = new Position(5, 10)
			expect(pos1.isAfter(pos2)).toBe(false)
		})
	})

	describe("compareTo()", () => {
		it("should return -1 when before", () => {
			const pos1 = new Position(3, 10)
			const pos2 = new Position(5, 10)
			expect(pos1.compareTo(pos2)).toBe(-1)
		})

		it("should return 0 when equal", () => {
			const pos1 = new Position(5, 10)
			const pos2 = new Position(5, 10)
			expect(pos1.compareTo(pos2)).toBe(0)
		})

		it("should return 1 when after", () => {
			const pos1 = new Position(7, 10)
			const pos2 = new Position(5, 10)
			expect(pos1.compareTo(pos2)).toBe(1)
		})
	})

	describe("translate()", () => {
		it("should translate by delta values", () => {
			const pos = new Position(5, 10)
			const translated = pos.translate(2, 3)
			expect(translated.line).toBe(7)
			expect(translated.character).toBe(13)
		})

		it("should translate by change object", () => {
			const pos = new Position(5, 10)
			const translated = pos.translate({ lineDelta: 1, characterDelta: -2 })
			expect(translated.line).toBe(6)
			expect(translated.character).toBe(8)
		})

		it("should handle omitted deltas as zero", () => {
			const pos = new Position(5, 10)
			const translated = pos.translate()
			expect(translated.line).toBe(5)
			expect(translated.character).toBe(10)
		})
	})

	describe("with()", () => {
		it("should create new position with changed line", () => {
			const pos = new Position(5, 10)
			const modified = pos.with(8)
			expect(modified.line).toBe(8)
			expect(modified.character).toBe(10)
		})

		it("should create new position with change object", () => {
			const pos = new Position(5, 10)
			const modified = pos.with({ line: 8, character: 15 })
			expect(modified.line).toBe(8)
			expect(modified.character).toBe(15)
		})

		it("should preserve unchanged properties", () => {
			const pos = new Position(5, 10)
			const modified = pos.with({ line: 8 })
			expect(modified.line).toBe(8)
			expect(modified.character).toBe(10)
		})
	})
})

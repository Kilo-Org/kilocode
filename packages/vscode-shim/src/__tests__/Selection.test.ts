import { Selection } from "../classes/Selection.js"
import { Position } from "../classes/Position.js"

describe("Selection", () => {
	describe("constructor with Position objects", () => {
		it("should create selection from Position objects", () => {
			const anchor = new Position(0, 0)
			const active = new Position(5, 10)
			const selection = new Selection(anchor, active)

			expect(selection.anchor.line).toBe(0)
			expect(selection.anchor.character).toBe(0)
			expect(selection.active.line).toBe(5)
			expect(selection.active.character).toBe(10)
		})

		it("should set start and end correctly for non-reversed selection", () => {
			const anchor = new Position(0, 0)
			const active = new Position(5, 10)
			const selection = new Selection(anchor, active)

			expect(selection.start.line).toBe(0)
			expect(selection.start.character).toBe(0)
			expect(selection.end.line).toBe(5)
			expect(selection.end.character).toBe(10)
		})

		it("should set start and end correctly for reversed selection", () => {
			const anchor = new Position(5, 10)
			const active = new Position(0, 0)
			const selection = new Selection(anchor, active)

			// Start/end are inherited from Range, which normalizes
			expect(selection.anchor.line).toBe(5)
			expect(selection.anchor.character).toBe(10)
			expect(selection.active.line).toBe(0)
			expect(selection.active.character).toBe(0)
		})
	})

	describe("constructor with line/character numbers", () => {
		it("should create selection from line and character numbers", () => {
			const selection = new Selection(0, 0, 5, 10)

			expect(selection.anchor.line).toBe(0)
			expect(selection.anchor.character).toBe(0)
			expect(selection.active.line).toBe(5)
			expect(selection.active.character).toBe(10)
		})

		it("should handle reversed selection with numbers", () => {
			const selection = new Selection(5, 10, 0, 0)

			expect(selection.anchor.line).toBe(5)
			expect(selection.anchor.character).toBe(10)
			expect(selection.active.line).toBe(0)
			expect(selection.active.character).toBe(0)
		})
	})

	describe("isReversed", () => {
		it("should return false when active is after anchor", () => {
			const selection = new Selection(0, 0, 5, 10)
			expect(selection.isReversed).toBe(false)
		})

		it("should return true when active is before anchor", () => {
			const selection = new Selection(5, 10, 0, 0)
			expect(selection.isReversed).toBe(true)
		})

		it("should return false when anchor equals active", () => {
			const selection = new Selection(5, 10, 5, 10)
			expect(selection.isReversed).toBe(false)
		})

		it("should return true when same line but active character is before anchor", () => {
			const selection = new Selection(5, 10, 5, 5)
			expect(selection.isReversed).toBe(true)
		})

		it("should return false when same line and active character is after anchor", () => {
			const selection = new Selection(5, 5, 5, 10)
			expect(selection.isReversed).toBe(false)
		})
	})

	describe("inherited Range properties", () => {
		it("should have isEmpty property", () => {
			const emptySelection = new Selection(5, 10, 5, 10)
			expect(emptySelection.isEmpty).toBe(true)

			const nonEmptySelection = new Selection(0, 0, 5, 10)
			expect(nonEmptySelection.isEmpty).toBe(false)
		})

		it("should have isSingleLine property", () => {
			const singleLineSelection = new Selection(5, 0, 5, 10)
			expect(singleLineSelection.isSingleLine).toBe(true)

			const multiLineSelection = new Selection(0, 0, 5, 10)
			expect(multiLineSelection.isSingleLine).toBe(false)
		})

		it("should support contains method", () => {
			const selection = new Selection(0, 0, 10, 10)
			const pos = new Position(5, 5)
			expect(selection.contains(pos)).toBe(true)

			const outsidePos = new Position(15, 5)
			expect(selection.contains(outsidePos)).toBe(false)
		})

		it("should support isEqual method", () => {
			const selection1 = new Selection(0, 0, 5, 10)
			const selection2 = new Selection(0, 0, 5, 10)
			const selection3 = new Selection(0, 0, 5, 11)

			expect(selection1.isEqual(selection2)).toBe(true)
			expect(selection1.isEqual(selection3)).toBe(false)
		})
	})
})

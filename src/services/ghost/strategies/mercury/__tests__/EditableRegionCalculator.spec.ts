import { describe, it, expect } from "vitest"
import { EditableRegionCalculator } from "../EditableRegionCalculator"
import { parseContentWithCursor } from "./testUtils"

describe("EditableRegionCalculator", () => {
	let calculator: EditableRegionCalculator

	beforeEach(() => {
		calculator = new EditableRegionCalculator()
	})

	describe("calculateEditableRegion", () => {
		it("should expand around cursor with high token limit", () => {
			const contentWithCursor = `line 0
line 1
line 2 - cu␣rsor here
line 3
line 4`

			const { document, cursorRange } = parseContentWithCursor(contentWithCursor)
			const region = calculator.calculateEditableRegion(document, cursorRange, 100)

			expect(region).toMatchSnapshot()
		})

		it("should respect low token limits", () => {
			const contentWithCursor = `line 0
line 1
line 2 - cu␣rsor here
line 3
line 4`

			const { document, cursorRange } = parseContentWithCursor(contentWithCursor)
			const region = calculator.calculateEditableRegion(document, cursorRange, 10)

			expect(region).toMatchSnapshot()
		})

		it("should handle single line file", () => {
			const contentWithCursor = `only li␣ne`

			const { document, cursorRange } = parseContentWithCursor(contentWithCursor)
			const region = calculator.calculateEditableRegion(document, cursorRange, 100)

			expect(region).toMatchSnapshot()
		})
	})

	describe("extractEditableContent", () => {
		it("should extract multi-line region content", () => {
			const { document } = parseContentWithCursor(`line 0
line ␣1
line 2
line 3
line 4`)

			const region = { editableStart: 1, editableEnd: 3, totalLines: 5, tokensUsed: 50 }
			const extracted = calculator.extractEditableContent(document, region)

			expect(extracted).toMatchSnapshot()
		})

		it("should extract single line region content", () => {
			const { document } = parseContentWithCursor(`line 0
target line with ␣special chars & symbols
line 2`)

			const region = { editableStart: 1, editableEnd: 1, totalLines: 3, tokensUsed: 20 }
			const extracted = calculator.extractEditableContent(document, region)

			expect(extracted).toMatchSnapshot()
		})
	})
})

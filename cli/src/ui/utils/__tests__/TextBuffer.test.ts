/**
 * Tests for TextBuffer utility class
 */

import { describe, it, expect, beforeEach } from "vitest"
import { TextBuffer } from "../textBuffer.js"

describe("TextBuffer", () => {
	let buffer: TextBuffer

	beforeEach(() => {
		buffer = new TextBuffer()
	})

	describe("initialization", () => {
		it("should initialize with empty text", () => {
			expect(buffer.text).toBe("")
			expect(buffer.lines).toEqual([""])
			expect(buffer.cursor).toEqual({ row: 0, column: 0 })
		})

		it("should initialize with provided text", () => {
			const text = "Hello\nWorld"
			buffer = new TextBuffer(text)
			expect(buffer.text).toBe(text)
			expect(buffer.lines).toEqual(["Hello", "World"])
			expect(buffer.cursor).toEqual({ row: 1, column: 5 }) // End of text
		})
	})

	describe("text manipulation", () => {
		it("should insert single character", () => {
			buffer.insertChar("H")
			expect(buffer.text).toBe("H")
			expect(buffer.cursor).toEqual({ row: 0, column: 1 })
		})

		it("should insert text at cursor position", () => {
			buffer.setText("Hello World")
			buffer.moveTo(0, 5)
			buffer.insertText(" Beautiful")
			expect(buffer.text).toBe("Hello Beautiful World")
		})

		it("should handle multiline text insertion", () => {
			buffer.setText("Start")
			buffer.moveTo(0, 5)
			buffer.insertText("\nMiddle\nEnd")
			expect(buffer.lines).toEqual(["Start", "Middle", "End"])
			expect(buffer.cursor).toEqual({ row: 2, column: 3 })
		})

		it("should insert newline", () => {
			buffer.setText("HelloWorld")
			buffer.moveTo(0, 5)
			buffer.insertNewline()
			expect(buffer.lines).toEqual(["Hello", "World"])
			expect(buffer.cursor).toEqual({ row: 1, column: 0 })
		})

		it("should handle backspace at beginning of line", () => {
			buffer.setText("Line1\nLine2")
			buffer.moveTo(1, 0)
			buffer.backspace()
			expect(buffer.text).toBe("Line1Line2")
			expect(buffer.cursor).toEqual({ row: 0, column: 5 })
		})

		it("should handle backspace in middle of line", () => {
			buffer.setText("Hello")
			buffer.moveTo(0, 3)
			buffer.backspace()
			expect(buffer.text).toBe("Helo")
			expect(buffer.cursor).toEqual({ row: 0, column: 2 })
		})

		it("should handle delete character", () => {
			buffer.setText("Hello")
			buffer.moveTo(0, 2)
			buffer.deleteChar()
			expect(buffer.text).toBe("Helo")
			expect(buffer.cursor).toEqual({ row: 0, column: 2 })
		})

		it("should delete word backward", () => {
			buffer.setText("Hello World")
			buffer.moveToEnd()
			buffer.deleteWord()
			expect(buffer.text).toBe("Hello ")
		})

		it("should kill line from cursor", () => {
			buffer.setText("Hello World")
			buffer.moveTo(0, 5)
			buffer.killLine()
			expect(buffer.text).toBe("Hello")
		})

		it("should kill line to cursor", () => {
			buffer.setText("Hello World")
			buffer.moveTo(0, 6)
			buffer.killLineLeft()
			expect(buffer.text).toBe("World")
			expect(buffer.cursor).toEqual({ row: 0, column: 0 })
		})
	})

	describe("cursor movement", () => {
		beforeEach(() => {
			buffer.setText("Line1\nLine2\nLine3")
		})

		it("should move up", () => {
			buffer.moveTo(1, 2)
			const moved = buffer.moveUp()
			expect(moved).toBe(true)
			expect(buffer.cursor).toEqual({ row: 0, column: 2 })
		})

		it("should not move up from first line", () => {
			buffer.moveTo(0, 0)
			const moved = buffer.moveUp()
			expect(moved).toBe(false)
			expect(buffer.cursor).toEqual({ row: 0, column: 0 })
		})

		it("should move down", () => {
			buffer.moveTo(0, 2)
			const moved = buffer.moveDown()
			expect(moved).toBe(true)
			expect(buffer.cursor).toEqual({ row: 1, column: 2 })
		})

		it("should not move down from last line", () => {
			buffer.moveTo(2, 0)
			const moved = buffer.moveDown()
			expect(moved).toBe(false)
			expect(buffer.cursor).toEqual({ row: 2, column: 0 })
		})

		it("should move left within line", () => {
			buffer.moveTo(0, 3)
			const moved = buffer.moveLeft()
			expect(moved).toBe(true)
			expect(buffer.cursor).toEqual({ row: 0, column: 2 })
		})

		it("should move left to previous line", () => {
			buffer.moveTo(1, 0)
			const moved = buffer.moveLeft()
			expect(moved).toBe(true)
			expect(buffer.cursor).toEqual({ row: 0, column: 5 })
		})

		it("should move right within line", () => {
			buffer.moveTo(0, 2)
			const moved = buffer.moveRight()
			expect(moved).toBe(true)
			expect(buffer.cursor).toEqual({ row: 0, column: 3 })
		})

		it("should move right to next line", () => {
			buffer.moveTo(0, 5)
			const moved = buffer.moveRight()
			expect(moved).toBe(true)
			expect(buffer.cursor).toEqual({ row: 1, column: 0 })
		})

		it("should move to line start", () => {
			buffer.moveTo(1, 3)
			buffer.moveToLineStart()
			expect(buffer.cursor).toEqual({ row: 1, column: 0 })
		})

		it("should move to line end", () => {
			buffer.moveTo(1, 0)
			buffer.moveToLineEnd()
			expect(buffer.cursor).toEqual({ row: 1, column: 5 })
		})

		it("should move to document start", () => {
			buffer.moveTo(2, 3)
			buffer.moveToStart()
			expect(buffer.cursor).toEqual({ row: 0, column: 0 })
		})

		it("should move to document end", () => {
			buffer.moveTo(0, 0)
			buffer.moveToEnd()
			expect(buffer.cursor).toEqual({ row: 2, column: 5 })
		})
	})

	describe("visual lines and wrapping", () => {
		it("should wrap long lines", () => {
			buffer.setText("This is a very long line that should be wrapped")
			const visualLines = buffer.getVisualLines(10)
			expect(visualLines.length).toBeGreaterThan(1)
			expect(visualLines[0].text).toBe("This is a ")
			expect(visualLines[1].text).toBe("very long ")
		})

		it("should handle empty lines", () => {
			buffer.setText("Line1\n\nLine3")
			const visualLines = buffer.getVisualLines(20)
			expect(visualLines.length).toBe(3)
			expect(visualLines[1].text).toBe("")
		})

		it("should calculate visual cursor position", () => {
			buffer.setText("This is a very long line")
			buffer.moveTo(0, 15) // Position after "very "
			const visualCursor = buffer.getVisualCursor(10)
			expect(visualCursor.row).toBe(1) // Second visual line
			expect(visualCursor.column).toBe(5) // Position 5 in second line
		})

		it("should limit visual lines when maxLines is specified", () => {
			buffer.setText("Line1\nLine2\nLine3\nLine4\nLine5")
			const visualLines = buffer.getVisualLines(20, 3)
			expect(visualLines.length).toBe(3)
		})
	})

	describe("viewport management", () => {
		beforeEach(() => {
			buffer.setText("Line1\nLine2\nLine3\nLine4\nLine5\nLine6")
		})

		it("should get viewport with cursor in view", () => {
			buffer.moveTo(1, 2)
			const viewport = buffer.getViewport(10, 3, 0)
			expect(viewport.lines.length).toBe(3)
			expect(viewport.cursorInViewport).toEqual({ row: 1, column: 2 })
		})

		it("should return null cursor when out of viewport", () => {
			buffer.moveTo(5, 0)
			const viewport = buffer.getViewport(10, 3, 0)
			expect(viewport.cursorInViewport).toBeNull()
		})

		it("should calculate scroll to keep cursor in view", () => {
			buffer.moveTo(4, 0)
			const scroll = buffer.getScrollToCursor(10, 3, 0)
			expect(scroll).toBe(2) // Scroll down to show line 4
		})

		it("should not scroll if cursor is already in view", () => {
			buffer.moveTo(1, 0)
			const scroll = buffer.getScrollToCursor(10, 3, 0)
			expect(scroll).toBe(0)
		})
	})

	describe("edge cases", () => {
		it("should handle empty buffer operations", () => {
			expect(buffer.isEmpty).toBe(true)
			buffer.backspace()
			expect(buffer.text).toBe("")
			buffer.deleteChar()
			expect(buffer.text).toBe("")
		})

		it("should handle setting empty text", () => {
			buffer.setText("Hello")
			buffer.setText("")
			expect(buffer.lines).toEqual([""])
			expect(buffer.cursor).toEqual({ row: 0, column: 0 })
		})

		it("should clear buffer", () => {
			buffer.setText("Hello\nWorld")
			buffer.clear()
			expect(buffer.text).toBe("")
			expect(buffer.cursor).toEqual({ row: 0, column: 0 })
		})

		it("should handle cursor position clamping", () => {
			buffer.setText("Short")
			buffer.moveTo(10, 10)
			expect(buffer.cursor.row).toBe(0)
			expect(buffer.cursor.column).toBeLessThanOrEqual(5)
		})
	})
})

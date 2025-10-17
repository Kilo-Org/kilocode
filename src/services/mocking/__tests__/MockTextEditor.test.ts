import { describe, it, expect } from "vitest"
import { MockTextEditor } from "../MockTextEditor"

describe("MockTextEditor", () => {
	it("should correctly parse cursor position from marker", () => {
		const editor = MockTextEditor.create(`function test() {\n    ␣return true\n}`)

		// Test selection property
		expect(editor.selection.active.line).toBe(1)
		expect(editor.selection.active.character).toBe(4)
		expect(editor.selection.anchor.line).toBe(1)
		expect(editor.selection.anchor.character).toBe(4)

		// Verify the cursor marker was removed from the document
		const documentText = editor.document.getText()
		expect(documentText).toBe("function test() {\n    return true\n}")
		expect(documentText).not.toContain("␣")
	})

	it("should handle cursor at start of document", () => {
		const editor = MockTextEditor.create(`␣const x = 1`)

		expect(editor.selection.active.line).toBe(0)
		expect(editor.selection.active.character).toBe(0)
		expect(editor.document.getText()).toBe("const x = 1")
	})

	it("should handle cursor at end of document", () => {
		const editor = MockTextEditor.create(`const x = 1␣`)

		expect(editor.selection.active.line).toBe(0)
		expect(editor.selection.active.character).toBe(11)
		expect(editor.document.getText()).toBe("const x = 1")
	})

	it("should handle cursor in middle of line", () => {
		const editor = MockTextEditor.create(`const ␣x = 1`)

		expect(editor.selection.active.line).toBe(0)
		expect(editor.selection.active.character).toBe(6)
		expect(editor.document.getText()).toBe("const x = 1")
	})

	it("should default to position (0,0) when cursor marker is missing", () => {
		const editor = MockTextEditor.create("const x = 1")

		// Test selection property
		expect(editor.selection.active.line).toBe(0)
		expect(editor.selection.active.character).toBe(0)
		expect(editor.selection.anchor.line).toBe(0)
		expect(editor.selection.anchor.character).toBe(0)

		// Verify document content is unchanged
		expect(editor.document.getText()).toBe("const x = 1")
	})

	it("should provide access to document line information", () => {
		const editor = MockTextEditor.create(`function test() {\n    ␣return true\n}`)

		const line = editor.document.lineAt(editor.selection.active.line)
		expect(line.text).toBe("    return true")
		expect(line.lineNumber).toBe(1)
	})
})

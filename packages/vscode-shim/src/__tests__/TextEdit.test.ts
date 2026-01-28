import { TextEdit, WorkspaceEdit } from "../classes/TextEdit.js"
import { Position } from "../classes/Position.js"
import { Range } from "../classes/Range.js"
import { Uri } from "../classes/Uri.js"

describe("TextEdit", () => {
	describe("constructor", () => {
		it("should create a TextEdit with range and newText", () => {
			const range = new Range(0, 0, 0, 5)
			const edit = new TextEdit(range, "hello")

			expect(edit.range.start.line).toBe(0)
			expect(edit.range.start.character).toBe(0)
			expect(edit.range.end.line).toBe(0)
			expect(edit.range.end.character).toBe(5)
			expect(edit.newText).toBe("hello")
		})
	})

	describe("replace()", () => {
		it("should create a replace edit", () => {
			const range = new Range(1, 0, 1, 10)
			const edit = TextEdit.replace(range, "replacement")

			expect(edit.range.isEqual(range)).toBe(true)
			expect(edit.newText).toBe("replacement")
		})

		it("should handle multi-line ranges", () => {
			const range = new Range(0, 0, 5, 10)
			const edit = TextEdit.replace(range, "new content")

			expect(edit.range.start.line).toBe(0)
			expect(edit.range.end.line).toBe(5)
			expect(edit.newText).toBe("new content")
		})
	})

	describe("insert()", () => {
		it("should create an insert edit at position", () => {
			const position = new Position(5, 10)
			const edit = TextEdit.insert(position, "inserted text")

			expect(edit.range.start.line).toBe(5)
			expect(edit.range.start.character).toBe(10)
			expect(edit.range.end.line).toBe(5)
			expect(edit.range.end.character).toBe(10)
			expect(edit.range.isEmpty).toBe(true)
			expect(edit.newText).toBe("inserted text")
		})

		it("should handle insert at beginning of file", () => {
			const position = new Position(0, 0)
			const edit = TextEdit.insert(position, "prefix")

			expect(edit.range.start.isEqual(position)).toBe(true)
			expect(edit.newText).toBe("prefix")
		})
	})

	describe("delete()", () => {
		it("should create a delete edit", () => {
			const range = new Range(0, 5, 0, 10)
			const edit = TextEdit.delete(range)

			expect(edit.range.isEqual(range)).toBe(true)
			expect(edit.newText).toBe("")
		})

		it("should handle multi-line deletion", () => {
			const range = new Range(0, 0, 5, 0)
			const edit = TextEdit.delete(range)

			expect(edit.range.start.line).toBe(0)
			expect(edit.range.end.line).toBe(5)
			expect(edit.newText).toBe("")
		})
	})

	describe("setEndOfLine()", () => {
		it("should create a setEndOfLine edit", () => {
			const edit = TextEdit.setEndOfLine()

			expect(edit.range.start.line).toBe(0)
			expect(edit.range.start.character).toBe(0)
			expect(edit.newText).toBe("")
		})
	})
})

describe("WorkspaceEdit", () => {
	describe("set() and get()", () => {
		it("should set and get edits for a URI", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/path/to/file.txt")
			const edits = [
				TextEdit.replace(new Range(0, 0, 0, 5), "hello"),
				TextEdit.insert(new Position(1, 0), "world"),
			]

			workspaceEdit.set(uri, edits)
			const retrieved = workspaceEdit.get(uri)

			expect(retrieved).toHaveLength(2)
			expect(retrieved[0]?.newText).toBe("hello")
			expect(retrieved[1]?.newText).toBe("world")
		})

		it("should return empty array for unknown URI", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/nonexistent.txt")

			expect(workspaceEdit.get(uri)).toEqual([])
		})

		it("should overwrite edits when setting same URI", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/path/to/file.txt")

			workspaceEdit.set(uri, [TextEdit.insert(new Position(0, 0), "first")])
			workspaceEdit.set(uri, [TextEdit.insert(new Position(0, 0), "second")])

			const edits = workspaceEdit.get(uri)
			expect(edits).toHaveLength(1)
			expect(edits[0]?.newText).toBe("second")
		})
	})

	describe("has()", () => {
		it("should return true when URI has edits", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/path/to/file.txt")

			workspaceEdit.set(uri, [TextEdit.insert(new Position(0, 0), "text")])

			expect(workspaceEdit.has(uri)).toBe(true)
		})

		it("should return false when URI has no edits", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/path/to/file.txt")

			expect(workspaceEdit.has(uri)).toBe(false)
		})
	})

	describe("delete()", () => {
		it("should add a delete edit for URI", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/path/to/file.txt")
			const range = new Range(0, 5, 0, 10)

			workspaceEdit.delete(uri, range)

			const edits = workspaceEdit.get(uri)
			expect(edits).toHaveLength(1)
			expect(edits[0]?.newText).toBe("")
			expect(edits[0]?.range.start.character).toBe(5)
			expect(edits[0]?.range.end.character).toBe(10)
		})

		it("should append to existing edits", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/path/to/file.txt")

			workspaceEdit.insert(uri, new Position(0, 0), "text")
			workspaceEdit.delete(uri, new Range(1, 0, 1, 5))

			const edits = workspaceEdit.get(uri)
			expect(edits).toHaveLength(2)
		})
	})

	describe("insert()", () => {
		it("should add an insert edit for URI", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/path/to/file.txt")
			const position = new Position(5, 10)

			workspaceEdit.insert(uri, position, "inserted")

			const edits = workspaceEdit.get(uri)
			expect(edits).toHaveLength(1)
			expect(edits[0]?.newText).toBe("inserted")
			expect(edits[0]?.range.start.line).toBe(5)
			expect(edits[0]?.range.start.character).toBe(10)
		})
	})

	describe("replace()", () => {
		it("should add a replace edit for URI", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/path/to/file.txt")
			const range = new Range(0, 0, 0, 10)

			workspaceEdit.replace(uri, range, "replacement")

			const edits = workspaceEdit.get(uri)
			expect(edits).toHaveLength(1)
			expect(edits[0]?.newText).toBe("replacement")
			expect(edits[0]?.range.start.line).toBe(0)
			expect(edits[0]?.range.end.character).toBe(10)
		})
	})

	describe("size", () => {
		it("should return 0 for empty WorkspaceEdit", () => {
			const workspaceEdit = new WorkspaceEdit()
			expect(workspaceEdit.size).toBe(0)
		})

		it("should return number of documents with edits", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri1 = Uri.file("/path/to/file1.txt")
			const uri2 = Uri.file("/path/to/file2.txt")
			const uri3 = Uri.file("/path/to/file3.txt")

			workspaceEdit.insert(uri1, new Position(0, 0), "text1")
			workspaceEdit.insert(uri2, new Position(0, 0), "text2")
			workspaceEdit.insert(uri3, new Position(0, 0), "text3")

			expect(workspaceEdit.size).toBe(3)
		})

		it("should count same URI only once", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri = Uri.file("/path/to/file.txt")

			workspaceEdit.insert(uri, new Position(0, 0), "text1")
			workspaceEdit.insert(uri, new Position(1, 0), "text2")
			workspaceEdit.insert(uri, new Position(2, 0), "text3")

			expect(workspaceEdit.size).toBe(1)
		})
	})

	describe("entries()", () => {
		it("should return empty array for empty WorkspaceEdit", () => {
			const workspaceEdit = new WorkspaceEdit()
			expect(workspaceEdit.entries()).toEqual([])
		})

		it("should return all URI/edits pairs", () => {
			const workspaceEdit = new WorkspaceEdit()
			const uri1 = Uri.file("/path/to/file1.txt")
			const uri2 = Uri.file("/path/to/file2.txt")

			workspaceEdit.insert(uri1, new Position(0, 0), "text1")
			workspaceEdit.replace(uri2, new Range(0, 0, 0, 5), "text2")

			const entries = workspaceEdit.entries()
			expect(entries).toHaveLength(2)

			// Entries should have URI-like objects with toString and fsPath
			expect(typeof entries[0]?.[0]?.toString).toBe("function")
			expect(typeof entries[0]?.[0]?.fsPath).toBe("string")

			// Should contain the edits
			expect(entries.some((e) => e[1][0]?.newText === "text1")).toBe(true)
			expect(entries.some((e) => e[1][0]?.newText === "text2")).toBe(true)
		})
	})
})

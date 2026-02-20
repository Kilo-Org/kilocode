import { describe, it, expect, beforeEach } from "vitest"
import * as vscode from "vscode"
import { MockWorkspace } from "./MockWorkspace"
import { createMockWorkspaceEdit } from "./MockWorkspaceEdit"

// Mock VS Code API objects for test environment
export const mockVscode = {
	Uri: {
		parse: (uriString: string) =>
			({
				toString: () => uriString,
				fsPath: uriString.replace("file://", ""),
				scheme: "file",
				path: uriString.replace("file://", ""),
			}) as vscode.Uri,
	},
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {}
	} as any,
	Range: class {
		constructor(
			public start: vscode.Position,
			public end: vscode.Position,
		) {}
	} as any,
}

describe("MockWorkspace", () => {
	let mockWorkspace: MockWorkspace

	beforeEach(() => {
		mockWorkspace = new MockWorkspace()
	})

	describe("document management", () => {
		it("should add and retrieve documents", () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			const content = "console.log('Hello, World!')"

			const document = mockWorkspace.addDocument(uri, content)

			expect(document.getText()).toBe(content)
			expect(mockWorkspace.getDocumentContent(uri)).toBe(content)
		})

		it("should return empty string for non-existent document", () => {
			const uri = mockVscode.Uri.parse("file:///nonexistent.ts")

			expect(mockWorkspace.getDocumentContent(uri)).toBe("")
		})

		it("should throw error when opening non-existent document", async () => {
			const uri = mockVscode.Uri.parse("file:///nonexistent.ts")

			await expect(mockWorkspace.openTextDocument(uri)).rejects.toThrow(
				"Document not found: file:///nonexistent.ts",
			)
		})

		it("should open existing document", async () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			const content = "const x = 1"

			mockWorkspace.addDocument(uri, content)
			const document = await mockWorkspace.openTextDocument(uri)

			expect(document.getText()).toBe(content)
		})
	})

	describe("workspace edit application", () => {
		it("should apply insert operations", async () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			const originalContent = "Hello World"
			mockWorkspace.addDocument(uri, originalContent)

			const edit = createMockWorkspaceEdit()
			const position = new mockVscode.Position(0, 5)
			edit.insert(uri, position as vscode.Position, " Beautiful")

			const success = await mockWorkspace.applyEdit(edit)

			expect(success).toBe(true)
			expect(mockWorkspace.getDocumentContent(uri)).toBe("Hello Beautiful World")
		})

		it("should apply delete operations", async () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			const originalContent = "console.log('Hello')"
			mockWorkspace.addDocument(uri, originalContent)

			const edit = createMockWorkspaceEdit()
			const range = new mockVscode.Range(new mockVscode.Position(0, 12), new mockVscode.Position(0, 19))
			edit.delete(uri, range as vscode.Range)

			const success = await mockWorkspace.applyEdit(edit)

			expect(success).toBe(true)
			expect(mockWorkspace.getDocumentContent(uri)).toBe("console.log()")
		})

		it("should apply replace operations", async () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			const originalContent = "console.log('Hello, World!')"
			mockWorkspace.addDocument(uri, originalContent)

			const edit = createMockWorkspaceEdit()
			const range = new mockVscode.Range(new mockVscode.Position(0, 12), new mockVscode.Position(0, 27))
			edit.replace(uri, range as vscode.Range, "'Goodbye'")

			const success = await mockWorkspace.applyEdit(edit)

			expect(success).toBe(true)
			expect(mockWorkspace.getDocumentContent(uri)).toBe("console.log('Goodbye')")
		})

		it("should handle multi-line edits", async () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			const originalContent = "line1\nline2\nline3"
			mockWorkspace.addDocument(uri, originalContent)

			const edit = createMockWorkspaceEdit()
			const range = new mockVscode.Range(new mockVscode.Position(1, 0), new mockVscode.Position(1, 5))
			edit.replace(uri, range as vscode.Range, "modified_line2")

			const success = await mockWorkspace.applyEdit(edit)

			expect(success).toBe(true)
			expect(mockWorkspace.getDocumentContent(uri)).toBe("line1\nmodified_line2\nline3")
		})

		it("should handle multiple edits in correct order", async () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			const originalContent = "ABCDEF"
			mockWorkspace.addDocument(uri, originalContent)

			const edit = createMockWorkspaceEdit()
			// Insert at position 2 (after 'AB')
			edit.insert(uri, new mockVscode.Position(0, 2) as vscode.Position, "X")
			// Insert at position 3 (after 'ABC' in original)
			edit.insert(uri, new mockVscode.Position(0, 3) as vscode.Position, "Y")

			const success = await mockWorkspace.applyEdit(edit)

			expect(success).toBe(true)
			// The actual result shows that edits are applied in reverse order by character position
			// Position 3 edit (Y) is applied first: AB + Y + CDEF = ABYCDEF
			// Position 2 edit (X) is applied second: AB + X + YCDEF = ABXYCDEF
			expect(mockWorkspace.getDocumentContent(uri)).toBe("ABXCYDEF")
		})

		it("should return false for edits on non-existent documents", async () => {
			const uri = mockVscode.Uri.parse("file:///nonexistent.ts")
			const edit = createMockWorkspaceEdit()
			edit.insert(uri, new mockVscode.Position(0, 0) as vscode.Position, "test")

			const success = await mockWorkspace.applyEdit(edit)

			expect(success).toBe(false)
		})
	})

	describe("edit tracking", () => {
		it("should track applied edits", async () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			mockWorkspace.addDocument(uri, "original")

			const firstEdit = createMockWorkspaceEdit()
			firstEdit.insert(uri, new mockVscode.Position(0, 0) as vscode.Position, "prefix ")

			const secondEdit = createMockWorkspaceEdit()
			secondEdit.insert(uri, new mockVscode.Position(0, 8) as vscode.Position, " suffix")

			await mockWorkspace.applyEdit(firstEdit)
			await mockWorkspace.applyEdit(secondEdit)

			const appliedEdits = mockWorkspace.getAppliedEdits()
			expect(appliedEdits).toHaveLength(2)
		})

		it("should clear workspace state", async () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			mockWorkspace.addDocument(uri, "test")

			const edit = createMockWorkspaceEdit()
			edit.insert(uri, new mockVscode.Position(0, 0) as vscode.Position, "prefix ")

			await mockWorkspace.applyEdit(edit)
			expect(mockWorkspace.getAppliedEdits()).toHaveLength(1)

			mockWorkspace.clear()
			expect(mockWorkspace.getAppliedEdits()).toHaveLength(0)
		})
	})

	describe("edge cases", () => {
		it("should handle empty document edits", async () => {
			const uri = mockVscode.Uri.parse("file:///empty.ts")
			mockWorkspace.addDocument(uri, "")

			const edit = createMockWorkspaceEdit()
			edit.insert(uri, new mockVscode.Position(0, 0) as vscode.Position, "first line")

			const success = await mockWorkspace.applyEdit(edit)

			expect(success).toBe(true)
			expect(mockWorkspace.getDocumentContent(uri)).toBe("first line")
		})

		it("should handle edits at document boundaries", async () => {
			const uri = mockVscode.Uri.parse("file:///test.ts")
			const originalContent = "test"
			mockWorkspace.addDocument(uri, originalContent)

			const edit = createMockWorkspaceEdit()
			// Insert at the very end
			edit.insert(uri, new mockVscode.Position(0, 4) as vscode.Position, " end")

			const success = await mockWorkspace.applyEdit(edit)

			expect(success).toBe(true)
			expect(mockWorkspace.getDocumentContent(uri)).toBe("test end")
		})
	})
})

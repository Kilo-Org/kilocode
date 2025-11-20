import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createVSCodeAPIMock } from "../VSCode.js"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("WorkspaceAPI.applyEdit Document Synchronization", () => {
	let tempDir: string
	let vscodeAPI: ReturnType<typeof createVSCodeAPIMock>
	let testFilePath: string

	beforeEach(() => {
		// Create a temporary directory for testing
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kilocode-test-"))
		testFilePath = path.join(tempDir, "test.txt")

		// Create initial test file
		fs.writeFileSync(testFilePath, "line 1\nline 2\nline 3\n", "utf-8")

		// Create VSCode API mock
		vscodeAPI = createVSCodeAPIMock(tempDir, tempDir)
	})

	afterEach(() => {
		// Clean up temp directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it("should update document content after applyEdit", async () => {
		const { workspace, Uri, Range, Position } = vscodeAPI

		// Open the document
		const document = await workspace.openTextDocument(Uri.file(testFilePath))

		// Verify initial content
		expect(document.getText()).toBe("line 1\nline 2\nline 3\n")
		expect(document.lineCount).toBe(4) // 3 lines + empty line at end

		// Create an edit to replace line 2
		const edit = new vscodeAPI.WorkspaceEdit()
		edit.replace(Uri.file(testFilePath), new Range(new Position(1, 0), new Position(1, 6)), "modified line 2")

		// Apply the edit
		const success = await workspace.applyEdit(edit)
		expect(success).toBe(true)

		// Verify file was written to disk
		const fileContent = fs.readFileSync(testFilePath, "utf-8")
		expect(fileContent).toBe("line 1\nmodified line 2\nline 3\n")

		// CRITICAL: Verify document object was updated to match file content
		expect(document.getText()).toBe("line 1\nmodified line 2\nline 3\n")
		expect(document.lineCount).toBe(4)
		expect(document.lineAt(1).text).toBe("modified line 2")
	})

	it("should handle multiple sequential edits correctly", async () => {
		const { workspace, Uri, Range, Position } = vscodeAPI

		// Open the document
		const document = await workspace.openTextDocument(Uri.file(testFilePath))

		// First edit: replace line 1
		const edit1 = new vscodeAPI.WorkspaceEdit()
		edit1.replace(Uri.file(testFilePath), new Range(new Position(0, 0), new Position(0, 6)), "first edit")

		await workspace.applyEdit(edit1)

		// Verify document was updated
		expect(document.getText()).toBe("first edit\nline 2\nline 3\n")

		// Second edit: replace line 2
		const edit2 = new vscodeAPI.WorkspaceEdit()
		edit2.replace(Uri.file(testFilePath), new Range(new Position(1, 0), new Position(1, 6)), "second edit")

		await workspace.applyEdit(edit2)

		// Verify document was updated again
		expect(document.getText()).toBe("first edit\nsecond edit\nline 3\n")

		// Verify file matches document
		const fileContent = fs.readFileSync(testFilePath, "utf-8")
		expect(fileContent).toBe(document.getText())
	})

	it("should handle multi-line edits correctly", async () => {
		const { workspace, Uri, Range, Position } = vscodeAPI

		const document = await workspace.openTextDocument(Uri.file(testFilePath))

		// Replace lines 1-2 with a single line
		const edit = new vscodeAPI.WorkspaceEdit()
		edit.replace(
			Uri.file(testFilePath),
			new Range(new Position(0, 0), new Position(2, 0)),
			"single replacement line\n",
		)

		await workspace.applyEdit(edit)

		// Verify document was updated
		const expectedContent = "single replacement line\nline 3\n"
		expect(document.getText()).toBe(expectedContent)
		expect(document.lineCount).toBe(3)

		// Verify file matches
		const fileContent = fs.readFileSync(testFilePath, "utf-8")
		expect(fileContent).toBe(expectedContent)
	})

	it("should handle insert operations correctly", async () => {
		const { workspace, Uri, Position } = vscodeAPI

		const document = await workspace.openTextDocument(Uri.file(testFilePath))

		// Insert text at the beginning of line 2
		const edit = new vscodeAPI.WorkspaceEdit()
		edit.insert(Uri.file(testFilePath), new Position(1, 0), "INSERTED: ")

		await workspace.applyEdit(edit)

		// Verify document was updated
		expect(document.getText()).toBe("line 1\nINSERTED: line 2\nline 3\n")
		expect(document.lineAt(1).text).toBe("INSERTED: line 2")

		// Verify file matches
		const fileContent = fs.readFileSync(testFilePath, "utf-8")
		expect(fileContent).toBe(document.getText())
	})

	it("should handle delete operations correctly", async () => {
		const { workspace, Uri, Range, Position } = vscodeAPI

		const document = await workspace.openTextDocument(Uri.file(testFilePath))

		// Delete line 2
		const edit = new vscodeAPI.WorkspaceEdit()
		edit.delete(Uri.file(testFilePath), new Range(new Position(1, 0), new Position(2, 0)))

		await workspace.applyEdit(edit)

		// Verify document was updated
		expect(document.getText()).toBe("line 1\nline 3\n")
		expect(document.lineCount).toBe(3)

		// Verify file matches
		const fileContent = fs.readFileSync(testFilePath, "utf-8")
		expect(fileContent).toBe(document.getText())
	})

	it("should handle edits to non-existent files", async () => {
		const { workspace, Uri, Range, Position } = vscodeAPI

		const newFilePath = path.join(tempDir, "new-file.txt")

		// Create an edit for a file that doesn't exist yet
		const edit = new vscodeAPI.WorkspaceEdit()
		edit.replace(Uri.file(newFilePath), new Range(new Position(0, 0), new Position(0, 0)), "new content\n")

		await workspace.applyEdit(edit)

		// Verify file was created
		expect(fs.existsSync(newFilePath)).toBe(true)
		const fileContent = fs.readFileSync(newFilePath, "utf-8")
		expect(fileContent).toBe("new content\n")
	})

	it("should maintain document consistency across multiple documents", async () => {
		const { workspace, Uri, Range, Position } = vscodeAPI

		// Create second test file
		const testFile2Path = path.join(tempDir, "test2.txt")
		fs.writeFileSync(testFile2Path, "file 2 line 1\nfile 2 line 2\n", "utf-8")

		// Open both documents
		const doc1 = await workspace.openTextDocument(Uri.file(testFilePath))
		const doc2 = await workspace.openTextDocument(Uri.file(testFile2Path))

		// Edit both files in a single WorkspaceEdit
		const edit = new vscodeAPI.WorkspaceEdit()
		edit.replace(Uri.file(testFilePath), new Range(new Position(0, 0), new Position(0, 6)), "doc1 edit")
		edit.replace(Uri.file(testFile2Path), new Range(new Position(0, 0), new Position(0, 13)), "doc2 edit")

		await workspace.applyEdit(edit)

		// Verify both documents were updated
		expect(doc1.getText()).toBe("doc1 edit\nline 2\nline 3\n")
		expect(doc2.getText()).toBe("doc2 edit\nfile 2 line 2\n")

		// Verify files match documents
		expect(fs.readFileSync(testFilePath, "utf-8")).toBe(doc1.getText())
		expect(fs.readFileSync(testFile2Path, "utf-8")).toBe(doc2.getText())
	})
})

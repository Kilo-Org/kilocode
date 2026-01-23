import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import { createVSCodeAPIMock, Uri, WorkspaceEdit, Position, Range } from "../VSCode.js"

describe("WorkspaceAPI.applyEdit", () => {
	const tempDir = path.join(process.cwd(), "packages/agent-runtime/src/host/__tests__/__tmp__")
	const filePath = path.join(tempDir, "apply-edit.txt")

	beforeEach(() => {
		fs.mkdirSync(tempDir, { recursive: true })
		fs.writeFileSync(filePath, "alpha\n", "utf-8")
	})

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors in tests
		}
	})

	it("applies sequential edits without mutating the edit list", async () => {
		const vscode = createVSCodeAPIMock(tempDir, tempDir)
		const edit = new WorkspaceEdit()
		const uri = Uri.file(filePath)

		edit.replace(uri, new Range(new Position(0, 0), new Position(0, 0)), "X")
		edit.replace(uri, new Range(new Position(0, 0), new Position(0, 0)), "Y")

		const applyEditSpy = vi.spyOn(vscode.workspace, "applyEdit")
		await vscode.workspace.applyEdit(edit)
		await vscode.workspace.applyEdit(edit)

		expect(applyEditSpy).toHaveBeenCalledTimes(2)
		const finalContent = fs.readFileSync(filePath, "utf-8")
		expect(finalContent).toBe("YXYXalpha\n")
	})

	it("handles multi-line replacements without duplicating tail lines", async () => {
		const vscode = createVSCodeAPIMock(tempDir, tempDir)
		const edit = new WorkspaceEdit()
		const uri = Uri.file(filePath)

		fs.writeFileSync(filePath, "alpha\nbeta\n", "utf-8")
		edit.replace(uri, new Range(new Position(0, 0), new Position(1, 0)), "one\ntwo\n")

		await vscode.workspace.applyEdit(edit)

		const finalContent = fs.readFileSync(filePath, "utf-8")
		expect(finalContent).toBe("one\ntwo\nbeta\n")
	})

	it("handles Windows CRLF line endings correctly", async () => {
		const vscode = createVSCodeAPIMock(tempDir, tempDir)
		const edit = new WorkspaceEdit()
		const uri = Uri.file(filePath)

		// Write file with Windows CRLF line endings
		fs.writeFileSync(filePath, "alpha\r\nbeta\r\ngamma\r\n", "utf-8")
		// Replace "beta" on line 1
		edit.replace(uri, new Range(new Position(1, 0), new Position(1, 4)), "REPLACED")

		await vscode.workspace.applyEdit(edit)

		const finalContent = fs.readFileSync(filePath, "utf-8")
		// Content is normalized to LF
		expect(finalContent).toBe("alpha\nREPLACED\ngamma\n")
	})

	it("handles mixed line endings correctly", async () => {
		const vscode = createVSCodeAPIMock(tempDir, tempDir)
		const edit = new WorkspaceEdit()
		const uri = Uri.file(filePath)

		// Write file with mixed line endings (CRLF and LF)
		fs.writeFileSync(filePath, "line1\r\nline2\nline3\r\n", "utf-8")
		// Replace "line2" on line 1
		edit.replace(uri, new Range(new Position(1, 0), new Position(1, 5)), "MODIFIED")

		await vscode.workspace.applyEdit(edit)

		const finalContent = fs.readFileSync(filePath, "utf-8")
		// Content is normalized to LF
		expect(finalContent).toBe("line1\nMODIFIED\nline3\n")
	})
})

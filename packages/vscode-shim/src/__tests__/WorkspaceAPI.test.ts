import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"

import { WorkspaceAPI } from "../api/WorkspaceAPI.js"
import { Uri } from "../classes/Uri.js"
import { Range } from "../classes/Range.js"
import { Position } from "../classes/Position.js"
import { WorkspaceEdit } from "../classes/TextEdit.js"
import { ExtensionContextImpl } from "../context/ExtensionContext.js"

describe("WorkspaceAPI", () => {
	let tempDir: string
	let extensionPath: string
	let workspacePath: string
	let context: ExtensionContextImpl
	let workspaceAPI: WorkspaceAPI

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "workspace-api-test-"))
		extensionPath = path.join(tempDir, "extension")
		workspacePath = path.join(tempDir, "workspace")
		fs.mkdirSync(extensionPath, { recursive: true })
		fs.mkdirSync(workspacePath, { recursive: true })

		context = new ExtensionContextImpl({
			extensionPath,
			workspacePath,
			storageDir: path.join(tempDir, "storage"),
		})

		workspaceAPI = new WorkspaceAPI(workspacePath, context)
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true })
		}
	})

	describe("workspaceFolders", () => {
		it("should have workspace folder set", () => {
			expect(workspaceAPI.workspaceFolders).toHaveLength(1)
			expect(workspaceAPI.workspaceFolders?.[0]?.uri.fsPath).toBe(workspacePath)
			expect(workspaceAPI.workspaceFolders?.[0]?.index).toBe(0)
		})

		it("should have workspace name set", () => {
			expect(workspaceAPI.name).toBe(path.basename(workspacePath))
		})
	})

	describe("asRelativePath()", () => {
		it("should convert absolute path to relative", () => {
			const absolutePath = path.join(workspacePath, "subdir", "file.txt")
			const relativePath = workspaceAPI.asRelativePath(absolutePath)

			expect(relativePath).toBe(path.join("subdir", "file.txt"))
		})

		it("should handle URI input", () => {
			const uri = Uri.file(path.join(workspacePath, "file.txt"))
			const relativePath = workspaceAPI.asRelativePath(uri)

			expect(relativePath).toBe("file.txt")
		})

		it("should return original path if outside workspace", () => {
			const outsidePath = "/outside/workspace/file.txt"
			const result = workspaceAPI.asRelativePath(outsidePath)

			expect(result).toBe(outsidePath)
		})

		it("should handle empty workspace folders", () => {
			workspaceAPI.workspaceFolders = undefined
			const absolutePath = "/some/path/file.txt"
			const result = workspaceAPI.asRelativePath(absolutePath)

			expect(result).toBe(absolutePath)
		})
	})

	describe("getConfiguration()", () => {
		it("should return configuration object", () => {
			const config = workspaceAPI.getConfiguration("myExtension")

			expect(config).toBeDefined()
			expect(typeof config.get).toBe("function")
			expect(typeof config.has).toBe("function")
			expect(typeof config.update).toBe("function")
		})
	})

	describe("findFiles()", () => {
		it("should return empty array (minimal implementation)", async () => {
			const result = await workspaceAPI.findFiles("**/*.txt")

			expect(result).toEqual([])
		})
	})

	describe("openTextDocument()", () => {
		it("should open and return a text document", async () => {
			const filePath = path.join(workspacePath, "test.txt")
			fs.writeFileSync(filePath, "Line 1\nLine 2\nLine 3")

			const uri = Uri.file(filePath)
			const document = await workspaceAPI.openTextDocument(uri)

			expect(document.uri.fsPath).toBe(filePath)
			expect(document.fileName).toBe(filePath)
			expect(document.lineCount).toBe(3)
			expect(document.getText()).toBe("Line 1\nLine 2\nLine 3")
		})

		it("should handle getText with range", async () => {
			const filePath = path.join(workspacePath, "test.txt")
			fs.writeFileSync(filePath, "Line 1\nLine 2\nLine 3")

			const uri = Uri.file(filePath)
			const document = await workspaceAPI.openTextDocument(uri)

			const range = new Range(0, 0, 1, 6)
			const text = document.getText(range)

			expect(text).toContain("Line 1")
			expect(text).toContain("Line 2")
		})

		it("should provide lineAt method", async () => {
			const filePath = path.join(workspacePath, "test.txt")
			fs.writeFileSync(filePath, "Hello\nWorld")

			const uri = Uri.file(filePath)
			const document = await workspaceAPI.openTextDocument(uri)

			const line = document.lineAt(0)

			expect(line.text).toBe("Hello")
			expect(line.isEmptyOrWhitespace).toBe(false)
		})

		it("should add document to textDocuments", async () => {
			const filePath = path.join(workspacePath, "test.txt")
			fs.writeFileSync(filePath, "content")

			const uri = Uri.file(filePath)
			await workspaceAPI.openTextDocument(uri)

			expect(workspaceAPI.textDocuments).toHaveLength(1)
		})

		it("should handle non-existent file gracefully", async () => {
			const uri = Uri.file(path.join(workspacePath, "nonexistent.txt"))
			const document = await workspaceAPI.openTextDocument(uri)

			expect(document.getText()).toBe("")
			expect(document.lineCount).toBe(1)
		})
	})

	describe("applyEdit()", () => {
		it("should apply single edit to file", async () => {
			const filePath = path.join(workspacePath, "edit-test.txt")
			fs.writeFileSync(filePath, "Hello World")

			const edit = new WorkspaceEdit()
			const uri = Uri.file(filePath)
			edit.replace(uri, new Range(0, 0, 0, 5), "Hi")

			const result = await workspaceAPI.applyEdit(edit)

			expect(result).toBe(true)
			expect(fs.readFileSync(filePath, "utf-8")).toBe("Hi World")
		})

		it("should apply insert edit", async () => {
			const filePath = path.join(workspacePath, "insert-test.txt")
			fs.writeFileSync(filePath, "World")

			const edit = new WorkspaceEdit()
			const uri = Uri.file(filePath)
			edit.insert(uri, new Position(0, 0), "Hello ")

			const result = await workspaceAPI.applyEdit(edit)

			expect(result).toBe(true)
			expect(fs.readFileSync(filePath, "utf-8")).toBe("Hello World")
		})

		it("should apply delete edit", async () => {
			const filePath = path.join(workspacePath, "delete-test.txt")
			fs.writeFileSync(filePath, "Hello World")

			const edit = new WorkspaceEdit()
			const uri = Uri.file(filePath)
			edit.delete(uri, new Range(0, 5, 0, 11))

			const result = await workspaceAPI.applyEdit(edit)

			expect(result).toBe(true)
			expect(fs.readFileSync(filePath, "utf-8")).toBe("Hello")
		})

		it("should create file if it doesn't exist", async () => {
			const filePath = path.join(workspacePath, "new-file.txt")

			const edit = new WorkspaceEdit()
			const uri = Uri.file(filePath)
			edit.insert(uri, new Position(0, 0), "New content")

			const result = await workspaceAPI.applyEdit(edit)

			expect(result).toBe(true)
			expect(fs.readFileSync(filePath, "utf-8")).toBe("New content")
		})

		it("should update in-memory document", async () => {
			const filePath = path.join(workspacePath, "memory-test.txt")
			fs.writeFileSync(filePath, "Original")

			// First open the document
			const uri = Uri.file(filePath)
			const document = await workspaceAPI.openTextDocument(uri)
			expect(document.getText()).toBe("Original")

			// Apply edit
			const edit = new WorkspaceEdit()
			edit.replace(uri, new Range(0, 0, 0, 8), "Modified")
			await workspaceAPI.applyEdit(edit)

			// Check in-memory document is updated
			expect(document.getText()).toBe("Modified")
		})
	})

	describe("createFileSystemWatcher()", () => {
		it("should return a file system watcher object", () => {
			const watcher = workspaceAPI.createFileSystemWatcher()

			expect(typeof watcher.onDidChange).toBe("function")
			expect(typeof watcher.onDidCreate).toBe("function")
			expect(typeof watcher.onDidDelete).toBe("function")
			expect(typeof watcher.dispose).toBe("function")
		})
	})

	describe("events", () => {
		it("should have onDidChangeWorkspaceFolders event", () => {
			expect(typeof workspaceAPI.onDidChangeWorkspaceFolders).toBe("function")
		})

		it("should have onDidOpenTextDocument event", () => {
			expect(typeof workspaceAPI.onDidOpenTextDocument).toBe("function")
		})

		it("should have onDidChangeTextDocument event", () => {
			expect(typeof workspaceAPI.onDidChangeTextDocument).toBe("function")
		})

		it("should have onDidCloseTextDocument event", () => {
			expect(typeof workspaceAPI.onDidCloseTextDocument).toBe("function")
		})

		it("should have onDidChangeConfiguration event", () => {
			expect(typeof workspaceAPI.onDidChangeConfiguration).toBe("function")
		})
	})

	describe("fs property", () => {
		it("should have FileSystemAPI instance", () => {
			expect(workspaceAPI.fs).toBeDefined()
			expect(typeof workspaceAPI.fs.stat).toBe("function")
			expect(typeof workspaceAPI.fs.readFile).toBe("function")
			expect(typeof workspaceAPI.fs.writeFile).toBe("function")
		})
	})

	describe("registerTextDocumentContentProvider()", () => {
		it("should return a disposable", () => {
			const disposable = workspaceAPI.registerTextDocumentContentProvider("test", {
				provideTextDocumentContent: () => Promise.resolve("content"),
			})

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})
})

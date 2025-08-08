/**
 * VS Code Workspace API Tests
 * Tests the vscode.workspace API mocking including configuration and workspace folders
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { CLIProvider } from "../providers/CLIProvider"
import path from "path"
import fs from "fs"
import os from "os"

describe("VS Code Workspace API", () => {
	let cliProvider: CLIProvider
	let tempDir: string
	let vscodeModule: any

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-workspace-test-"))
		cliProvider = new CLIProvider(tempDir)
		await cliProvider.initialize()
		vscodeModule = cliProvider.createVSCodeModule()
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("workspaceFolders", () => {
		test("should have at least one workspace folder", () => {
			expect(vscodeModule.workspace.workspaceFolders).toBeDefined()
			expect(Array.isArray(vscodeModule.workspace.workspaceFolders)).toBe(true)
			expect(vscodeModule.workspace.workspaceFolders.length).toBeGreaterThan(0)
		})

		test("should have correct workspace folder structure", () => {
			const folder = vscodeModule.workspace.workspaceFolders[0]

			expect(folder).toBeDefined()
			expect(folder.uri).toBeDefined()
			expect(folder.uri.fsPath).toBe(tempDir)
			expect(folder.name).toBeDefined()
			expect(typeof folder.index).toBe("number")
		})
	})

	describe("getConfiguration", () => {
		test("should return configuration object", () => {
			const config = vscodeModule.workspace.getConfiguration()

			expect(config).toBeDefined()
			expect(typeof config.get).toBe("function")
			expect(typeof config.update).toBe("function")
		})

		test("should return section-specific configuration", () => {
			const kilocodeConfig = vscodeModule.workspace.getConfiguration("kilocode")
			const editorConfig = vscodeModule.workspace.getConfiguration("editor")

			expect(kilocodeConfig).toBeDefined()
			expect(editorConfig).toBeDefined()
		})

		test("should handle get with default values", () => {
			const config = vscodeModule.workspace.getConfiguration("test")

			expect(config.get("nonexistent")).toBeUndefined()
			expect(config.get("nonexistent", "default")).toBe("default")
			expect(config.get("nonexistent", 42)).toBe(42)
			expect(config.get("nonexistent", true)).toBe(true)
		})

		test("should handle update operations", async () => {
			const config = vscodeModule.workspace.getConfiguration("test")

			await expect(config.update("testKey", "testValue")).resolves.not.toThrow()
			expect(config.get("testKey")).toBe("testValue")
		})

		test("should maintain separate namespaces", async () => {
			const config1 = vscodeModule.workspace.getConfiguration("namespace1")
			const config2 = vscodeModule.workspace.getConfiguration("namespace2")

			await config1.update("key", "value1")
			await config2.update("key", "value2")

			expect(config1.get("key")).toBe("value1")
			expect(config2.get("key")).toBe("value2")
		})
	})

	describe("file operations", () => {
		test("should have fs property with required methods", () => {
			expect(vscodeModule.workspace.fs).toBeDefined()
			expect(typeof vscodeModule.workspace.fs.readFile).toBe("function")
			expect(typeof vscodeModule.workspace.fs.writeFile).toBe("function")
			expect(typeof vscodeModule.workspace.fs.stat).toBe("function")
			expect(typeof vscodeModule.workspace.fs.delete).toBe("function")
		})
	})

	describe("document operations", () => {
		test("should have textDocuments array", () => {
			expect(Array.isArray(vscodeModule.workspace.textDocuments)).toBe(true)
		})

		test("openTextDocument should work with file paths", async () => {
			const testFile = path.join(tempDir, "test-doc.txt")
			const testContent = "Document content"
			fs.writeFileSync(testFile, testContent)

			const document = await vscodeModule.workspace.openTextDocument(testFile)

			expect(document).toBeDefined()
			expect(document.getText()).toBe(testContent)
			expect(document.fileName).toBe(testFile)
		})
	})

	describe("utility functions", () => {
		test("asRelativePath should work", () => {
			expect(typeof vscodeModule.workspace.asRelativePath).toBe("function")

			const fullPath = path.join(tempDir, "subdir", "file.txt")
			const relativePath = vscodeModule.workspace.asRelativePath(fullPath)

			expect(relativePath).toBeDefined()
			expect(typeof relativePath).toBe("string")
		})

		test("getWorkspaceFolder should work", () => {
			expect(typeof vscodeModule.workspace.getWorkspaceFolder).toBe("function")

			const uri = { fsPath: path.join(tempDir, "file.txt") }
			const folder = vscodeModule.workspace.getWorkspaceFolder(uri)

			// Should return undefined or a workspace folder
			expect(folder === undefined || (folder && folder.uri && typeof folder.uri.fsPath === "string")).toBe(true)
		})
	})

	describe("file watching", () => {
		test("createFileSystemWatcher should return watcher", () => {
			expect(typeof vscodeModule.workspace.createFileSystemWatcher).toBe("function")

			const watcher = vscodeModule.workspace.createFileSystemWatcher("**/*.ts")

			expect(watcher).toBeDefined()
			expect(typeof watcher.dispose).toBe("function")
		})
	})

	describe("events", () => {
		test("should have event handlers", () => {
			expect(typeof vscodeModule.workspace.onDidChangeWorkspaceFolders).toBe("function")
			expect(typeof vscodeModule.workspace.onDidChangeTextDocument).toBe("function")
			expect(typeof vscodeModule.workspace.onDidOpenTextDocument).toBe("function")
			expect(typeof vscodeModule.workspace.onDidCloseTextDocument).toBe("function")
			expect(typeof vscodeModule.workspace.onDidChangeConfiguration).toBe("function")
		})

		test("event handlers should return disposables", () => {
			const disposable1 = vscodeModule.workspace.onDidChangeWorkspaceFolders(() => {})
			const disposable2 = vscodeModule.workspace.onDidChangeTextDocument(() => {})

			expect(disposable1).toBeDefined()
			expect(typeof disposable1.dispose).toBe("function")
			expect(disposable2).toBeDefined()
			expect(typeof disposable2.dispose).toBe("function")
		})
	})

	describe("workspace edit", () => {
		test("applyEdit should be callable", async () => {
			expect(typeof vscodeModule.workspace.applyEdit).toBe("function")

			const mockEdit = {
				set: () => {},
				get: () => [],
				has: () => false,
				delete: () => {},
			}

			const result = await vscodeModule.workspace.applyEdit(mockEdit)
			expect(typeof result).toBe("boolean")
		})
	})

	describe("content providers", () => {
		test("registerTextDocumentContentProvider should return disposable", () => {
			expect(typeof vscodeModule.workspace.registerTextDocumentContentProvider).toBe("function")

			const disposable = vscodeModule.workspace.registerTextDocumentContentProvider("test-scheme", {
				provideTextDocumentContent: () => "test content",
			})

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})
})

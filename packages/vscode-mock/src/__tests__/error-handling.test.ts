import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { VSCodeAPI } from "../api/VSCodeAPI"
import { FileSystemAdapter } from "../adapters/FileSystemAdapter"
import { UserInterfaceAdapter } from "../adapters/UserInterfaceAdapter"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("Error Handling Tests", () => {
	let tempDir: string
	let vscodeAPI: VSCodeAPI
	let fileSystemAdapter: FileSystemAdapter
	let userInterfaceAdapter: UserInterfaceAdapter

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-error-test-"))
		fileSystemAdapter = new FileSystemAdapter(tempDir)
		userInterfaceAdapter = new UserInterfaceAdapter()
		vscodeAPI = new VSCodeAPI(fileSystemAdapter, userInterfaceAdapter)
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("File System Error Handling", () => {
		it("should handle reading non-existent files gracefully", async () => {
			const nonExistentFile = VSCodeAPI.Uri.file(path.join(tempDir, "does-not-exist.txt"))

			await expect(vscodeAPI.workspace.fs.readFile(nonExistentFile)).rejects.toThrow(/Failed to read file/)
		})

		it("should handle writing to invalid paths", async () => {
			// Try to write to a path with invalid characters (on some systems)
			const invalidPath = VSCodeAPI.Uri.file("/invalid\0path/file.txt")
			const content = new TextEncoder().encode("test content")

			await expect(vscodeAPI.workspace.fs.writeFile(invalidPath, content)).rejects.toThrow()
		})

		it("should handle stat operations on non-existent files", async () => {
			const nonExistentFile = VSCodeAPI.Uri.file(path.join(tempDir, "missing.txt"))

			await expect(vscodeAPI.workspace.fs.stat(nonExistentFile)).rejects.toThrow(/Failed to stat/)
		})

		it("should handle deleting non-existent files", async () => {
			const nonExistentFile = VSCodeAPI.Uri.file(path.join(tempDir, "missing.txt"))

			await expect(vscodeAPI.workspace.fs.delete(nonExistentFile)).rejects.toThrow(/Failed to delete/)
		})
	})

	describe("Workspace Error Handling", () => {
		it("should handle opening non-existent text documents", async () => {
			const nonExistentFile = VSCodeAPI.Uri.file(path.join(tempDir, "missing.txt"))

			await expect(vscodeAPI.workspace.openTextDocument(nonExistentFile)).rejects.toThrow(/Failed to read file/)
		})

		it("should handle invalid workspace folder operations", () => {
			// Test with invalid URI
			const invalidUri = { fsPath: "/completely/invalid/path/that/does/not/exist" } as any

			const workspaceFolder = vscodeAPI.workspace.getWorkspaceFolder(invalidUri)
			// Should still return the workspace folder since we mock it
			expect(workspaceFolder).toBeDefined()
		})

		it("should handle relative path operations with invalid paths", () => {
			const invalidUri = { fsPath: "" } as any

			const relativePath = vscodeAPI.workspace.asRelativePath(invalidUri)
			expect(typeof relativePath).toBe("string")
		})
	})

	describe("Configuration Error Handling", () => {
		it("should handle configuration operations gracefully", () => {
			const config = vscodeAPI.workspace.getConfiguration("nonexistent")

			// Should not throw, should return default values
			expect(config.get("missing-key")).toBeUndefined()
			expect(config.get("missing-key", "default")).toBe("default")
		})

		it("should handle configuration updates without errors", async () => {
			const config = vscodeAPI.workspace.getConfiguration("test")

			// Should not throw
			await expect(config.update("key", "value")).resolves.toBeUndefined()
		})
	})

	describe("Window API Error Handling", () => {
		it("should handle progress operations with errors in task", async () => {
			const errorTask = async () => {
				throw new Error("Task failed")
			}

			await expect(vscodeAPI.window.withProgress({ title: "Test Progress" }, errorTask)).rejects.toThrow(
				"Task failed",
			)
		})

		it("should handle decoration type creation without errors", () => {
			// Should not throw even with invalid options
			const decorationType = vscodeAPI.window.createTextEditorDecorationType({
				backgroundColor: "invalid-color",
				color: null as any,
			})

			expect(decorationType).toBeDefined()
			expect(typeof decorationType.dispose).toBe("function")
		})
	})

	describe("Extension Context Error Handling", () => {
		it("should handle state operations with invalid keys", async () => {
			const context = vscodeAPI.createExtensionContext()

			// Should handle empty/null keys gracefully
			expect(context.workspaceState.get("")).toBeUndefined()
			expect(context.globalState.get(null as any)).toBeUndefined()

			// Should handle updates with invalid values
			await expect(context.workspaceState.update("", "value")).resolves.toBeUndefined()
			await expect(context.globalState.update("key", undefined)).resolves.toBeUndefined()
		})
	})

	describe("URI Error Handling", () => {
		it("should handle invalid URI creation", () => {
			// Should handle empty paths
			const emptyUri = VSCodeAPI.Uri.file("")
			expect(emptyUri.fsPath).toBe("")

			// Should handle null/undefined paths gracefully
			const nullUri = VSCodeAPI.Uri.file(null as any)
			expect(nullUri.fsPath).toBe(null)
		})

		it("should handle URI parsing errors", () => {
			// Should handle invalid URI strings
			const invalidUri = VSCodeAPI.Uri.parse("not-a-valid-uri")
			expect(invalidUri).toBeDefined()

			const emptyUri = VSCodeAPI.Uri.parse("")
			expect(emptyUri).toBeDefined()
		})
	})

	describe("Event System Error Handling", () => {
		it("should handle file watcher creation with invalid patterns", () => {
			// Should not throw with invalid patterns
			const watcher1 = vscodeAPI.workspace.createFileSystemWatcher("")
			const watcher2 = vscodeAPI.workspace.createFileSystemWatcher(null as any)

			expect(watcher1).toBeDefined()
			expect(watcher2).toBeDefined()

			// Should be able to dispose without errors
			expect(() => watcher1.dispose()).not.toThrow()
			expect(() => watcher2.dispose()).not.toThrow()
		})

		it("should handle event listener registration errors", () => {
			const watcher = vscodeAPI.workspace.createFileSystemWatcher("**/*")

			// Should handle null/undefined listeners
			expect(() => watcher.onDidCreate(null as any)).not.toThrow()
			expect(() => watcher.onDidChange(undefined as any)).not.toThrow()
			expect(() =>
				watcher.onDidDelete(() => {
					throw new Error("Listener error")
				}),
			).not.toThrow()
		})
	})
})

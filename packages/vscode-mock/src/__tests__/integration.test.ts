import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { VSCodeAPI } from "../api/VSCodeAPI"
import { CLIProvider } from "../providers/CLIProvider"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("VS Code API Integration Tests", () => {
	let tempDir: string
	let vscodeAPI: VSCodeAPI
	let provider: CLIProvider

	beforeEach(async () => {
		// Create temporary directory for testing
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-test-"))

		// Initialize CLI provider with temp directory
		provider = new CLIProvider(tempDir)

		vscodeAPI = provider.getVSCodeAPI()
	})

	afterEach(() => {
		// Clean up temp directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("File System Operations", () => {
		it("should create and read files through workspace.fs", async () => {
			const testFile = path.join(tempDir, "test.txt")
			const testContent = "Hello from VS Code mock!"

			// Create file using VS Code API
			const uri = VSCodeAPI.Uri.file(testFile)
			const encoder = new TextEncoder()
			await vscodeAPI.workspace.fs.writeFile(uri, encoder.encode(testContent))

			// Verify file exists
			expect(fs.existsSync(testFile)).toBe(true)

			// Read file using VS Code API
			const readData = await vscodeAPI.workspace.fs.readFile(uri)
			const decoder = new TextDecoder()
			const readContent = decoder.decode(readData)

			expect(readContent).toBe(testContent)
		})

		it("should handle file stats correctly", async () => {
			const testFile = path.join(tempDir, "stats-test.txt")
			fs.writeFileSync(testFile, "test content")

			const uri = VSCodeAPI.Uri.file(testFile)
			const stat = await vscodeAPI.workspace.fs.stat(uri)

			expect(stat.type).toBe(1) // FileType.File
			expect(stat.size).toBeGreaterThan(0)
			expect(typeof stat.ctime).toBe("number")
			expect(typeof stat.mtime).toBe("number")
		})

		it("should delete files correctly", async () => {
			const testFile = path.join(tempDir, "delete-test.txt")
			fs.writeFileSync(testFile, "to be deleted")

			expect(fs.existsSync(testFile)).toBe(true)

			const uri = VSCodeAPI.Uri.file(testFile)
			await vscodeAPI.workspace.fs.delete(uri)

			expect(fs.existsSync(testFile)).toBe(false)
		})
	})

	describe("Workspace Operations", () => {
		it("should provide workspace folders", () => {
			const folders = vscodeAPI.workspace.workspaceFolders

			expect(folders).toBeDefined()
			expect(folders).toHaveLength(1)
			expect(folders![0].uri.fsPath).toBe(tempDir)
			expect(folders![0].name).toBe(path.basename(tempDir))
		})

		it("should resolve workspace folder for files", () => {
			const testFile = path.join(tempDir, "subfolder", "test.txt")
			const uri = VSCodeAPI.Uri.file(testFile)

			const workspaceFolder = vscodeAPI.workspace.getWorkspaceFolder(uri)

			expect(workspaceFolder).toBeDefined()
			expect(workspaceFolder!.uri.fsPath).toBe(tempDir)
		})

		it("should create relative paths correctly", () => {
			const testFile = path.join(tempDir, "subfolder", "test.txt")
			const uri = VSCodeAPI.Uri.file(testFile)

			const relativePath = vscodeAPI.workspace.asRelativePath(uri)

			expect(relativePath).toBe(path.join("subfolder", "test.txt"))
		})
	})

	describe("Window Operations", () => {
		it("should handle progress reporting", async () => {
			let progressReported = false
			let progressMessage = ""

			// Mock the user interface to capture progress
			const originalShowProgress = provider.getUserInterfaceAdapter().showProgress
			provider.getUserInterfaceAdapter().showProgress = async (title: string, task: () => Promise<any>) => {
				progressReported = true
				progressMessage = title
				return await task()
			}

			const result = await vscodeAPI.window.withProgress({ title: "Test Progress" }, async (progress, token) => {
				progress.report({ message: "Working..." })
				return "completed"
			})

			expect(progressReported).toBe(true)
			expect(progressMessage).toBe("Test Progress")
			expect(result).toBe("completed")

			// Restore original method
			provider.getUserInterfaceAdapter().showProgress = originalShowProgress
		})

		it("should create text editor decoration types", () => {
			const decorationType = vscodeAPI.window.createTextEditorDecorationType({
				backgroundColor: "red",
				color: "white",
			})

			expect(decorationType).toBeDefined()
			expect(decorationType.key).toBeDefined()
			expect(typeof decorationType.dispose).toBe("function")
		})
	})

	describe("Configuration", () => {
		it("should provide configuration values", () => {
			const config = vscodeAPI.workspace.getConfiguration("test")

			expect(config).toBeDefined()
			expect(typeof config.get).toBe("function")
			expect(typeof config.has).toBe("function")
			expect(typeof config.update).toBe("function")
		})

		it("should handle configuration updates", async () => {
			const config = vscodeAPI.workspace.getConfiguration("test")

			await config.update("key", "value")
			const value = config.get("key")

			expect(value).toBe("value")
		})
	})

	describe("Events and Disposables", () => {
		it("should create disposables correctly", () => {
			const disposable1 = { dispose: vi.fn() }
			const disposable2 = { dispose: vi.fn() }

			const combined = VSCodeAPI.Disposable.from(disposable1, disposable2)

			expect(combined).toBeDefined()
			expect(typeof combined.dispose).toBe("function")

			combined.dispose()

			expect(disposable1.dispose).toHaveBeenCalled()
			expect(disposable2.dispose).toHaveBeenCalled()
		})

		it("should handle file system watcher events", () => {
			const pattern = new VSCodeAPI.RelativePattern(tempDir, "**/*.txt")
			const watcher = vscodeAPI.workspace.createFileSystemWatcher(pattern)

			expect(watcher).toBeDefined()
			expect(typeof watcher.onDidCreate).toBe("function")
			expect(typeof watcher.onDidChange).toBe("function")
			expect(typeof watcher.onDidDelete).toBe("function")
			expect(typeof watcher.dispose).toBe("function")
		})
	})

	describe("Text Editor Operations", () => {
		it("should provide active text editor", () => {
			const editor = vscodeAPI.window.activeTextEditor

			expect(editor).toBeDefined()
			expect(editor!.document).toBeDefined()
			expect(editor!.document.uri).toBeDefined()
			expect(editor!.document.fileName).toBeDefined()
		})

		it("should handle text document operations", async () => {
			const testFile = path.join(tempDir, "document-test.txt")
			const testContent = "Line 1\nLine 2\nLine 3"
			fs.writeFileSync(testFile, testContent)

			const uri = VSCodeAPI.Uri.file(testFile)
			const document = await vscodeAPI.workspace.openTextDocument(uri)

			expect(document).toBeDefined()
			expect(document.fileName).toBe(testFile)
			expect(document.lineCount).toBe(3)
			expect(document.getText()).toBe(testContent)
		})
	})
})

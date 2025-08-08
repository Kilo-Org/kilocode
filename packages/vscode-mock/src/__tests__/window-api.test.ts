/**
 * VS Code Window API Tests
 * Tests the vscode.window API mocking including decorations, messages, and progress
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { CLIProvider } from "../providers/CLIProvider"
import path from "path"
import fs from "fs"
import os from "os"

describe("VS Code Window API", () => {
	let cliProvider: CLIProvider
	let tempDir: string
	let vscodeModule: any

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-window-test-"))
		cliProvider = new CLIProvider(tempDir)
		await cliProvider.initialize()
		vscodeModule = cliProvider.createVSCodeModule()
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("createTextEditorDecorationType", () => {
		test("should create decoration type with key", () => {
			const decorationType = vscodeModule.window.createTextEditorDecorationType({
				backgroundColor: "red",
				color: "white",
			})

			expect(decorationType).toBeDefined()
			expect(decorationType.key).toBeDefined()
			expect(typeof decorationType.key).toBe("string")
			expect(typeof decorationType.dispose).toBe("function")
		})

		test("should create unique decoration types", () => {
			const decoration1 = vscodeModule.window.createTextEditorDecorationType({ color: "red" })
			const decoration2 = vscodeModule.window.createTextEditorDecorationType({ color: "blue" })

			expect(decoration1.key).not.toBe(decoration2.key)
		})

		test("should handle dispose without errors", () => {
			const decorationType = vscodeModule.window.createTextEditorDecorationType({ color: "green" })

			expect(() => decorationType.dispose()).not.toThrow()
		})
	})

	describe("message functions", () => {
		test("showInformationMessage should be callable", async () => {
			expect(typeof vscodeModule.window.showInformationMessage).toBe("function")

			// Should not throw
			const result = vscodeModule.window.showInformationMessage("Test info message")
			expect(result).toBeInstanceOf(Promise)
		})

		test("showWarningMessage should be callable", async () => {
			expect(typeof vscodeModule.window.showWarningMessage).toBe("function")

			const result = vscodeModule.window.showWarningMessage("Test warning message")
			expect(result).toBeInstanceOf(Promise)
		})

		test("showErrorMessage should be callable", async () => {
			expect(typeof vscodeModule.window.showErrorMessage).toBe("function")

			const result = vscodeModule.window.showErrorMessage("Test error message")
			expect(result).toBeInstanceOf(Promise)
		})
	})

	describe("input functions", () => {
		test("showInputBox should be callable", async () => {
			expect(typeof vscodeModule.window.showInputBox).toBe("function")

			const result = vscodeModule.window.showInputBox({
				prompt: "Enter value",
				placeHolder: "Type here...",
			})
			expect(result).toBeInstanceOf(Promise)
		})

		test("showQuickPick should be callable", async () => {
			expect(typeof vscodeModule.window.showQuickPick).toBe("function")

			const result = vscodeModule.window.showQuickPick(["Option 1", "Option 2"], {
				placeHolder: "Select an option",
			})
			expect(result).toBeInstanceOf(Promise)
		})
	})

	describe("progress functions", () => {
		test("withProgress should be callable and execute task", async () => {
			expect(typeof vscodeModule.window.withProgress).toBe("function")

			let taskExecuted = false
			const result = await vscodeModule.window.withProgress(
				{ title: "Test Progress" },
				async (progress, token) => {
					taskExecuted = true
					expect(progress).toBeDefined()
					expect(progress.report).toBeDefined()
					expect(token).toBeDefined()
					return "task result"
				},
			)

			expect(taskExecuted).toBe(true)
			expect(result).toBe("task result")
		})

		test("progress.report should be callable", async () => {
			await vscodeModule.window.withProgress({ title: "Test Progress Report" }, async (progress) => {
				expect(() => {
					progress.report({ message: "Step 1" })
					progress.report({ increment: 50 })
					progress.report({ message: "Step 2", increment: 25 })
				}).not.toThrow()
			})
		})
	})

	describe("status bar", () => {
		test("createStatusBarItem should create item with methods", () => {
			const statusItem = vscodeModule.window.createStatusBarItem()

			expect(statusItem).toBeDefined()
			expect(typeof statusItem.show).toBe("function")
			expect(typeof statusItem.hide).toBe("function")
			expect(typeof statusItem.dispose).toBe("function")
			expect(statusItem.text).toBeDefined()
		})

		test("status bar item methods should not throw", () => {
			const statusItem = vscodeModule.window.createStatusBarItem()

			expect(() => {
				statusItem.text = "Test Status"
				statusItem.show()
				statusItem.hide()
				statusItem.dispose()
			}).not.toThrow()
		})
	})

	describe("dialogs", () => {
		test("showSaveDialog should be callable", async () => {
			expect(typeof vscodeModule.window.showSaveDialog).toBe("function")

			const result = vscodeModule.window.showSaveDialog({
				defaultUri: { fsPath: path.join(tempDir, "test.txt") },
			})
			expect(result).toBeInstanceOf(Promise)
		})

		test("showTextDocument should be callable", async () => {
			expect(typeof vscodeModule.window.showTextDocument).toBe("function")

			const mockDocument = {
				uri: { fsPath: path.join(tempDir, "test.txt") },
				getText: () => "test content",
				fileName: "test.txt",
				lineCount: 1,
			}

			const result = vscodeModule.window.showTextDocument(mockDocument)
			expect(result).toBeInstanceOf(Promise)
		})
	})

	describe("webview", () => {
		test("createWebviewPanel should create panel", () => {
			const panel = vscodeModule.window.createWebviewPanel(
				"testView",
				"Test Panel",
				1, // ViewColumn.One
				{ enableScripts: true },
			)

			expect(panel).toBeDefined()
			expect(panel.viewType).toBe("testView")
			expect(panel.title).toBe("Test Panel")
			expect(panel.webview).toBeDefined()
			expect(typeof panel.dispose).toBe("function")
		})

		test("registerWebviewViewProvider should return disposable", () => {
			const disposable = vscodeModule.window.registerWebviewViewProvider("testViewProvider", {
				resolveWebviewView: () => {},
			})

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})

	describe("terminal", () => {
		test("createTerminal should create terminal", () => {
			const terminal = vscodeModule.window.createTerminal({
				name: "Test Terminal",
			})

			expect(terminal).toBeDefined()
			expect(terminal.name).toBe("Test Terminal")
			expect(typeof terminal.sendText).toBe("function")
			expect(typeof terminal.show).toBe("function")
			expect(typeof terminal.dispose).toBe("function")
		})

		test("terminal methods should not throw", () => {
			const terminal = vscodeModule.window.createTerminal()

			expect(() => {
				terminal.sendText('echo "test"')
				terminal.show()
				terminal.dispose()
			}).not.toThrow()
		})
	})

	describe("properties", () => {
		test("should have expected properties", () => {
			expect(vscodeModule.window.activeTextEditor).toBeDefined()
			expect(Array.isArray(vscodeModule.window.visibleTextEditors)).toBe(true)
			expect(Array.isArray(vscodeModule.window.terminals)).toBe(true)
			expect(vscodeModule.window.tabGroups).toBeDefined()
		})

		test("should have event handlers", () => {
			expect(typeof vscodeModule.window.onDidChangeActiveTextEditor).toBe("function")
			expect(typeof vscodeModule.window.onDidOpenTerminal).toBe("function")
			expect(typeof vscodeModule.window.onDidCloseTerminal).toBe("function")
		})
	})
})

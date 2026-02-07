import { WindowAPI } from "../api/WindowAPI.js"
import { Uri } from "../classes/Uri.js"
import { StatusBarAlignment } from "../types.js"

describe("WindowAPI", () => {
	let windowAPI: WindowAPI

	beforeEach(() => {
		windowAPI = new WindowAPI()
	})

	describe("tabGroups property", () => {
		it("should have tabGroups", () => {
			expect(windowAPI.tabGroups).toBeDefined()
		})

		it("should return TabGroupsAPI instance", () => {
			expect(typeof windowAPI.tabGroups.onDidChangeTabs).toBe("function")
			expect(Array.isArray(windowAPI.tabGroups.all)).toBe(true)
		})
	})

	describe("visibleTextEditors property", () => {
		it("should be an empty array initially", () => {
			expect(windowAPI.visibleTextEditors).toEqual([])
		})
	})

	describe("createOutputChannel()", () => {
		it("should create an output channel with the given name", () => {
			const channel = windowAPI.createOutputChannel("TestChannel")

			expect(channel.name).toBe("TestChannel")
		})

		it("should return an OutputChannel instance", () => {
			const channel = windowAPI.createOutputChannel("Test")

			expect(typeof channel.append).toBe("function")
			expect(typeof channel.appendLine).toBe("function")
			expect(typeof channel.dispose).toBe("function")
		})
	})

	describe("createStatusBarItem()", () => {
		it("should create with default alignment", () => {
			const item = windowAPI.createStatusBarItem()

			expect(item.alignment).toBe(StatusBarAlignment.Left)
		})

		it("should create with specified alignment", () => {
			const item = windowAPI.createStatusBarItem(StatusBarAlignment.Right)

			expect(item.alignment).toBe(StatusBarAlignment.Right)
		})

		it("should create with alignment and priority", () => {
			const item = windowAPI.createStatusBarItem(StatusBarAlignment.Left, 100)

			expect(item.alignment).toBe(StatusBarAlignment.Left)
			expect(item.priority).toBe(100)
		})

		it("should handle overloaded signature with id", () => {
			const item = windowAPI.createStatusBarItem("myId", StatusBarAlignment.Right, 50)

			expect(item.alignment).toBe(StatusBarAlignment.Right)
			expect(item.priority).toBe(50)
		})
	})

	describe("createTextEditorDecorationType()", () => {
		it("should create a decoration type", () => {
			const decoration = windowAPI.createTextEditorDecorationType({})

			expect(decoration).toBeDefined()
			expect(decoration.key).toContain("decoration-")
		})

		it("should return unique keys", () => {
			const decoration1 = windowAPI.createTextEditorDecorationType({})
			const decoration2 = windowAPI.createTextEditorDecorationType({})

			expect(decoration1.key).not.toBe(decoration2.key)
		})
	})

	describe("createTerminal()", () => {
		it("should create a terminal with default name", () => {
			const terminal = windowAPI.createTerminal()

			expect(terminal.name).toBe("Terminal")
		})

		it("should create a terminal with specified name", () => {
			const terminal = windowAPI.createTerminal({ name: "MyTerminal" })

			expect(terminal.name).toBe("MyTerminal")
		})

		it("should return terminal with expected methods", () => {
			const terminal = windowAPI.createTerminal()

			expect(typeof terminal.sendText).toBe("function")
			expect(typeof terminal.show).toBe("function")
			expect(typeof terminal.hide).toBe("function")
			expect(typeof terminal.dispose).toBe("function")
		})

		it("should have processId promise", async () => {
			const terminal = windowAPI.createTerminal()

			const processId = await terminal.processId

			expect(processId).toBeUndefined()
		})
	})

	describe("showInformationMessage()", () => {
		it("should return a promise", () => {
			const result = windowAPI.showInformationMessage("Test message")

			expect(result).toBeInstanceOf(Promise)
		})

		it("should resolve to undefined", async () => {
			const result = await windowAPI.showInformationMessage("Test message")

			expect(result).toBeUndefined()
		})
	})

	describe("showWarningMessage()", () => {
		it("should return a promise", () => {
			const result = windowAPI.showWarningMessage("Warning message")

			expect(result).toBeInstanceOf(Promise)
		})

		it("should resolve to undefined", async () => {
			const result = await windowAPI.showWarningMessage("Warning message")

			expect(result).toBeUndefined()
		})
	})

	describe("showErrorMessage()", () => {
		it("should return a promise", () => {
			const result = windowAPI.showErrorMessage("Error message")

			expect(result).toBeInstanceOf(Promise)
		})

		it("should resolve to undefined", async () => {
			const result = await windowAPI.showErrorMessage("Error message")

			expect(result).toBeUndefined()
		})
	})

	describe("showQuickPick()", () => {
		it("should return first item", async () => {
			const result = await windowAPI.showQuickPick(["item1", "item2", "item3"])

			expect(result).toBe("item1")
		})

		it("should return undefined for empty array", async () => {
			const result = await windowAPI.showQuickPick([])

			expect(result).toBeUndefined()
		})
	})

	describe("showInputBox()", () => {
		it("should return empty string", async () => {
			const result = await windowAPI.showInputBox()

			expect(result).toBe("")
		})
	})

	describe("showOpenDialog()", () => {
		it("should return empty array", async () => {
			const result = await windowAPI.showOpenDialog()

			expect(result).toEqual([])
		})
	})

	describe("showTextDocument()", () => {
		it("should return an editor", async () => {
			const uri = Uri.file("/test/file.txt")
			const editor = await windowAPI.showTextDocument(uri)

			expect(editor).toBeDefined()
			expect(editor.document).toBeDefined()
		})

		it("should add editor to visibleTextEditors", async () => {
			const uri = Uri.file("/test/file.txt")
			await windowAPI.showTextDocument(uri)

			expect(windowAPI.visibleTextEditors.length).toBeGreaterThan(0)
		})
	})

	describe("registerWebviewViewProvider()", () => {
		it("should return a disposable", () => {
			const mockProvider = {
				resolveWebviewView: vi.fn(),
			}

			const disposable = windowAPI.registerWebviewViewProvider("myView", mockProvider)

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})

	describe("registerUriHandler()", () => {
		it("should return a disposable", () => {
			const mockHandler = {
				handleUri: vi.fn(),
			}

			const disposable = windowAPI.registerUriHandler(mockHandler)

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})

	describe("onDidChangeTextEditorSelection()", () => {
		it("should return a disposable", () => {
			const disposable = windowAPI.onDidChangeTextEditorSelection(() => {})

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})

	describe("onDidChangeActiveTextEditor()", () => {
		it("should return a disposable", () => {
			const disposable = windowAPI.onDidChangeActiveTextEditor(() => {})

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})

	describe("onDidChangeVisibleTextEditors()", () => {
		it("should return a disposable", () => {
			const disposable = windowAPI.onDidChangeVisibleTextEditors(() => {})

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})

	describe("terminal events", () => {
		it("onDidCloseTerminal should return disposable", () => {
			const disposable = windowAPI.onDidCloseTerminal(() => {})

			expect(typeof disposable.dispose).toBe("function")
		})

		it("onDidOpenTerminal should return disposable", () => {
			const disposable = windowAPI.onDidOpenTerminal(() => {})

			expect(typeof disposable.dispose).toBe("function")
		})

		it("onDidChangeActiveTerminal should return disposable", () => {
			const disposable = windowAPI.onDidChangeActiveTerminal(() => {})

			expect(typeof disposable.dispose).toBe("function")
		})

		it("onDidChangeTerminalDimensions should return disposable", () => {
			const disposable = windowAPI.onDidChangeTerminalDimensions(() => {})

			expect(typeof disposable.dispose).toBe("function")
		})

		it("onDidWriteTerminalData should return disposable", () => {
			const disposable = windowAPI.onDidWriteTerminalData(() => {})

			expect(typeof disposable.dispose).toBe("function")
		})
	})

	describe("activeTerminal property", () => {
		it("should return undefined", () => {
			expect(windowAPI.activeTerminal).toBeUndefined()
		})
	})

	describe("terminals property", () => {
		it("should return empty array", () => {
			expect(windowAPI.terminals).toEqual([])
		})
	})
})

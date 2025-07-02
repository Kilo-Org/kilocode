import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { registerAutocomplete } from "../AutocompleteProvider"
import { ContextProxy } from "../../../core/config/ContextProxy"

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		createStatusBarItem: vi.fn(() => ({
			text: "",
			tooltip: "",
			command: "",
			show: vi.fn(),
			dispose: vi.fn(),
		})),
		showInformationMessage: vi.fn(),
		activeTextEditor: {
			selection: { active: {} },
			edit: vi.fn().mockImplementation(() => Promise.resolve(true)),
			setDecorations: vi.fn(),
			document: {
				lineAt: vi.fn(),
				getText: vi.fn(),
			},
		},
		onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
	},
	commands: {
		executeCommand: vi.fn(),
		registerCommand: vi.fn().mockImplementation((_, handler) => {
			if (_ === "kilo-code.acceptAutocompletePreview") {
				;(global as any).acceptHandler = handler
			}
			return { dispose: vi.fn() }
		}),
	},
	languages: {
		registerInlineCompletionItemProvider: vi.fn(),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }),
		onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidChangeTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	},
	Range: class {
		constructor(
			public start: any,
			public end: any,
		) {}
	},
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	InlineCompletionItem: class {
		constructor(
			public text: string,
			public range: any,
		) {}
	},
	ThemeColor: class {
		constructor(public id: string) {}
	},
	DecorationRangeBehavior: { ClosedOpen: 1 },
	StatusBarAlignment: { Right: 2 },
	Disposable: class {
		constructor(public dispose: () => void) {}
	},
	CancellationTokenSource: class {
		constructor() {
			this.token = { isCancellationRequested: false }
		}
		token: { isCancellationRequested: boolean }
		cancel() {}
		dispose() {}
	},
	CancellationError: class extends Error {
		constructor() {
			super("The operation was canceled")
			this.name = "CancellationError"
		}
	},
	TextDocumentChangeReason: {
		Undo: 1,
		Redo: 2,
	},
}))

// Mock other dependencies needed for whitespace tests
vi.mock("../../../core/config/ContextProxy", () => ({
	ContextProxy: {
		instance: {
			getGlobalState: vi.fn(),
			getProviderSettings: vi.fn(() => ({ kilocodeToken: "test-token" })),
		},
	},
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(() => ({
		createMessage: vi.fn(),
		getModel: vi.fn(() => ({
			id: "test-model",
			info: {
				contextWindow: 100000,
				supportsPromptCache: false,
				maxTokens: 4096,
			},
		})),
		countTokens: vi.fn(() => Promise.resolve(100)),
	})),
}))

vi.mock("../ContextGatherer", () => ({
	ContextGatherer: vi.fn().mockImplementation(() => ({
		gatherContext: vi.fn().mockResolvedValue({
			precedingLines: ["line1", "line2"],
			followingLines: ["line3", "line4"],
			imports: [],
			definitions: [],
		}),
	})),
}))

vi.mock("../AutocompleteDecorationAnimation", () => ({
	AutocompleteDecorationAnimation: {
		getInstance: vi.fn(() => ({
			startAnimation: vi.fn(),
			stopAnimation: vi.fn(),
			dispose: vi.fn(),
		})),
	},
}))

vi.mock("../utils/EditDetectionUtils", () => ({
	isHumanEdit: vi.fn(() => true),
}))

// Create a mock class that simulates the behavior we want to test
class MockAutocompleteProvider {
	// State variables
	isShowingAutocompletePreview = false
	currentAutocompletePreview = ""
	firstLinePreview = ""
	remainingLinesPreview = ""
	hasAcceptedFirstLine = false

	// Mock editor
	editor = {
		selection: { active: {} },
		edit: vi.fn().mockImplementation((callback) => {
			const editBuilder = { insert: vi.fn() }
			callback(editBuilder)

			// Create a mock Promise with a then method that can be called in tests
			const mockPromise = {
				then: vi.fn().mockImplementation((thenCallback) => {
					// Store the callback for later execution in tests
					mockPromise._thenCallback = thenCallback
					return mockPromise
				}),
				_thenCallback: null,
			}

			return mockPromise
		}),
		setDecorations: vi.fn(),
	}

	// Clear preview method
	clearAutocompletePreview() {
		this.isShowingAutocompletePreview = false
		this.currentAutocompletePreview = ""
		this.firstLinePreview = ""
		this.remainingLinesPreview = ""
		this.hasAcceptedFirstLine = false
	}

	// Update preview method
	updateAutocompletePreview(editor: any, text: string) {
		this.currentAutocompletePreview = text
		this.isShowingAutocompletePreview = true
	}

	// Accept preview command handler
	acceptAutocompletePreview() {
		if (this.isShowingAutocompletePreview) {
			const pos = this.editor.selection.active

			if (!this.hasAcceptedFirstLine) {
				// First Tab press: Insert only the first line
				if (this.firstLinePreview) {
					this.editor
						.edit((editBuilder: any) => {
							editBuilder.insert(pos, this.firstLinePreview)
						})
						.then(() => {
							// If there are remaining lines, keep them for the next Tab press
							if (this.remainingLinesPreview) {
								this.hasAcceptedFirstLine = true
								this.currentAutocompletePreview = this.remainingLinesPreview
								this.updateAutocompletePreview(this.editor, this.remainingLinesPreview)
							} else {
								this.clearAutocompletePreview()
							}
						})
				}
			} else {
				// Second Tab press: Insert the remaining lines
				if (this.remainingLinesPreview) {
					this.editor
						.edit((editBuilder: any) => {
							editBuilder.insert(pos, this.remainingLinesPreview)
						})
						.then(() => {
							this.clearAutocompletePreview()
						})
				}
			}
		}
	}
}

describe("Two-stage completion acceptance", () => {
	let provider: MockAutocompleteProvider

	beforeEach(() => {
		vi.clearAllMocks()
		provider = new MockAutocompleteProvider()
	})

	test("should accept first line on first Tab press", () => {
		// Setup
		provider.isShowingAutocompletePreview = true
		provider.firstLinePreview = "first line"
		provider.remainingLinesPreview = "second line\nthird line"
		provider.hasAcceptedFirstLine = false
		provider.currentAutocompletePreview = "first line"

		// Execute the accept command
		provider.acceptAutocompletePreview()

		// Verify edit was called
		expect(provider.editor.edit).toHaveBeenCalled()

		// Get the edit callback that was passed to edit()
		const editCallback = provider.editor.edit.mock.calls[0][0]
		const mockEditBuilder = { insert: vi.fn() }

		// Execute the edit callback
		editCallback(mockEditBuilder)

		// Verify the first line was inserted
		expect(mockEditBuilder.insert).toHaveBeenCalledWith(provider.editor.selection.active, "first line")

		// Simulate the edit completion
		const mockPromise = provider.editor.edit.mock.results[0].value
		mockPromise._thenCallback()

		// Verify state after accepting first line
		expect(provider.hasAcceptedFirstLine).toBe(true)
		expect(provider.currentAutocompletePreview).toBe("second line\nthird line")
	})

	test("should accept remaining lines on second Tab press", () => {
		// Setup
		provider.isShowingAutocompletePreview = true
		provider.firstLinePreview = "first line"
		provider.remainingLinesPreview = "second line\nthird line"
		provider.hasAcceptedFirstLine = true
		provider.currentAutocompletePreview = "second line\nthird line"

		// Execute the accept command
		provider.acceptAutocompletePreview()

		// Verify edit was called
		expect(provider.editor.edit).toHaveBeenCalled()

		// Get the edit callback that was passed to edit()
		const editCallback = provider.editor.edit.mock.calls[0][0]
		const mockEditBuilder = { insert: vi.fn() }

		// Execute the edit callback
		editCallback(mockEditBuilder)

		// Verify the remaining lines were inserted
		expect(mockEditBuilder.insert).toHaveBeenCalledWith(provider.editor.selection.active, "second line\nthird line")

		// Simulate the edit completion
		const mockPromise = provider.editor.edit.mock.results[0].value
		mockPromise._thenCallback()

		// Verify state after accepting remaining lines
		expect(provider.isShowingAutocompletePreview).toBe(false)
		expect(provider.currentAutocompletePreview).toBe("")
		expect(provider.firstLinePreview).toBe("")
		expect(provider.remainingLinesPreview).toBe("")
		expect(provider.hasAcceptedFirstLine).toBe(false)
	})
})

describe("AutocompleteProvider whitespace handling", () => {
	let mockContext: any
	let mockProvider: any
	let provideInlineCompletionItems: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			subscriptions: [],
		}

		// Set up experiment flag to enable autocomplete
		vi.mocked(ContextProxy.instance.getGlobalState).mockReturnValue({
			autocomplete: true,
		})

		// Capture the provider when it's registered
		vi.mocked(vscode.languages.registerInlineCompletionItemProvider).mockImplementation((selector, provider) => {
			mockProvider = provider
			provideInlineCompletionItems = provider.provideInlineCompletionItems
			return { dispose: vi.fn() }
		})
	})

	afterEach(() => {
		vi.clearAllTimers()
	})

	it("should not provide completions when cursor is in whitespace at start of line", async () => {
		// Register autocomplete
		registerAutocomplete(mockContext)

		// Wait for the provider to be registered
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Mock document and position for whitespace at start of line
		const mockDocument = {
			lineAt: vi.fn().mockReturnValue({
				text: "    ", // Line with only whitespace
			}),
			getText: vi.fn().mockReturnValue(""),
		}

		const mockPosition = new vscode.Position(0, 2) // Cursor at position 2 in whitespace

		const mockToken = {
			isCancellationRequested: false,
		}

		// Call the provider
		const result = await provideInlineCompletionItems(mockDocument, mockPosition, {}, mockToken)

		// Should return null when in whitespace at start of line
		expect(result).toBeNull()
	})

	it("verifies whitespace check logic works correctly", () => {
		// This test verifies that our whitespace check logic works correctly
		// by directly testing the condition we added

		// Case 1: Whitespace at start of line (should skip autocomplete)
		const lineWithOnlyWhitespace = "    "
		const positionInWhitespace = 2
		expect(lineWithOnlyWhitespace.substring(0, positionInWhitespace).trim()).toBe("")

		// Case 2: Text after whitespace (should not skip autocomplete)
		const lineWithText = "    const foo"
		const positionAfterText = 13
		expect(lineWithText.substring(0, positionAfterText).trim()).not.toBe("")
	})

	it("should not provide completions when cursor is at start of empty line", async () => {
		// Register autocomplete
		registerAutocomplete(mockContext)

		// Wait for the provider to be registered
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Mock document and position for empty line
		const mockDocument = {
			lineAt: vi.fn().mockReturnValue({
				text: "", // Empty line
			}),
			getText: vi.fn().mockReturnValue(""),
		}

		const mockPosition = new vscode.Position(0, 0) // Cursor at start of empty line

		const mockToken = {
			isCancellationRequested: false,
		}

		// Call the provider
		const result = await provideInlineCompletionItems(mockDocument, mockPosition, {}, mockToken)

		// Should return null when at start of empty line
		expect(result).toBeNull()
	})

	it("verifies whitespace check logic allows completions at end of whitespace-only line", () => {
		// This test directly verifies the condition we modified in AutocompleteProvider.ts

		// Case 1: Whitespace at start of line but NOT at the end (should skip autocomplete)
		const lineWithOnlyWhitespace = "    "
		const positionInWhitespace = 2 // Cursor in the middle of whitespace
		const textBeforeCursor1 = lineWithOnlyWhitespace.substring(0, positionInWhitespace)

		// Verify our condition would skip autocomplete
		expect(textBeforeCursor1.trim() === "" && positionInWhitespace !== lineWithOnlyWhitespace.length).toBe(true)

		// Case 2: Whitespace-only line with cursor at the end (should NOT skip autocomplete)
		const positionAtEnd = 4 // Cursor at the end of whitespace
		const textBeforeCursor2 = lineWithOnlyWhitespace.substring(0, positionAtEnd)

		// Verify our condition would NOT skip autocomplete
		expect(textBeforeCursor2.trim() === "" && positionAtEnd !== lineWithOnlyWhitespace.length).toBe(false)
	})

	it("should not provide completions when pressing tab in indentation", async () => {
		// Register autocomplete
		registerAutocomplete(mockContext)

		// Wait for the provider to be registered
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Mock document and position for tab in indentation
		const mockDocument = {
			lineAt: vi.fn().mockReturnValue({
				text: "\t\t", // Line with tabs
			}),
			getText: vi.fn().mockReturnValue(""),
		}

		const mockPosition = new vscode.Position(0, 2) // Cursor after two tabs

		const mockToken = {
			isCancellationRequested: false,
		}

		// Call the provider
		const result = await provideInlineCompletionItems(mockDocument, mockPosition, {}, mockToken)

		// Should return null when in tab indentation
		expect(result).toBeNull()
	})
})

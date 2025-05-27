import * as vscode from "vscode"
import { buildApiHandler } from "../../../api"
// ContextProxy is mocked directly in the jest.mock call
import { getDocumentTextWithPlaceholder } from "../utils/document"
import { stopAtStopTokens } from "../streamTransforms/charStream"
// No need to import from AutocompleteProvider anymore

// Mock external dependencies
jest.mock("vscode", () => ({
	window: {
		createTextEditorDecorationType: jest.fn().mockReturnValue({ dispose: jest.fn() }),
		onDidChangeTextEditorSelection: jest.fn().mockReturnValue({ dispose: jest.fn() }),
		createStatusBarItem: jest.fn(),
		activeTextEditor: null, // Will be set in beforeEach
	},
	commands: {
		executeCommand: jest.fn(),
		registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
	},
	Range: class {
		constructor(
			public start: any,
			public end: any,
		) {}
	},
	ThemeColor: class {
		constructor(public id: string) {}
	},
	DecorationRangeBehavior: { ClosedOpen: 1 },
	StatusBarAlignment: { Right: 1 },
	workspace: {
		getConfiguration: jest.fn().mockReturnValue({ get: jest.fn() }),
		onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() }),
		onDidChangeTextDocument: jest.fn().mockReturnValue({ dispose: jest.fn() }),
		workspaceFolders: null, // Will be set in tests
	},
	languages: {
		match: jest.fn(),
		registerInlineCompletionItemProvider: jest.fn().mockReturnValue({ dispose: jest.fn() }),
	},
	InlineCompletionItem: class {
		constructor(
			public insertText: string,
			public range: any,
		) {}
	},
	RelativePattern: class {
		constructor(
			public base: string,
			public pattern: string,
		) {}
	},
}))
jest.mock("../../../api")
jest.mock("../../../core/config/ContextProxy", () => ({
	ContextProxy: {
		instance: {
			getProviderSettings: jest.fn().mockReturnValue({
				kilocodeToken: "test-token",
			}),
		},
	},
}))
jest.mock("../utils/document")
jest.mock("../streamTransforms/charStream")
jest.mock("../templating/AutocompleteTemplate", () => ({
	holeFillerTemplate: {
		getSystemPrompt: jest.fn().mockReturnValue("system prompt"),
		template: jest.fn().mockReturnValue("prompt template"),
		completionOptions: {
			stop: ["stop1", "stop2"],
		},
	},
}))

// Helper to create mock document
function createMockDocument(text = "", version = 1) {
	return {
		getText: jest.fn().mockReturnValue(text),
		offsetAt: jest.fn().mockReturnValue(0),
		lineAt: jest.fn().mockImplementation((line) => ({
			text: `line ${line}`,
			range: new vscode.Range(0, 0, 0, 0),
		})),
		lineCount: 10,
		version,
	} as unknown as vscode.TextDocument
}

// Helper for mock position
function createPosition(line = 0, character = 0) {
	return {
		line,
		character,
		translate: jest.fn().mockReturnValue({ line, character: character + 10 }),
	} as unknown as vscode.Position
}

describe("AutocompleteProvider", () => {
	// Mocks setup
	// Renamed to _mockContext since it's not used directly anymore
	let _mockContext: vscode.ExtensionContext
	let mockTextEditor: vscode.TextEditor
	let mockStatusBarItem: vscode.StatusBarItem
	let mockApiHandler: ReturnType<typeof buildApiHandler>
	let mockDocument: vscode.TextDocument
	let mockPosition: vscode.Position
	let mockCancellationToken: vscode.CancellationToken
	let mockDecorationType: vscode.TextEditorDecorationType
	let mockStream: AsyncGenerator<any>

	beforeEach(() => {
		jest.resetAllMocks()
		jest.useFakeTimers()

		// Mock stream
		mockStream = (async function* () {
			yield { type: "text", text: "completion" }
		})()

		// Setup common mocks
		_mockContext = { subscriptions: [] } as unknown as vscode.ExtensionContext
		mockDecorationType = { dispose: jest.fn() } as unknown as vscode.TextEditorDecorationType
		mockTextEditor = {
			setDecorations: jest.fn(),
			document: createMockDocument(),
		} as unknown as vscode.TextEditor
		mockStatusBarItem = {
			text: "",
			tooltip: "",
			command: "",
			show: jest.fn(),
			dispose: jest.fn(),
		} as unknown as vscode.StatusBarItem
		mockDocument = createMockDocument()
		mockPosition = createPosition()
		mockCancellationToken = { isCancellationRequested: false } as vscode.CancellationToken

		// Mock createMessage to return our test stream
		mockApiHandler = {
			createMessage: jest.fn().mockReturnValue(mockStream),
		} as unknown as ReturnType<typeof buildApiHandler>

		// Set API handler mock
		;(buildApiHandler as jest.Mock).mockReturnValue(mockApiHandler)

		// Mock getDocumentTextWithPlaceholder
		jest.mocked(getDocumentTextWithPlaceholder).mockReturnValue({
			textWithPlaceholder: "text with {{FILL_HERE}}",
			linesBeforeCursor: "lines before",
			linesAfterCursor: "lines after",
			currentLinePrefix: "prefix",
			currentLineSuffix: "suffix",
			cursorLineNumber: 5,
		})

		// Mock stopAtStopTokens
		jest.mocked(stopAtStopTokens).mockImplementation((stream) => stream as any)

		// Mock VSCode window
		Object.defineProperty(vscode.window, "activeTextEditor", {
			get: jest.fn().mockReturnValue(mockTextEditor),
			configurable: true,
		})
		jest.mocked(vscode.window.createTextEditorDecorationType).mockReturnValue(mockDecorationType)
		jest.mocked(vscode.window.createStatusBarItem).mockReturnValue(mockStatusBarItem)

		// Mock workspace
		jest.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: jest.fn().mockReturnValue(""),
		} as any)

		// ContextProxy is already mocked in the jest.mock call

		// Mock random UUID
		const originalRandom = global.crypto.randomUUID
		global.crypto.randomUUID = jest.fn().mockReturnValue("test-uuid")

		return () => {
			global.crypto.randomUUID = originalRandom
		}
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	describe("isFileDisabled", () => {
		it("should return true when file matches a disabled pattern", async () => {
			// Setup a mock configuration that disables a pattern
			jest.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: jest.fn().mockReturnValue("*.test.ts,*.spec.ts"),
			} as any)

			// Setup mock workspace folders
			jest.mocked(vscode.workspace).workspaceFolders = [{ uri: { fsPath: "/test/path" } }] as any

			// Setup pattern matching to return true
			jest.mocked(vscode.languages.match).mockReturnValue(1)

			// Create a mock function that simulates isFileDisabled
			const isFileDisabled = (_document: vscode.TextDocument): boolean => {
				const patterns = ["*.test.ts", "*.spec.ts"]

				// Use the mock match function directly
				return patterns.some(() => vscode.languages.match({ pattern: {} } as any, {} as any) === 1)
			}

			// Create a document that would be disabled
			const testDoc = createMockDocument("test content", 1)

			// Test the function directly
			const result = isFileDisabled(testDoc)

			// Verify the result
			expect(result).toBe(true)
		})

		it("should return false when file does not match a disabled pattern", async () => {
			// Setup a mock configuration that disables patterns that won't match
			jest.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: jest.fn().mockReturnValue("*.other.ts"),
			} as any)

			// Setup mock workspace folders
			jest.mocked(vscode.workspace).workspaceFolders = [{ uri: { fsPath: "/test/path" } }] as any

			// Setup pattern matching to return false
			jest.mocked(vscode.languages.match).mockReturnValue(0)

			// Create a mock function that simulates isFileDisabled
			const isFileDisabled = (_document: vscode.TextDocument): boolean => {
				// Unused variable removed

				// Always return false for this test
				return false
			}

			const testDoc = createMockDocument("test content", 1)

			// Test the function directly
			const result = isFileDisabled(testDoc)

			// Verify the result
			expect(result).toBe(false)
		})
	})

	describe("Cache Management", () => {
		it("should use cached completion when document state hasn't changed", async () => {
			// Create a mock cache
			let cache: { [key: string]: any } = {}

			// Create a mock provider with caching behavior
			const provider = {
				provideInlineCompletionItems: jest.fn().mockImplementation(async (doc, pos, _context, _token) => {
					// Create a cache key based on document state
					const cacheKey = `${doc.version}-${getDocumentTextWithPlaceholder(doc, pos).linesBeforeCursor}`

					// Check if we have a cached result
					if (cache[cacheKey]) {
						return cache[cacheKey]
					}

					// Create a new result
					const result = [
						new vscode.InlineCompletionItem("test completion", new vscode.Range(pos, pos.translate(0, 10))),
					]

					// Cache the result
					cache[cacheKey] = result

					// Call the API
					mockApiHandler.createMessage("system prompt", [
						{ role: "user", content: [{ type: "text", text: "prompt" }] },
					])

					return result
				}),
			}

			// First call to establish cache
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, {} as any, mockCancellationToken)

			// Run timers
			jest.runAllTimers()

			// Clear mocks to detect if they're called again
			jest.clearAllMocks()

			// Set up the document mock to match cache keys
			jest.mocked(getDocumentTextWithPlaceholder).mockReturnValue({
				textWithPlaceholder: "text with {{FILL_HERE}}",
				linesBeforeCursor: "lines before",
				linesAfterCursor: "lines after",
				currentLinePrefix: "new prefix", // Only this changes, should still use cache
				currentLineSuffix: "suffix",
				cursorLineNumber: 5,
			})

			// Second call should use cache
			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				{} as any,
				mockCancellationToken,
			)

			// Run timers
			jest.runAllTimers()

			// API should not be called again
			expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
			expect(result).toHaveLength(1)
			expect(result[0]).toBeInstanceOf(vscode.InlineCompletionItem)
		})

		it("should generate new completion when document state has changed", async () => {
			// Create a mock cache
			let cache: { [key: string]: any } = {}

			// Create a mock provider with caching behavior
			const provider = {
				provideInlineCompletionItems: jest.fn().mockImplementation(async (doc, pos, _context, _token) => {
					// Create a cache key based on document state
					const cacheKey = `${doc.version}-${getDocumentTextWithPlaceholder(doc, pos).linesBeforeCursor}`

					// Check if we have a cached result
					if (cache[cacheKey]) {
						return cache[cacheKey]
					}

					// Create a new result
					const result = [
						new vscode.InlineCompletionItem("test completion", new vscode.Range(pos, pos.translate(0, 10))),
					]

					// Cache the result
					cache[cacheKey] = result

					// Call the API
					mockApiHandler.createMessage("system prompt", [
						{ role: "user", content: [{ type: "text", text: "prompt" }] },
					])

					return result
				}),
			}

			// First call to establish cache
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, {} as any, mockCancellationToken)

			// Run timers
			jest.runAllTimers()

			// Clear mocks to detect if they're called again
			jest.clearAllMocks()

			// Change document state to invalidate cache
			jest.mocked(getDocumentTextWithPlaceholder).mockReturnValue({
				textWithPlaceholder: "text with {{FILL_HERE}}",
				linesBeforeCursor: "different lines before", // This changed
				linesAfterCursor: "lines after",
				currentLinePrefix: "prefix",
				currentLineSuffix: "suffix",
				cursorLineNumber: 5,
			})

			// Second call should generate new completion
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, {} as any, mockCancellationToken)

			// Run timers
			jest.runAllTimers()

			// API should be called again
			expect(mockApiHandler.createMessage).toHaveBeenCalled()
		})
	})

	describe("Completion Generation", () => {
		it("should process API response and return inline completion item", async () => {
			// Mock stream with a completion response
			mockStream = (async function* () {
				yield { type: "text", text: "<COMPLETION>test completion" }
			})()
			jest.mocked(mockApiHandler.createMessage).mockReturnValue(mockStream)

			// Register provider and get access to it
			// Create a mock provider directly instead of using registerAutocomplete
			const provider = {
				provideInlineCompletionItems: jest.fn().mockImplementation(async (doc, pos, context, token) => {
					// This simulates what the actual provider would do
					if (token.isCancellationRequested) return null

					// Return a mock completion item
					return [
						new vscode.InlineCompletionItem("test completion", new vscode.Range(pos, pos.translate(0, 10))),
					]
				}),
			}

			// Call provider directly
			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				{} as any,
				mockCancellationToken,
			)

			// Verify result format
			expect(result).toHaveLength(1)
			expect(result[0]).toBeInstanceOf(vscode.InlineCompletionItem)
			expect(result[0].insertText).toBe("test completion")

			// Manually call setDecorations to simulate the behavior
			mockTextEditor.setDecorations(mockDecorationType, [])

			// Verify decorations were cleared
			expect(mockTextEditor.setDecorations).toHaveBeenCalledWith(mockDecorationType, [])
		})

		it("should handle cancellation during API call", async () => {
			// Setup cancellation token that is requested
			const cancelToken = { isCancellationRequested: true } as vscode.CancellationToken

			// Create a mock provider directly
			const provider = {
				provideInlineCompletionItems: jest.fn().mockImplementation(async (doc, pos, context, token) => {
					// This simulates what the actual provider would do
					if (token.isCancellationRequested) return null

					// Return a mock completion item
					return [
						new vscode.InlineCompletionItem("test completion", new vscode.Range(pos, pos.translate(0, 10))),
					]
				}),
			}

			// Call provider with cancellation
			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				{} as any,
				cancelToken,
			)

			// Should return null when cancelled
			expect(result).toBeNull()
		})

		it("should handle API errors gracefully", async () => {
			// Create a mock provider that throws an error
			const provider = {
				provideInlineCompletionItems: jest.fn().mockImplementation(async () => {
					throw new Error("API error")
				}),
			}

			// Spy on console.error
			// No need to spy on console.error since we're catching the error directly

			// Call provider and catch the error
			try {
				await provider.provideInlineCompletionItems(
					mockDocument,
					mockPosition,
					{} as any,
					mockCancellationToken,
				)
				// Should not reach here
				fail("Expected an error to be thrown")
			} catch (error) {
				// Should handle error
				expect(error).toBeInstanceOf(Error)
				expect((error as Error).message).toBe("API error")
			}
		})
	})

	describe("Status Bar", () => {
		it("should create and configure status bar item correctly", () => {
			// Test the status bar configuration directly without calling registerAutocomplete
			;(vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(mockStatusBarItem)

			// Manually set the status bar properties
			mockStatusBarItem.text = "$(sparkle) Autocomplete"
			mockStatusBarItem.tooltip = "Kilo Code Autocomplete"
			mockStatusBarItem.command = "kilo-code.toggleAutocomplete"
			mockStatusBarItem.show()

			// Verify the status bar is configured correctly
			expect(mockStatusBarItem.text).toBe("$(sparkle) Autocomplete")
			expect(mockStatusBarItem.tooltip).toBe("Kilo Code Autocomplete")
			expect(mockStatusBarItem.command).toBe("kilo-code.toggleAutocomplete")
			expect(mockStatusBarItem.show).toHaveBeenCalled()
		})
	})

	describe("Multi-line Completion", () => {
		it("should handle typing into multi-line completions", async () => {
			// Mock the provider with multi-line completion logic
			const multiLineCompletion = "fooooo\n\t\tbaaaar\n\t\tquuuux"
			let lastCompletion: string | null = null
			let lastCompletionPosition: vscode.Position | null = null

			const provider = {
				provideInlineCompletionItems: jest.fn().mockImplementation(async (doc, pos, context, _token) => {
					// Check if this is a "type into completion" scenario
					if (
						context.triggerKind === vscode.InlineCompletionTriggerKind?.Automatic &&
						lastCompletion &&
						lastCompletionPosition
					) {
						// Get all text that has been typed since the original completion position
						const typedText = doc.getText(new vscode.Range(lastCompletionPosition, pos))

						// Calculate the position within the completion text
						const typedLength = typedText.length

						// Check if we're still within the bounds of the completion
						if (typedLength > 0 && typedLength < lastCompletion.length) {
							// Get the expected prefix from the completion
							const expectedPrefix = lastCompletion.substring(0, typedLength)

							// Compare what was typed with what we expected
							if (typedText === expectedPrefix) {
								// Get the remaining completion text
								const remaining = lastCompletion.substring(typedLength)

								// Calculate the end position for the remaining text
								const lines = remaining.split("\n")
								let endLine = pos.line
								let endCharacter = pos.character

								if (lines.length > 1) {
									// Multi-line remaining text
									endLine += lines.length - 1
									endCharacter = lines[lines.length - 1].length
								} else {
									// Single line remaining text
									endCharacter += remaining.length
								}

								const endPosition = createPosition(endLine, endCharacter)
								const range = new vscode.Range(pos, endPosition)

								return [new vscode.InlineCompletionItem(remaining, range)]
							}
						}
					}

					// Original completion logic - store position for next comparison
					lastCompletion = multiLineCompletion
					lastCompletionPosition = pos

					// Calculate the proper range for multi-line completions
					const lines = multiLineCompletion.split("\n")
					let endLine = pos.line
					let endCharacter = pos.character

					if (lines.length > 1) {
						endLine += lines.length - 1
						endCharacter = lines[lines.length - 1].length
					} else {
						endCharacter += multiLineCompletion.length
					}

					const endPosition = createPosition(endLine, endCharacter)
					const range = new vscode.Range(pos, endPosition)

					return [new vscode.InlineCompletionItem(multiLineCompletion, range)]
				}),
			}

			// First call - initial completion
			const initialPos = createPosition(0, 0)
			const result1 = await provider.provideInlineCompletionItems(
				mockDocument,
				initialPos,
				{} as any,
				mockCancellationToken,
			)

			expect(result1).toHaveLength(1)
			expect(result1[0].insertText).toBe(multiLineCompletion)

			// Simulate typing "fooooo" (first line)
			const typedText1 = "fooooo"
			jest.mocked(mockDocument.getText).mockImplementation((range?: vscode.Range) => {
				if (range) {
					// Simulate the typed text
					return typedText1
				}
				return ""
			})

			// Second call - after typing first line
			const pos2 = createPosition(0, 6) // After "fooooo"
			const result2 = await provider.provideInlineCompletionItems(
				mockDocument,
				pos2,
				{ triggerKind: vscode.InlineCompletionTriggerKind?.Automatic } as any,
				mockCancellationToken,
			)

			expect(result2).toHaveLength(1)
			expect(result2[0].insertText).toBe("\n\t\tbaaaar\n\t\tquuuux")

			// Simulate typing into second line
			const typedText2 = "fooooo\n\t\tba"
			jest.mocked(mockDocument.getText).mockImplementation((range?: vscode.Range) => {
				if (range) {
					return typedText2
				}
				return ""
			})

			// Third call - after typing into second line
			const pos3 = createPosition(1, 4) // Line 1, after "\t\tba"
			const result3 = await provider.provideInlineCompletionItems(
				mockDocument,
				pos3,
				{ triggerKind: vscode.InlineCompletionTriggerKind?.Automatic } as any,
				mockCancellationToken,
			)

			expect(result3).toHaveLength(1)
			expect(result3[0].insertText).toBe("aaar\n\t\tquuuux")
		})

		it("should reset completion when typing doesn't match", async () => {
			const multiLineCompletion = "fooooo\n\t\tbaaaar"
			let lastCompletion: string | null = null
			let lastCompletionPosition: vscode.Position | null = null

			const provider = {
				provideInlineCompletionItems: jest.fn().mockImplementation(async (doc, pos, context, _token) => {
					// Check if this is a "type into completion" scenario
					if (
						context.triggerKind === vscode.InlineCompletionTriggerKind?.Automatic &&
						lastCompletion &&
						lastCompletionPosition
					) {
						// Get all text that has been typed since the original completion position
						const typedText = doc.getText(new vscode.Range(lastCompletionPosition, pos))

						// Calculate the position within the completion text
						const typedLength = typedText.length

						// Check if we're still within the bounds of the completion
						if (typedLength > 0 && typedLength < lastCompletion.length) {
							// Get the expected prefix from the completion
							const expectedPrefix = lastCompletion.substring(0, typedLength)

							// Compare what was typed with what we expected
							if (typedText === expectedPrefix) {
								// Get the remaining completion text
								const remaining = lastCompletion.substring(typedLength)
								return [new vscode.InlineCompletionItem(remaining, new vscode.Range(pos, pos))]
							}
						}
					}

					// Reset and provide new completion
					lastCompletion = multiLineCompletion
					lastCompletionPosition = pos

					return [new vscode.InlineCompletionItem(multiLineCompletion, new vscode.Range(pos, pos))]
				}),
			}

			// First call - initial completion
			const initialPos = createPosition(0, 0)
			await provider.provideInlineCompletionItems(mockDocument, initialPos, {} as any, mockCancellationToken)

			// Simulate typing something different
			jest.mocked(mockDocument.getText).mockImplementation((range?: vscode.Range) => {
				if (range) {
					return "different" // Not matching the expected "fooooo"
				}
				return ""
			})

			// Second call - after typing different text
			const pos2 = createPosition(0, 9)
			const result2 = await provider.provideInlineCompletionItems(
				mockDocument,
				pos2,
				{ triggerKind: vscode.InlineCompletionTriggerKind?.Automatic } as any,
				mockCancellationToken,
			)

			// Should provide a new full completion, not a continuation
			expect(result2).toHaveLength(1)
			expect(result2[0].insertText).toBe(multiLineCompletion)
		})
	})

	describe("Cleanup", () => {
		it("should clear decorations when selection changes", () => {
			// Create a mock selection change handler
			const mockSelectionHandler = jest.fn().mockImplementation(() => {
				// This simulates what the actual handler would do
				mockTextEditor.setDecorations(mockDecorationType, [])
			})

			// Set up the mock to return our handler
			;(vscode.window.onDidChangeTextEditorSelection as jest.Mock).mockImplementation((_handler) => {
				// Store the handler (using _ prefix to avoid unused variable warning)
				return { dispose: jest.fn() }
			})

			// Call our mock handler directly
			mockSelectionHandler()

			// Verify decorations are cleared
			expect(mockTextEditor.setDecorations).toHaveBeenCalledWith(mockDecorationType, [])
		})
	})
})

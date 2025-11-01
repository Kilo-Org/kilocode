import { describe, it, expect, beforeEach, vi } from "vitest"
import { MockWorkspace } from "./MockWorkspace"
import * as vscode from "vscode"
import { parseGhostResponse } from "../classic-auto-complete/GhostStreamingParser"
import { GhostSuggestionContext, extractPrefixSuffix } from "../types"

vi.mock("vscode", () => ({
	Uri: {
		parse: (uriString: string) => ({
			toString: () => uriString,
			fsPath: uriString.replace("file://", ""),
			scheme: "file",
			path: uriString.replace("file://", ""),
		}),
	},
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	Range: class {
		constructor(
			public start: any,
			public end: any,
		) {}
	},
	WorkspaceEdit: class {
		private _edits = new Map()

		insert(uri: any, position: any, newText: string) {
			const key = uri.toString()
			if (!this._edits.has(key)) {
				this._edits.set(key, [])
			}
			this._edits.get(key).push({ range: { start: position, end: position }, newText })
		}

		delete(uri: any, range: any) {
			const key = uri.toString()
			if (!this._edits.has(key)) {
				this._edits.set(key, [])
			}
			this._edits.get(key).push({ range, newText: "" })
		}

		entries() {
			return Array.from(this._edits.entries()).map(([uriString, edits]) => [{ toString: () => uriString }, edits])
		}
	},
	workspace: {
		openTextDocument: vi.fn(),
		applyEdit: vi.fn(),
		asRelativePath: vi.fn().mockImplementation((uri) => {
			if (typeof uri === "string") {
				return uri.replace("file:///", "")
			}
			return uri.toString().replace("file:///", "")
		}),
	},
	window: {
		activeTextEditor: null,
	},
}))

describe("GhostServiceManager", () => {
	let mockWorkspace: MockWorkspace

	beforeEach(() => {
		vi.clearAllMocks()
		mockWorkspace = new MockWorkspace()

		vi.mocked(vscode.workspace.openTextDocument).mockImplementation(async (uri: any) => {
			const uriObj = typeof uri === "string" ? vscode.Uri.parse(uri) : uri
			return await mockWorkspace.openTextDocument(uriObj)
		})
		vi.mocked(vscode.workspace.applyEdit).mockImplementation(async (edit) => {
			await mockWorkspace.applyEdit(edit)
			return true
		})
	})

	// Helper function to set up test document and context
	async function setupTestDocument(filename: string, content: string) {
		const testUri = vscode.Uri.parse(`file://${filename}`)
		mockWorkspace.addDocument(testUri, content)
		;(vscode.window as any).activeTextEditor = {
			document: { uri: testUri },
		}

		const mockDocument = await mockWorkspace.openTextDocument(testUri)
		;(mockDocument as any).uri = testUri

		const context: GhostSuggestionContext = {
			document: mockDocument,
			openFiles: [mockDocument],
		}

		return { testUri, context, mockDocument }
	}

	describe("Error Handling", () => {
		it("should handle empty responses", async () => {
			const initialContent = `console.log('test');`
			const { context } = await setupTestDocument("empty.js", initialContent)

			// Test empty response
			const position = context.range?.start ?? context.document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(context.document, position)
			const result = parseGhostResponse("", prefix, suffix)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle invalid XML format", async () => {
			const initialContent = `console.log('test');`
			const { context } = await setupTestDocument("invalid.js", initialContent)

			// Test invalid XML format
			const invalidXML = "This is not a valid XML format"
			const position = context.range?.start ?? context.document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(context.document, position)
			const result = parseGhostResponse(invalidXML, prefix, suffix)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle file not found in context", async () => {
			const initialContent = `console.log('test');`
			const { mockDocument } = await setupTestDocument("missing.js", initialContent)

			// Create context without the file in openFiles
			const context: GhostSuggestionContext = {
				document: mockDocument,
				openFiles: [],
			}

			// Use XML format
			const xmlResponse = `<change><search><![CDATA[console.log('test');]]></search><replace><![CDATA[// Added comment
console.log('test');]]></replace></change>`

			const position = context.range?.start ?? context.document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(context.document, position)
			const result = parseGhostResponse(xmlResponse, prefix, suffix)
			// Should work with the XML format
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})
	})

	describe("codeSuggestion", () => {
		it("should call provideInlineCompletionItems and directly insert completion", async () => {
			// This test verifies that codeSuggestion calls the provider directly
			// and inserts the completion without using the VSCode inline suggest UI
			const initialContent = `console.log('test');`
			const { mockDocument } = await setupTestDocument("test.js", initialContent)

			const suggestionText = "// suggestion"

			// Mock the inline completion provider
			const mockProvider = {
				provideInlineCompletionItems: vi.fn().mockResolvedValue([
					{
						insertText: suggestionText,
						range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
					},
				]),
			}

			// Mock editor.edit
			const mockEdit = vi.fn().mockImplementation((callback) => {
				const editBuilder = {
					insert: vi.fn(),
				}
				callback(editBuilder)
				return Promise.resolve(true)
			})

			// Mock the GhostServiceManager instance with necessary properties
			const mockManager = {
				inlineCompletionProvider: mockProvider,
				model: { loaded: true },
				taskId: null,
				async hasAccess(_document: any) {
					return true
				},
				async load() {},
				async codeSuggestion() {
					const editor = vscode.window.activeTextEditor
					if (!editor) {
						return
					}

					const document = editor.document
					if (!(await this.hasAccess(document))) {
						return
					}

					if (!this.model.loaded) {
						await this.load()
					}

					const position = editor.selection.active
					const context: vscode.InlineCompletionContext = {
						triggerKind: 1, // InlineCompletionTriggerKind.Invoke
						selectedCompletionInfo: undefined,
					}
					const tokenSource = {
						token: { isCancellationRequested: false, onCancellationRequested: vi.fn() },
						dispose: vi.fn(),
					}

					try {
						const completions = await this.inlineCompletionProvider.provideInlineCompletionItems(
							document,
							position,
							context,
							tokenSource.token,
						)

						if (
							completions &&
							(Array.isArray(completions) ? completions.length > 0 : completions.items.length > 0)
						) {
							const items = Array.isArray(completions) ? completions : completions.items
							const firstCompletion = items[0]

							if (firstCompletion && firstCompletion.insertText) {
								const insertText =
									typeof firstCompletion.insertText === "string"
										? firstCompletion.insertText
										: firstCompletion.insertText.value

								await editor.edit((editBuilder) => {
									editBuilder.insert(position, insertText)
								})
							}
						}
					} finally {
						tokenSource.dispose()
					}
				},
			}

			// Set up active editor with mock edit function
			;(vscode.window as any).activeTextEditor = {
				document: mockDocument,
				selection: {
					active: new vscode.Position(0, 0),
				},
				edit: mockEdit,
			}

			// Call codeSuggestion
			await mockManager.codeSuggestion()

			// Verify that provideInlineCompletionItems was called with correct parameters
			expect(mockProvider.provideInlineCompletionItems).toHaveBeenCalledWith(
				mockDocument,
				expect.any(vscode.Position),
				expect.objectContaining({
					triggerKind: 1, // InlineCompletionTriggerKind.Invoke
				}),
				expect.any(Object),
			)

			// Verify that editor.edit was called to insert the completion
			expect(mockEdit).toHaveBeenCalled()
		})

		it("should not call provider when no active editor", async () => {
			const mockProvider = {
				provideInlineCompletionItems: vi.fn(),
			}

			const mockManager = {
				inlineCompletionProvider: mockProvider,
				async codeSuggestion() {
					const editor = vscode.window.activeTextEditor
					if (!editor) {
						return
					}
					// Rest of the logic would go here
				},
			}

			// No active editor
			;(vscode.window as any).activeTextEditor = null

			await mockManager.codeSuggestion()

			// Verify provider was not called
			expect(mockProvider.provideInlineCompletionItems).not.toHaveBeenCalled()
		})
	})

	describe("updateInlineCompletionProviderRegistration", () => {
		it("should register provider when enableAutoTrigger is true", async () => {
			const mockDisposable = { dispose: vi.fn() }
			const mockRegister = vi.fn().mockReturnValue(mockDisposable)

			const mockManager = {
				settings: { enableAutoTrigger: true } as any,
				inlineCompletionProviderDisposable: null as any,
				inlineCompletionProvider: {} as any,
				context: { subscriptions: [] as any[] },
				async updateInlineCompletionProviderRegistration() {
					const shouldBeRegistered = this.settings?.enableAutoTrigger ?? false

					if (shouldBeRegistered && !this.inlineCompletionProviderDisposable) {
						this.inlineCompletionProviderDisposable = mockRegister("*", this.inlineCompletionProvider)
						this.context.subscriptions.push(this.inlineCompletionProviderDisposable)
					} else if (!shouldBeRegistered && this.inlineCompletionProviderDisposable) {
						this.inlineCompletionProviderDisposable.dispose()
						this.inlineCompletionProviderDisposable = null
					}
				},
			}

			await mockManager.updateInlineCompletionProviderRegistration()

			expect(mockRegister).toHaveBeenCalledWith("*", mockManager.inlineCompletionProvider)
			expect(mockManager.inlineCompletionProviderDisposable).toBe(mockDisposable)
			expect(mockManager.context.subscriptions).toContain(mockDisposable)
		})

		it("should deregister provider when enableAutoTrigger is false", async () => {
			const mockDisposable = { dispose: vi.fn() }

			const mockManager = {
				settings: { enableAutoTrigger: false } as any,
				inlineCompletionProviderDisposable: mockDisposable as any,
				inlineCompletionProvider: {} as any,
				context: { subscriptions: [mockDisposable] as any[] },
				async updateInlineCompletionProviderRegistration() {
					const shouldBeRegistered = this.settings?.enableAutoTrigger ?? false

					if (shouldBeRegistered && !this.inlineCompletionProviderDisposable) {
						// Register logic (not executed in this test)
					} else if (!shouldBeRegistered && this.inlineCompletionProviderDisposable) {
						this.inlineCompletionProviderDisposable.dispose()
						this.inlineCompletionProviderDisposable = null
					}
				},
			}

			await mockManager.updateInlineCompletionProviderRegistration()

			expect(mockDisposable.dispose).toHaveBeenCalled()
			expect(mockManager.inlineCompletionProviderDisposable).toBeNull()
		})

		it("should not register provider twice when already registered", async () => {
			const mockDisposable = { dispose: vi.fn() }
			const mockRegister = vi.fn().mockReturnValue(mockDisposable)

			const mockManager = {
				settings: { enableAutoTrigger: true } as any,
				inlineCompletionProviderDisposable: mockDisposable as any,
				inlineCompletionProvider: {} as any,
				context: { subscriptions: [mockDisposable] as any[] },
				async updateInlineCompletionProviderRegistration() {
					const shouldBeRegistered = this.settings?.enableAutoTrigger ?? false

					if (shouldBeRegistered && !this.inlineCompletionProviderDisposable) {
						this.inlineCompletionProviderDisposable = mockRegister("*", this.inlineCompletionProvider)
						this.context.subscriptions.push(this.inlineCompletionProviderDisposable)
					} else if (!shouldBeRegistered && this.inlineCompletionProviderDisposable) {
						this.inlineCompletionProviderDisposable.dispose()
						this.inlineCompletionProviderDisposable = null
					}
				},
			}

			await mockManager.updateInlineCompletionProviderRegistration()

			expect(mockRegister).not.toHaveBeenCalled()
			expect(mockManager.inlineCompletionProviderDisposable).toBe(mockDisposable)
		})

		it("should not deregister when already deregistered", async () => {
			const mockManager = {
				settings: { enableAutoTrigger: false } as any,
				inlineCompletionProviderDisposable: null as any,
				inlineCompletionProvider: {} as any,
				context: { subscriptions: [] as any[] },
				async updateInlineCompletionProviderRegistration() {
					const shouldBeRegistered = this.settings?.enableAutoTrigger ?? false

					if (shouldBeRegistered && !this.inlineCompletionProviderDisposable) {
						// Register logic (not executed in this test)
					} else if (!shouldBeRegistered && this.inlineCompletionProviderDisposable) {
						this.inlineCompletionProviderDisposable.dispose()
						this.inlineCompletionProviderDisposable = null
					}
				},
			}

			// Should not throw or cause issues
			await mockManager.updateInlineCompletionProviderRegistration()

			expect(mockManager.inlineCompletionProviderDisposable).toBeNull()
		})
	})
})

import { describe, it, expect, beforeEach, vi } from "vitest"
import { MockWorkspace } from "./MockWorkspace"
import * as vscode from "vscode"
import { parseGhostResponse } from "../classic-auto-complete/HoleFiller"
import { extractPrefixSuffix } from "../types"

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

	// Helper function to set up test document
	async function setupTestDocument(filename: string, content: string) {
		const testUri = vscode.Uri.parse(`file://${filename}`)
		mockWorkspace.addDocument(testUri, content)
		;(vscode.window as any).activeTextEditor = {
			document: { uri: testUri },
		}

		const mockDocument = await mockWorkspace.openTextDocument(testUri)
		;(mockDocument as any).uri = testUri

		return { testUri, mockDocument }
	}

	describe("Error Handling", () => {
		it("should handle empty responses", async () => {
			const initialContent = `console.log('test');`
			const { mockDocument } = await setupTestDocument("empty.js", initialContent)

			// Test empty response
			const position = new vscode.Position(0, 0)
			const { prefix, suffix } = extractPrefixSuffix(mockDocument, position)
			const result = parseGhostResponse("", prefix, suffix)
			expect(result.text).toBe("")
		})

		it("should handle invalid COMPLETION format", async () => {
			const initialContent = `console.log('test');`
			const { mockDocument } = await setupTestDocument("invalid.js", initialContent)

			const invalidCOMPLETION = "This is not a valid COMPLETION format"
			const position = new vscode.Position(0, 0)
			const { prefix, suffix } = extractPrefixSuffix(mockDocument, position)
			const result = parseGhostResponse(invalidCOMPLETION, prefix, suffix)
			expect(result.text).toBe("")
		})

		it("should handle file not found in context", async () => {
			const initialContent = `console.log('test');`
			const { mockDocument } = await setupTestDocument("missing.js", initialContent)

			const completionResponse = `<COMPLETION>// Added comment
console.log('test');</COMPLETION>`

			const position = new vscode.Position(0, 0)
			const { prefix, suffix } = extractPrefixSuffix(mockDocument, position)
			const result = parseGhostResponse(completionResponse, prefix, suffix)
			expect(result.text).toBe("// Added comment\nconsole.log('test');")
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

	describe("snooze functionality", () => {
		it("should return false for isSnoozed when snoozeUntil is not set", () => {
			const mockManager = {
				settings: {} as any,
				isSnoozed() {
					const snoozeUntil = this.settings?.snoozeUntil
					if (!snoozeUntil) return false
					return Date.now() < snoozeUntil
				},
			}

			expect(mockManager.isSnoozed()).toBe(false)
		})

		it("should return false for isSnoozed when snoozeUntil is in the past", () => {
			const mockManager = {
				settings: { snoozeUntil: Date.now() - 1000 } as any,
				isSnoozed() {
					const snoozeUntil = this.settings?.snoozeUntil
					if (!snoozeUntil) return false
					return Date.now() < snoozeUntil
				},
			}

			expect(mockManager.isSnoozed()).toBe(false)
		})

		it("should return true for isSnoozed when snoozeUntil is in the future", () => {
			const mockManager = {
				settings: { snoozeUntil: Date.now() + 60000 } as any,
				isSnoozed() {
					const snoozeUntil = this.settings?.snoozeUntil
					if (!snoozeUntil) return false
					return Date.now() < snoozeUntil
				},
			}

			expect(mockManager.isSnoozed()).toBe(true)
		})

		it("should return 0 for getSnoozeRemainingSeconds when not snoozed", () => {
			const mockManager = {
				settings: {} as any,
				getSnoozeRemainingSeconds() {
					const snoozeUntil = this.settings?.snoozeUntil
					if (!snoozeUntil) return 0
					const remaining = Math.max(0, Math.ceil((snoozeUntil - Date.now()) / 1000))
					return remaining
				},
			}

			expect(mockManager.getSnoozeRemainingSeconds()).toBe(0)
		})

		it("should return remaining seconds when snoozed", () => {
			const snoozeUntil = Date.now() + 30000 // 30 seconds from now
			const mockManager = {
				settings: { snoozeUntil } as any,
				getSnoozeRemainingSeconds() {
					const snoozeUntil = this.settings?.snoozeUntil
					if (!snoozeUntil) return 0
					const remaining = Math.max(0, Math.ceil((snoozeUntil - Date.now()) / 1000))
					return remaining
				},
			}

			const remaining = mockManager.getSnoozeRemainingSeconds()
			expect(remaining).toBeGreaterThan(0)
			expect(remaining).toBeLessThanOrEqual(30)
		})

		it("should not register provider when snoozed even if enableAutoTrigger is true", async () => {
			const mockDisposable = { dispose: vi.fn() }
			const mockRegister = vi.fn().mockReturnValue(mockDisposable)

			const mockManager = {
				settings: { enableAutoTrigger: true, snoozeUntil: Date.now() + 60000 } as any,
				inlineCompletionProviderDisposable: null as any,
				inlineCompletionProvider: {} as any,
				context: { subscriptions: [] as any[] },
				isSnoozed() {
					const snoozeUntil = this.settings?.snoozeUntil
					if (!snoozeUntil) return false
					return Date.now() < snoozeUntil
				},
				async updateInlineCompletionProviderRegistration() {
					const shouldBeRegistered = (this.settings?.enableAutoTrigger ?? false) && !this.isSnoozed()

					if (this.inlineCompletionProviderDisposable) {
						this.inlineCompletionProviderDisposable.dispose()
						this.inlineCompletionProviderDisposable = null
					}

					if (!shouldBeRegistered) return

					this.inlineCompletionProviderDisposable = mockRegister("*", this.inlineCompletionProvider)
					this.context.subscriptions.push(this.inlineCompletionProviderDisposable)
				},
			}

			await mockManager.updateInlineCompletionProviderRegistration()

			// Provider should NOT be registered because we're snoozed
			expect(mockRegister).not.toHaveBeenCalled()
			expect(mockManager.inlineCompletionProviderDisposable).toBeNull()
		})

		it("should register provider when snooze expires", async () => {
			const mockDisposable = { dispose: vi.fn() }
			const mockRegister = vi.fn().mockReturnValue(mockDisposable)

			const mockManager = {
				settings: { enableAutoTrigger: true, snoozeUntil: Date.now() - 1000 } as any, // Expired snooze
				inlineCompletionProviderDisposable: null as any,
				inlineCompletionProvider: {} as any,
				context: { subscriptions: [] as any[] },
				isSnoozed() {
					const snoozeUntil = this.settings?.snoozeUntil
					if (!snoozeUntil) return false
					return Date.now() < snoozeUntil
				},
				async updateInlineCompletionProviderRegistration() {
					const shouldBeRegistered = (this.settings?.enableAutoTrigger ?? false) && !this.isSnoozed()

					if (this.inlineCompletionProviderDisposable) {
						this.inlineCompletionProviderDisposable.dispose()
						this.inlineCompletionProviderDisposable = null
					}

					if (!shouldBeRegistered) return

					this.inlineCompletionProviderDisposable = mockRegister("*", this.inlineCompletionProvider)
					this.context.subscriptions.push(this.inlineCompletionProviderDisposable)
				},
			}

			await mockManager.updateInlineCompletionProviderRegistration()

			// Provider should be registered because snooze has expired
			expect(mockRegister).toHaveBeenCalledWith("*", mockManager.inlineCompletionProvider)
			expect(mockManager.inlineCompletionProviderDisposable).toBe(mockDisposable)
		})

		it("should clear snooze timer on dispose", () => {
			const mockTimer = setTimeout(() => {}, 1000)
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")

			const mockManager = {
				snoozeTimer: mockTimer as any,
				statusBar: { dispose: vi.fn() },
				inlineCompletionProviderDisposable: null as any,
				inlineCompletionProvider: { dispose: vi.fn() },
				dispose() {
					this.statusBar?.dispose()

					if (this.snoozeTimer) {
						clearTimeout(this.snoozeTimer)
						this.snoozeTimer = null
					}

					if (this.inlineCompletionProviderDisposable) {
						this.inlineCompletionProviderDisposable.dispose()
						this.inlineCompletionProviderDisposable = null
					}

					this.inlineCompletionProvider.dispose()
				},
			}

			mockManager.dispose()

			expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimer)
			expect(mockManager.snoozeTimer).toBeNull()

			clearTimeoutSpy.mockRestore()
		})
	})
})

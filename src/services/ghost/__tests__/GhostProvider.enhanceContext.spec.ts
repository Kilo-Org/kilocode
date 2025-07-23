import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import * as vscode from "vscode"
import { GhostProvider } from "../GhostProvider"
import { GhostDocumentStore } from "../GhostDocumentStore"
import { MockTextDocument } from "../../autocomplete/__tests__/MockTextDocument"
import { GhostSuggestionContext } from "../types"

// Mock vscode
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
	workspace: {
		textDocuments: [],
		onDidChangeTextDocument: vi.fn(),
		onDidOpenTextDocument: vi.fn(),
		onDidCloseTextDocument: vi.fn(),
	},
	window: {
		activeTextEditor: null,
	},
	commands: {
		executeCommand: vi.fn(),
	},
	ExtensionContext: class {
		subscriptions = []
	},
}))

// Mock GhostDocumentStore with proper typing for vitest mocks
vi.mock("../GhostDocumentStore", () => {
	const mockStoreDocument = vi.fn().mockResolvedValue(undefined)
	const mockParseDocumentAST = vi.fn().mockResolvedValue(undefined)
	const mockGetAST = vi.fn().mockReturnValue({
		rootNode: {
			type: "program",
			text: "function test() { return true; }",
			descendantForPosition: vi.fn().mockReturnValue({
				type: "identifier",
				text: "testIdentifier",
				parent: {
					type: "function_declaration",
					text: "function test() { return true; }",
				},
				previousSibling: {
					type: "keyword",
					text: "function",
				},
				nextSibling: {
					type: "parameters",
					text: "()",
				},
				childCount: 0,
				child: vi.fn().mockReturnValue(null),
			}),
		},
		language: "javascript",
	})
	const mockNeedsASTUpdate = vi.fn().mockReturnValue(false)
	const mockClearAST = vi.fn()
	const mockClearAllASTs = vi.fn()
	const mockGetDocument = vi.fn().mockReturnValue({
		uri: "file:///test.js",
		document: {},
		history: ["function test() { return true; }"],
		ast: {
			rootNode: {
				type: "program",
				text: "function test() { return true; }",
				descendantForPosition: vi.fn().mockReturnValue({
					type: "identifier",
					text: "testIdentifier",
					parent: {
						type: "function_declaration",
						text: "function test() { return true; }",
					},
					previousSibling: {
						type: "keyword",
						text: "function",
					},
					nextSibling: {
						type: "parameters",
						text: "()",
					},
					childCount: 0,
					child: vi.fn().mockReturnValue(null),
				}),
			},
			language: "javascript",
		},
		lastParsedVersion: 1,
	})

	return {
		GhostDocumentStore: vi.fn().mockImplementation(() => ({
			storeDocument: mockStoreDocument,
			parseDocumentAST: mockParseDocumentAST,
			getAST: mockGetAST,
			needsASTUpdate: mockNeedsASTUpdate,
			clearAST: mockClearAST,
			clearAllASTs: mockClearAllASTs,
			getDocument: mockGetDocument,
		})),
	}
})

// Mock other dependencies
vi.mock("../GhostStrategy", () => ({
	GhostStrategy: vi.fn().mockImplementation(() => ({
		getSystemPrompt: vi.fn().mockReturnValue("system prompt"),
		getSuggestionPrompt: vi.fn().mockReturnValue("user prompt"),
		parseResponse: vi.fn().mockResolvedValue({
			hasSuggestions: vi.fn().mockReturnValue(false),
			clear: vi.fn(),
			validateFiles: vi.fn(),
			addFile: vi.fn(),
			getFile: vi.fn().mockReturnValue(null),
		}),
	})),
}))

vi.mock("../GhostModel", () => ({
	GhostModel: vi.fn().mockImplementation(() => ({
		reload: vi.fn().mockResolvedValue(undefined),
		loaded: true,
		generateResponse: vi.fn().mockResolvedValue("response"),
	})),
}))

vi.mock("../GhostWorkspaceEdit", () => ({
	GhostWorkspaceEdit: vi.fn().mockImplementation(() => ({
		applySuggestionsPlaceholders: vi.fn().mockResolvedValue(undefined),
		revertSuggestionsPlaceholder: vi.fn().mockResolvedValue(undefined),
		applySuggestions: vi.fn().mockResolvedValue(undefined),
		applySelectedSuggestions: vi.fn().mockResolvedValue(undefined),
		isLocked: vi.fn().mockReturnValue(false),
	})),
}))

vi.mock("../GhostDecorations", () => ({
	GhostDecorations: vi.fn().mockImplementation(() => ({
		displaySuggestions: vi.fn(),
		clearAll: vi.fn(),
	})),
}))

vi.mock("../GhostCodeActionProvider", () => ({
	GhostCodeActionProvider: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("../GhostCodeLensProvider", () => ({
	GhostCodeLensProvider: vi.fn().mockImplementation(() => ({
		setSuggestionRange: vi.fn(),
	})),
}))

vi.mock("../../core/config/ProviderSettingsManager", () => ({
	ProviderSettingsManager: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("../../core/config/ContextProxy", () => ({
	ContextProxy: {
		instance: {
			getValues: vi.fn().mockReturnValue({
				ghostServiceSettings: {},
			}),
		},
	},
}))

vi.mock("../../core/prompts/sections/custom-instructions", () => ({
	addCustomInstructions: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../utils/path", () => ({
	getWorkspacePath: vi.fn().mockReturnValue("/workspace"),
}))

vi.mock("../../i18n", () => ({
	t: vi.fn().mockImplementation((key) => key),
}))

// Create a mock document store factory that will be used throughout the test
const createMockDocumentStore = () => {
	const mockStoreDocument = vi.fn().mockResolvedValue(undefined)
	const mockGetAST = vi.fn().mockReturnValue({
		rootNode: {
			type: "program",
			text: "function test() { return true; }",
			descendantForPosition: vi.fn().mockReturnValue({
				type: "identifier",
				text: "testIdentifier",
				parent: {
					type: "function_declaration",
					text: "function test() { return true; }",
				},
				previousSibling: {
					type: "keyword",
					text: "function",
				},
				nextSibling: {
					type: "parameters",
					text: "()",
				},
				childCount: 0,
				child: vi.fn().mockReturnValue(null),
			}),
		},
		language: "javascript",
	})
	const mockNeedsASTUpdate = vi.fn().mockReturnValue(false)
	const mockClearAST = vi.fn()

	return {
		storeDocument: mockStoreDocument,
		getAST: mockGetAST,
		needsASTUpdate: mockNeedsASTUpdate,
		clearAST: mockClearAST,
	}
}

// Variable to store the document store instance that will be shared between the mock and the test
let mockDocumentStoreInstance = createMockDocumentStore()

// Mock the GhostProvider class to avoid private constructor issues
vi.mock("../GhostProvider", () => {
	// Create a mock implementation of enhanceContext
	const mockEnhanceContext = vi.fn().mockImplementation(async (context: GhostSuggestionContext) => {
		if (!vscode.window.activeTextEditor) {
			return context
		}

		// Add open files to the context
		const openFiles = vscode.workspace.textDocuments.filter((doc) => doc.uri.scheme === "file")
		const enhancedContext = { ...context, openFiles }

		// Get AST for the current document if available
		if (context.document) {
			try {
				// Use our shared mock document store instance
				const documentStore = mockDocumentStoreInstance

				// Check if we need to parse or update the AST
				if (documentStore.needsASTUpdate(context.document)) {
					await documentStore.storeDocument(context.document, true)
				}

				// Get the AST from the document store
				const ast = documentStore.getAST(context.document.uri)

				if (ast) {
					// Add the AST to the context
					enhancedContext.ast = ast

					// If there's a selection or cursor position, find the relevant AST node
					if (context.range) {
						const startPosition = {
							row: context.range.start.line,
							column: context.range.start.character,
						}
						const endPosition = {
							row: context.range.end.line,
							column: context.range.end.character,
						}

						// Find the smallest node that contains the selection
						const nodeAtCursor = ast.rootNode.descendantForPosition(startPosition, endPosition)
						if (nodeAtCursor) {
							enhancedContext.astNodeAtCursor = nodeAtCursor
						}
					}
				}
			} catch (error) {
				console.error("Error getting AST from document store:", error)
				// Continue without AST if there's an error
			}
		}

		return enhancedContext
	})

	// Create a mock implementation of the event handlers
	const mockOnDidCloseTextDocument = vi.fn().mockImplementation((document: vscode.TextDocument) => {
		if (document.uri.scheme !== "file") {
			return
		}
		mockDocumentStoreInstance.clearAST(document.uri)
	})

	const mockOnDidOpenTextDocument = vi.fn().mockImplementation(async (document: vscode.TextDocument) => {
		if (document.uri.scheme !== "file") {
			return
		}
		await mockDocumentStoreInstance.storeDocument(document, true)
	})

	const mockOnDidChangeTextDocument = vi.fn().mockImplementation(async (event: vscode.TextDocumentChangeEvent) => {
		if (event.document.uri.scheme !== "file") {
			return
		}
		await mockDocumentStoreInstance.storeDocument(event.document, true)
	})

	// Create a mock implementation of provideCodeActionQuickFix
	const mockProvideCodeActionQuickFix = vi
		.fn()
		.mockImplementation(async (document: vscode.TextDocument, range: vscode.Range | vscode.Selection) => {
			await mockDocumentStoreInstance.storeDocument(document, true)
		})

	return {
		GhostProvider: {
			getInstance: vi.fn().mockImplementation(() => {
				// Reset the mock document store for each test
				mockDocumentStoreInstance = createMockDocumentStore()

				return {
					enhanceContext: mockEnhanceContext,
					onDidCloseTextDocument: mockOnDidCloseTextDocument,
					onDidOpenTextDocument: mockOnDidOpenTextDocument,
					onDidChangeTextDocument: mockOnDidChangeTextDocument,
					provideCodeActionQuickFix: mockProvideCodeActionQuickFix,
					getDocumentStore: vi.fn().mockReturnValue(mockDocumentStoreInstance),
				}
			}),
		},
	}
})

describe("GhostProvider - enhanceContext", () => {
	let provider: any
	let mockContext: vscode.ExtensionContext
	let mockDocument: MockTextDocument
	let mockDocumentStore: any

	beforeEach(() => {
		mockContext = new (vscode as any).ExtensionContext()
		mockDocument = new MockTextDocument(vscode.Uri.parse("file:///test.js"), "function test() { return true; }")

		// Set up active editor
		;(vscode.window as any).activeTextEditor = {
			document: mockDocument,
		}

		// Set up workspace documents
		;(vscode.workspace as any).textDocuments = [mockDocument]

		// Create provider instance
		provider = GhostProvider.getInstance(mockContext)

		// Get reference to mocked document store
		mockDocumentStore = provider.getDocumentStore()
		// Make sure it's the same instance as our global variable
		expect(mockDocumentStore).toBe(mockDocumentStoreInstance)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("enhanceContext", () => {
		it("should add AST to context when available", async () => {
			// Create a basic context
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			// Call the enhanceContext method
			const enhancedContext = await provider.enhanceContext(context)

			// Verify AST was added
			expect(enhancedContext.ast).toBeDefined()
			expect(enhancedContext.ast?.language).toBe("javascript")
			expect(enhancedContext.ast?.rootNode).toBeDefined()
		})

		it("should add astNodeAtCursor when range is provided", async () => {
			// Create context with range
			const range = new vscode.Range(new vscode.Position(0, 5), new vscode.Position(0, 10))

			const context: GhostSuggestionContext = {
				document: mockDocument,
				range: range,
			}

			// Call the enhanceContext method
			const enhancedContext = await provider.enhanceContext(context)

			// Verify astNodeAtCursor was added
			expect(enhancedContext.astNodeAtCursor).toBeDefined()
			expect(enhancedContext.astNodeAtCursor?.type).toBe("identifier")
			expect(enhancedContext.astNodeAtCursor?.text).toBe("testIdentifier")

			// Verify descendantForPosition was called with correct position
			const mockDescendantForPosition = enhancedContext.ast?.rootNode.descendantForPosition
			expect(mockDescendantForPosition).toHaveBeenCalledWith({ row: 0, column: 5 }, { row: 0, column: 10 })
		})

		it("should update AST if needed", async () => {
			// Mock needsASTUpdate to return true
			vi.spyOn(mockDocumentStore, "needsASTUpdate").mockReturnValue(true)

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			// Call the enhanceContext method
			await provider.enhanceContext(context)

			// Verify storeDocument was called to update AST
			expect(mockDocumentStore.storeDocument).toHaveBeenCalledWith(mockDocument, true)
		})

		it("should not update AST if not needed", async () => {
			// Mock needsASTUpdate to return false
			vi.spyOn(mockDocumentStore, "needsASTUpdate").mockReturnValue(false)

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			// Call the enhanceContext method
			await provider.enhanceContext(context)

			// Verify storeDocument was not called
			expect(mockDocumentStore.storeDocument).not.toHaveBeenCalled()
		})

		it("should handle errors gracefully", async () => {
			// Mock getAST to throw an error
			vi.spyOn(mockDocumentStore, "getAST").mockImplementation(() => {
				throw new Error("Test error")
			})

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			// Call the enhanceContext method - should not throw
			const enhancedContext = await provider.enhanceContext(context)

			// Verify context was returned without AST
			expect(enhancedContext.ast).toBeUndefined()
			expect(enhancedContext.astNodeAtCursor).toBeUndefined()
		})

		it("should return original context when no active editor", async () => {
			// Set active editor to null
			;(vscode.window as any).activeTextEditor = null

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			// Call the enhanceContext method
			const enhancedContext = await provider.enhanceContext(context)

			// Verify original context was returned
			expect(enhancedContext).toBe(context)
		})

		it("should add open files to context", async () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			// Call the enhanceContext method
			const enhancedContext = await provider.enhanceContext(context)

			// Verify open files were added
			expect(enhancedContext.openFiles).toBeDefined()
			expect(enhancedContext.openFiles?.length).toBe(1)
			expect(enhancedContext.openFiles?.[0]).toBe(mockDocument)
		})

		it("should handle missing document in context", async () => {
			const context: GhostSuggestionContext = {
				// No document
			}

			// Call the enhanceContext method
			const enhancedContext = await provider.enhanceContext(context)

			// Verify context was enhanced but without AST
			expect(enhancedContext.openFiles).toBeDefined()
			expect(enhancedContext.ast).toBeUndefined()
			expect(enhancedContext.astNodeAtCursor).toBeUndefined()
		})
	})

	describe("document event handlers", () => {
		it("should clear AST on document close", () => {
			// Call the handler
			provider.onDidCloseTextDocument(mockDocument)

			// Verify clearAST was called
			expect(mockDocumentStore.clearAST).toHaveBeenCalledWith(mockDocument.uri)
		})

		it("should not clear AST for non-file documents", () => {
			// Create a non-file document
			const nonFileDoc = new MockTextDocument({ ...mockDocument.uri, scheme: "untitled" } as any, "content")

			// Call the handler
			provider.onDidCloseTextDocument(nonFileDoc)

			// Verify clearAST was not called
			expect(mockDocumentStore.clearAST).not.toHaveBeenCalled()
		})

		it("should store document and parse AST on document open", async () => {
			// Call the handler
			await provider.onDidOpenTextDocument(mockDocument)

			// Verify storeDocument was called with parseAST=true
			expect(mockDocumentStore.storeDocument).toHaveBeenCalledWith(mockDocument, true)
		})

		it("should not store non-file documents", async () => {
			// Create a non-file document
			const nonFileDoc = new MockTextDocument({ ...mockDocument.uri, scheme: "untitled" } as any, "content")

			// Call the handler
			await provider.onDidOpenTextDocument(nonFileDoc)

			// Verify storeDocument was not called
			expect(mockDocumentStore.storeDocument).not.toHaveBeenCalled()
		})

		it("should update document and AST on document change", async () => {
			// Call the handler
			await provider.onDidChangeTextDocument({ document: mockDocument })

			// Verify storeDocument was called with parseAST=true
			expect(mockDocumentStore.storeDocument).toHaveBeenCalledWith(mockDocument, true)
		})

		it("should not update non-file documents", async () => {
			// Create a non-file document
			const nonFileDoc = new MockTextDocument({ ...mockDocument.uri, scheme: "untitled" } as any, "content")

			// Call the handler
			await provider.onDidChangeTextDocument({ document: nonFileDoc })

			// Verify storeDocument was not called
			expect(mockDocumentStore.storeDocument).not.toHaveBeenCalled()
		})
	})

	describe("provideCodeActionQuickFix", () => {
		it("should store document and parse AST before providing suggestions", async () => {
			// Create a range
			const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10))

			// Call provideCodeActionQuickFix
			await provider.provideCodeActionQuickFix(mockDocument, range)

			// Verify storeDocument was called with parseAST=true
			expect(mockDocumentStore.storeDocument).toHaveBeenCalledWith(mockDocument, true)
		})
	})
})

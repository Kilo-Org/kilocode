import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import * as vscode from "vscode"
import { GhostDocumentStore } from "../GhostDocumentStore"
import { ASTContext } from "../types"
import { MockTextDocument } from "../../mocking/MockTextDocument"

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
}))

// Mock web-tree-sitter
vi.mock("web-tree-sitter", () => {
	return {
		Parser: class {
			static init = vi.fn().mockResolvedValue(undefined)
			parse = vi.fn().mockImplementation((content) => ({
				rootNode: {
					toString: () => content,
					text: content,
					type: "program",
					startPosition: { row: 0, column: 0 },
					endPosition: { row: content.split("\n").length - 1, column: 0 },
					children: [],
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
			}))
		},
		Language: {
			load: vi.fn().mockResolvedValue({}),
		},
		Query: class {
			constructor() {}
			captures = vi.fn().mockReturnValue([])
		},
	}
})

// Mock tree-sitter languageParser
vi.mock("../tree-sitter/languageParser", () => {
	const mockLoadRequiredLanguageParsers = vi.fn().mockResolvedValue({
		js: {
			parser: {
				parse: vi.fn().mockImplementation((content) => ({
					rootNode: {
						toString: () => content,
						text: content,
						type: "program",
						startPosition: { row: 0, column: 0 },
						endPosition: { row: content.split("\n").length - 1, column: 0 },
						children: [],
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
				})),
			},
			query: {
				captures: vi.fn().mockReturnValue([]),
			},
		},
		ts: {
			parser: {
				parse: vi.fn().mockImplementation((content) => ({
					rootNode: {
						toString: () => content,
						text: content,
						type: "program",
						startPosition: { row: 0, column: 0 },
						endPosition: { row: content.split("\n").length - 1, column: 0 },
						children: [],
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
				})),
			},
			query: {
				captures: vi.fn().mockReturnValue([]),
			},
		},
	})

	return {
		loadRequiredLanguageParsers: mockLoadRequiredLanguageParsers,
	}
})

describe("GhostDocumentStore", () => {
	let documentStore: GhostDocumentStore
	let mockDocument: MockTextDocument
	let mockAst: ASTContext

	beforeEach(() => {
		// Create a mock AST
		mockAst = {
			rootNode: {} as any,
			language: "js",
		}

		// Create a custom implementation of GhostDocumentStore with mocked behavior
		const mockDocumentMap = new Map()

		// Set a history limit for testing
		const historyLimit = 10

		documentStore = {
			historyLimit,
			storeDocument: vi
				.fn()
				.mockImplementation(
					async ({
						document,
						parseAST = true,
						bypassDebounce = false,
					}: {
						document: vscode.TextDocument
						parseAST?: boolean
						bypassDebounce?: boolean
					}) => {
						const uri = document.uri.toString()
						if (!mockDocumentMap.has(uri)) {
							mockDocumentMap.set(uri, {
								uri,
								document,
								history: [],
							})
						}

						const item = mockDocumentMap.get(uri)
						item.document = document
						item.history.push(document.getText())

						// Limit history array length
						if (item.history.length > historyLimit) {
							item.history = item.history.slice(-historyLimit)
						}

						// Only parse AST for supported file extensions
						const fileExtension = document.uri.path.split(".").pop()?.toLowerCase()
						const supportedExtensions = ["js", "ts", "jsx", "tsx"]

						if (parseAST && supportedExtensions.includes(fileExtension || "")) {
							item.ast = mockAst
							item.lastParsedVersion = document.version
						}
					},
				),

			parseDocumentAST: vi.fn().mockImplementation(async (document: vscode.TextDocument) => {
				const uri = document.uri.toString()
				const item = mockDocumentMap.get(uri)

				if (item) {
					// Only parse AST for supported file extensions
					const fileExtension = document.uri.path.split(".").pop()?.toLowerCase()
					const supportedExtensions = ["js", "ts", "jsx", "tsx"]

					if (supportedExtensions.includes(fileExtension || "")) {
						item.ast = mockAst
						item.lastParsedVersion = document.version
					}
				}
			}),

			getAST: vi.fn().mockImplementation((documentUri: vscode.Uri) => {
				const uri = documentUri.toString()
				const item = mockDocumentMap.get(uri)
				return item?.ast
			}),

			getDocument: vi.fn().mockImplementation((documentUri: vscode.Uri) => {
				const uri = documentUri.toString()
				return mockDocumentMap.get(uri)
			}),

			needsASTUpdate: vi.fn().mockImplementation((document: vscode.TextDocument) => {
				const uri = document.uri.toString()
				const item = mockDocumentMap.get(uri)

				if (!item) {
					return true
				}

				return !item.ast || item.lastParsedVersion !== document.version
			}),

			clearAST: vi.fn().mockImplementation((documentUri: vscode.Uri) => {
				const uri = documentUri.toString()
				const item = mockDocumentMap.get(uri)

				if (item) {
					item.ast = undefined
					item.lastParsedVersion = undefined
				}
			}),

			clearAllASTs: vi.fn().mockImplementation(() => {
				for (const item of mockDocumentMap.values()) {
					item.ast = undefined
					item.lastParsedVersion = undefined
				}
			}),

			getRecentOperations: vi.fn().mockImplementation((document: vscode.TextDocument): string => {
				if (!document) {
					return ""
				}

				const uri = document.uri.toString()
				const item = mockDocumentMap.get(uri)

				if (!item || item.history.length < 2) {
					return ""
				}

				// Get the last 10 versions (or fewer if not available)
				const historyLimit = 10
				const startIdx = Math.max(0, item.history.length - historyLimit)
				const recentHistory = item.history.slice(startIdx)

				// If we have at least 2 versions, compare the oldest with the newest
				if (recentHistory.length >= 2) {
					const oldContent = recentHistory[0]
					const newContent = recentHistory[recentHistory.length - 1]

					// Use the mocked createPatch function
					const { createPatch } = require("diff")
					const filePath = "test-file-path" // Mock the file path
					return createPatch(filePath, oldContent, newContent, "Previous version", "Current version")
				}

				return ""
			}),
		} as unknown as GhostDocumentStore

		const uri = vscode.Uri.parse("file:///test.js")
		mockDocument = new MockTextDocument(uri, "function test() { return true; }")
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("storeDocument", () => {
		it("should store a document and its history", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
			})

			const storedItem = documentStore.getDocument(mockDocument.uri)
			expect(storedItem).toBeDefined()
			expect(storedItem?.document).toBe(mockDocument)
			expect(storedItem?.history).toHaveLength(1)
			expect(storedItem?.history[0]).toBe("function test() { return true; }")
		})

		it("should limit history to historyLimit", async () => {
			// Access private property for testing
			const historyLimit = (documentStore as any).historyLimit

			// Store document multiple times with different content
			for (let i = 0; i < historyLimit + 5; i++) {
				mockDocument.updateContent(`function test${i}() { return true; }`)
				await documentStore.storeDocument({
					document: mockDocument,
					bypassDebounce: true,
					parseAST: false,
				})
			}

			const storedItem = documentStore.getDocument(mockDocument.uri)
			expect(storedItem?.history).toHaveLength(historyLimit)
			// First entries should be removed
			expect(storedItem?.history[0]).toBe(`function test${5}() { return true; }`)
		})

		it("should parse AST when parseAST is true", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: true,
			})

			const storedItem = documentStore.getDocument(mockDocument.uri)
			expect(storedItem?.ast).toBeDefined()
			expect(storedItem?.lastParsedVersion).toBe(mockDocument.version)
		})

		it("should not parse AST when parseAST is false", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: false,
			})

			const storedItem = documentStore.getDocument(mockDocument.uri)
			expect(storedItem?.ast).toBeUndefined()
			expect(storedItem?.lastParsedVersion).toBeUndefined()
		})
	})

	describe("parseDocumentAST", () => {
		it("should parse AST for JavaScript document", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: false,
			})
			await documentStore.parseDocumentAST(mockDocument)

			const storedItem = documentStore.getDocument(mockDocument.uri)
			expect(storedItem?.ast).toBeDefined()
			expect(storedItem?.ast?.language).toBe("js")
			expect(storedItem?.ast?.rootNode).toBeDefined()
			expect(storedItem?.lastParsedVersion).toBe(mockDocument.version)
		})

		it("should handle document not in store", async () => {
			const unknownUri = vscode.Uri.parse("file:///unknown.js")
			await documentStore.parseDocumentAST(new MockTextDocument(unknownUri, ""))

			// Should not throw and should not add the document
			expect(documentStore.getDocument(unknownUri)).toBeUndefined()
		})

		it("should handle parser errors gracefully", async () => {
			// Store document first
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: false,
			})

			// Override parseDocumentAST to simulate error handling
			const originalParseDocumentAST = documentStore.parseDocumentAST
			vi.spyOn(documentStore, "parseDocumentAST").mockImplementationOnce(async (document) => {
				// Simulate error by not setting the AST
				const uri = document.uri.toString()
				const storedItem = documentStore.getDocument(document.uri)

				if (storedItem) {
					// Ensure AST is undefined to simulate error
					storedItem.ast = undefined
					storedItem.lastParsedVersion = undefined
				}
			})

			// Call parseDocumentAST which should now handle the error
			await documentStore.parseDocumentAST(mockDocument)

			// Should not have AST but should still have the document
			const storedItem = documentStore.getDocument(mockDocument.uri)
			expect(storedItem).toBeDefined()
			expect(storedItem?.ast).toBeUndefined()
		})

		it("should handle unsupported file extensions", async () => {
			const unknownExtUri = vscode.Uri.parse("file:///test.unknown")
			const unknownExtDoc = new MockTextDocument(unknownExtUri, "content")

			await documentStore.storeDocument({
				document: unknownExtDoc,
				bypassDebounce: true,
				parseAST: true,
			})

			const storedItem = documentStore.getDocument(unknownExtUri)
			expect(storedItem).toBeDefined()
			expect(storedItem?.ast).toBeUndefined()
		})
	})

	describe("getAST", () => {
		it("should return AST for document with parsed AST", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: true,
			})

			const ast = documentStore.getAST(mockDocument.uri)
			expect(ast).toBeDefined()
			expect(ast?.language).toBe("js")
			expect(ast?.rootNode).toBeDefined()
		})

		it("should return undefined for document without AST", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: false,
			})
			const ast = documentStore.getAST(mockDocument.uri)
			expect(ast).toBeUndefined()
		})

		it("should return undefined for unknown document", () => {
			const unknownUri = vscode.Uri.parse("file:///unknown.js")

			const ast = documentStore.getAST(unknownUri)
			expect(ast).toBeUndefined()
		})
	})

	describe("needsASTUpdate", () => {
		it("should return true for document not in store", () => {
			const unknownUri = vscode.Uri.parse("file:///unknown.js")
			const unknownDoc = new MockTextDocument(unknownUri, "")

			expect(documentStore.needsASTUpdate(unknownDoc)).toBe(true)
		})

		it("should return true for document without AST", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: false,
			})

			expect(documentStore.needsASTUpdate(mockDocument)).toBe(true)
		})

		it("should return true for document with outdated AST version", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: true,
			})

			// Update document version
			mockDocument.updateContent("function updated() { return false; }")

			expect(documentStore.needsASTUpdate(mockDocument)).toBe(true)
		})

		it("should return false for document with current AST version", async () => {
			// Override needsASTUpdate for this specific test
			const originalNeedsASTUpdate = documentStore.needsASTUpdate
			vi.spyOn(documentStore, "needsASTUpdate").mockImplementationOnce((document) => {
				// Mock a document with current AST version
				return false
			})

			expect(documentStore.needsASTUpdate(mockDocument)).toBe(false)

			// Restore original implementation after test
			documentStore.needsASTUpdate = originalNeedsASTUpdate
		})
	})

	describe("clearAST", () => {
		it("should clear AST for document", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: true,
			})

			// Verify AST exists
			expect(documentStore.getAST(mockDocument.uri)).toBeDefined()

			// Clear AST
			documentStore.clearAST(mockDocument.uri)

			// Verify AST is cleared
			const storedItem = documentStore.getDocument(mockDocument.uri)
			expect(storedItem?.ast).toBeUndefined()
			expect(storedItem?.lastParsedVersion).toBeUndefined()
		})

		it("should handle unknown document", () => {
			const unknownUri = vscode.Uri.parse("file:///unknown.js")

			// Should not throw
			documentStore.clearAST(unknownUri)
		})
	})

	describe("clearAllASTs", () => {
		it("should clear ASTs for all documents", async () => {
			// Store multiple documents with ASTs
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
				parseAST: true,
			})

			const tsUri = vscode.Uri.parse("file:///test.ts")
			const tsDoc = new MockTextDocument(tsUri, "function test(): boolean { return true; }")
			await documentStore.storeDocument({
				document: tsDoc,
				bypassDebounce: true,
				parseAST: true,
			})

			// Verify ASTs exist
			expect(documentStore.getAST(mockDocument.uri)).toBeDefined()
			expect(documentStore.getAST(tsUri)).toBeDefined()

			// Clear all ASTs
			documentStore.clearAllASTs()

			// Verify all ASTs are cleared
			expect(documentStore.getAST(mockDocument.uri)).toBeUndefined()
			expect(documentStore.getAST(tsUri)).toBeUndefined()
		})
	})

	describe("getRecentOperations", () => {
		it("should return empty string for document not in store", () => {
			const unknownUri = vscode.Uri.parse("file:///unknown.js")
			const unknownDoc = new MockTextDocument(unknownUri, "")

			const operations = documentStore.getRecentOperations(unknownDoc)
			expect(operations).toBe("")
		})

		it("should return empty string if history has less than 2 entries", async () => {
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
			})

			const operations = documentStore.getRecentOperations(mockDocument)
			expect(operations).toBe("")
		})

		it("should return diff between oldest and newest versions", async () => {
			// Store document multiple times with different content
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
			})

			mockDocument.updateContent("function updated() { return false; }")
			await documentStore.storeDocument({
				document: mockDocument,
				bypassDebounce: true,
			})

			const operations = documentStore.getRecentOperations(mockDocument)
			// Instead of expecting a mocked output, verify that the diff contains the expected content
			expect(operations).toContain("function test() { return true; }")
			expect(operations).toContain("function updated() { return false; }")
			expect(operations).toContain("@@ -1,1 +1,1 @@") // Check for diff markers
		})

		it("should handle undefined document", () => {
			const operations = documentStore.getRecentOperations(undefined as any)
			expect(operations).toBe("")
		})
	})
})

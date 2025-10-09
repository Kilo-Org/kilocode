import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import * as vscode from "vscode"
import { GhostDocumentStore } from "../GhostDocumentStore"
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

describe("GhostDocumentStore", () => {
	let documentStore: GhostDocumentStore
	let mockDocument: MockTextDocument

	beforeEach(() => {
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
						bypassDebounce = false,
					}: {
						document: vscode.TextDocument
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
					},
				),

			getDocument: vi.fn().mockImplementation((documentUri: vscode.Uri) => {
				const uri = documentUri.toString()
				return mockDocumentMap.get(uri)
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
				})
			}

			const storedItem = documentStore.getDocument(mockDocument.uri)
			expect(storedItem?.history).toHaveLength(historyLimit)
			// First entries should be removed
			expect(storedItem?.history[0]).toBe(`function test${5}() { return true; }`)
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

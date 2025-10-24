import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Parser from "web-tree-sitter"
import { DocumentHistoryTracker } from "./DocumentHistoryTracker"

// Mock the Parser.Tree class
vi.mock("web-tree-sitter", () => {
	return {
		default: {
			Tree: class MockTree {
				constructor() {
					// Mock implementation
				}
			},
		},
	}
})

describe("DocumentHistoryTracker", () => {
	let tracker: DocumentHistoryTracker
	let mockAst1: Parser.Tree
	let mockAst2: Parser.Tree
	const testDocPath = "/test/document.ts"
	const testContent1 = "const x = 1;"
	const testContent2 = "const x = 2;"

	beforeEach(() => {
		// Reset singleton instance for each test
		// @ts-expect-error -- accessing private static property for testing
		DocumentHistoryTracker.instance = null
		tracker = DocumentHistoryTracker.getInstance()

		// Create mock ASTs
		mockAst1 = {} as Parser.Tree
		mockAst2 = {} as Parser.Tree
	})

	afterEach(() => {
		// Clear the tracker after each test
		tracker.clearMap()
	})

	describe("getInstance", () => {
		it("should return a singleton instance", () => {
			const instance1 = DocumentHistoryTracker.getInstance()
			const instance2 = DocumentHistoryTracker.getInstance()
			expect(instance1).toBe(instance2)
		})
	})

	describe("addDocument", () => {
		it("should add a document to the tracker", () => {
			tracker.addDocument(testDocPath, testContent1, mockAst1)

			const ast = tracker.getMostRecentAst(testDocPath)
			const content = tracker.getMostRecentDocumentHistory(testDocPath)

			expect(ast).toBe(mockAst1)
			expect(content).toBe(testContent1)
		})
	})

	describe("push", () => {
		it("should push a new AST to an existing document's history stack", () => {
			tracker.addDocument(testDocPath, testContent1, mockAst1)
			tracker.push(testDocPath, testContent2, mockAst2)

			const ast = tracker.getMostRecentAst(testDocPath)
			const content = tracker.getMostRecentDocumentHistory(testDocPath)

			expect(ast).toBe(mockAst2)
			expect(content).toBe(testContent2)
		})

		it("should add a document if it doesn't exist when pushing", () => {
			tracker.push(testDocPath, testContent1, mockAst1)

			// Check if document was actually added
			const ast = tracker.getMostRecentAst(testDocPath)
			expect(ast).toBe(mockAst1)
		})
	})

	describe("getMostRecentAst", () => {
		it("should return the most recent AST of a document", () => {
			tracker.addDocument(testDocPath, testContent1, mockAst1)
			tracker.push(testDocPath, testContent2, mockAst2)

			const ast = tracker.getMostRecentAst(testDocPath)

			expect(ast).toBe(mockAst2)
		})

		it("should return null if the document doesn't exist", () => {
			const ast = tracker.getMostRecentAst("nonexistent-path")
			expect(ast).toBeNull()
		})

		it("should return null if the document has no ASTs", () => {
			tracker.addDocument(testDocPath, testContent1, mockAst1)

			// @ts-expect-error - accessing private property for testing
			tracker.documentAstMap.set(testDocPath, [])

			const ast = tracker.getMostRecentAst(testDocPath)
			expect(ast).toBeNull()
		})
	})

	describe("getMostRecentDocumentHistory", () => {
		it("should return the most recent document history", () => {
			tracker.addDocument(testDocPath, testContent1, mockAst1)
			tracker.push(testDocPath, testContent2, mockAst2)

			const content = tracker.getMostRecentDocumentHistory(testDocPath)

			expect(content).toBe(testContent2)
		})

		it("should return null if the document doesn't exist", () => {
			const content = tracker.getMostRecentDocumentHistory("nonexistent-path")
			expect(content).toBeNull()
		})

		it("should return null if the document has no history", () => {
			tracker.addDocument(testDocPath, testContent1, mockAst1)

			// @ts-expect-error - accessing private property for testing
			tracker.documentContentHistoryMap.set(testDocPath, [])

			const content = tracker.getMostRecentDocumentHistory(testDocPath)
			expect(content).toBeNull()
		})
	})

	describe("deleteDocument", () => {
		it("should delete a document from the tracker", () => {
			tracker.addDocument(testDocPath, testContent1, mockAst1)
			tracker.deleteDocument(testDocPath)

			const ast = tracker.getMostRecentAst(testDocPath)
			const content = tracker.getMostRecentDocumentHistory(testDocPath)

			expect(ast).toBeNull()
			expect(content).toBeNull()
		})
	})

	describe("clearMap", () => {
		it("should clear all documents from the tracker", () => {
			const anotherDocPath = "/test/another-document.ts"

			tracker.addDocument(testDocPath, testContent1, mockAst1)
			tracker.addDocument(anotherDocPath, testContent1, mockAst1)

			tracker.clearMap()

			expect(tracker.getMostRecentAst(testDocPath)).toBeNull()
			expect(tracker.getMostRecentAst(anotherDocPath)).toBeNull()
			expect(tracker.getMostRecentDocumentHistory(testDocPath)).toBeNull()
			expect(tracker.getMostRecentDocumentHistory(anotherDocPath)).toBeNull()
		})
	})
})

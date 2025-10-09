import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import * as vscode from "vscode"
import { GhostStrategy } from "../GhostStrategy"
import { GhostSuggestionContext } from "../types"
import { MockTextDocument } from "../../mocking/MockTextDocument"
import { StreamingParseResult } from "../GhostStreamingParser"

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
		asRelativePath: vi.fn().mockImplementation((uri) => {
			if (typeof uri === "string") {
				return uri.replace("file:///", "")
			}
			return uri.toString().replace("file:///", "")
		}),
		openTextDocument: vi.fn().mockImplementation((uri) => {
			// Return a mock document for any URI
			const mockDoc = new MockTextDocument(uri, "function test() {\n  return true;\n}")
			return Promise.resolve(mockDoc)
		}),
	},
}))

// Mock Fuse
vi.mock("fuse.js", () => {
	return {
		default: class Fuse {
			private items: any[] = []

			constructor(items: any[]) {
				this.items = items
			}

			search(query: string) {
				// Return the first item that matches the query
				// In our tests, we want to return the mockDocument.uri
				return this.items.map((item) => ({ item, score: 0 }))
			}
		},
	}
})

// Mock diff
vi.mock("diff", () => ({
	parsePatch: vi.fn().mockImplementation((diff) => {
		// Return a patch that includes the file name from the test
		return [
			{
				oldFileName: "file:///test.js",
				newFileName: "file:///test.js",
				hunks: [
					{
						oldStart: 1,
						oldLines: 3,
						newStart: 1,
						newLines: 4,
						lines: [" function test() {", "+  // Added comment", "   return true;", " }"],
					},
				],
			},
		]
	}),
	applyPatch: vi.fn().mockReturnValue("function test() {\n  // Added comment\n  return true;\n}"),
	// Use the real structuredPatch function for our test
	structuredPatch: vi.fn().mockImplementation((oldFileName, newFileName, oldStr, newStr) => {
		// Import diff synchronously for testing
		const diff = require("diff")
		return diff.structuredPatch(oldFileName, newFileName, oldStr, newStr, "", "")
	}),
}))

describe("GhostStrategy", () => {
	let strategy: GhostStrategy
	let mockDocument: MockTextDocument

	beforeEach(() => {
		strategy = new GhostStrategy()
		mockDocument = new MockTextDocument(vscode.Uri.parse("file:///test.js"), "function test() {\n  return true;\n}")
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("streaming methods", () => {
		it("should initialize streaming parser with context", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			// Should not throw when initializing
			expect(() => strategy.initializeStreamingParser(context)).not.toThrow()
		})

		it("should process streaming chunks and return parse results", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			// Initialize the parser first
			strategy.initializeStreamingParser(context)

			// Process a chunk with partial XML
			const partialChunk = "<change><search><![CDATA[function test()"
			const result1 = strategy.processStreamingChunk(partialChunk)

			// Should return result but no completed changes yet
			expect(result1).toBeDefined()
			expect(result1.suggestions).toBeDefined()
			expect(result1.suggestions.hasSuggestions()).toBe(false)

			// Process completing chunk
			const completingChunk =
				" {\n  return true;\n}]]></search><replace><![CDATA[function test() {\n  // Added comment\n  return true;\n}]]></replace></change>"
			const result2 = strategy.processStreamingChunk(completingChunk)

			// Should now have completed suggestions
			expect(result2).toBeDefined()
			expect(result2.suggestions).toBeDefined()
			expect(result2.suggestions.hasSuggestions()).toBe(true)
		})

		it("should handle multiple streaming chunks with complete changes", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			strategy.initializeStreamingParser(context)

			// First complete change
			const documentContent = mockDocument.getText()
			const firstChange = `<change><search><![CDATA[${documentContent}]]></search><replace><![CDATA[function test() {
	// First comment
	return true;
}]]></replace></change>`

			const result1 = strategy.processStreamingChunk(firstChange)
			expect(result1.suggestions.hasSuggestions()).toBe(true)

			// Second complete change
			const secondChange = `<change><search><![CDATA[function test() {
	// First comment
	return true;
}]]></search><replace><![CDATA[function test() {
	// First comment
	// Second comment
	return true;
}]]></replace></change>`

			const result2 = strategy.processStreamingChunk(secondChange)
			expect(result2.suggestions.hasSuggestions()).toBe(true)
		})

		it("should reset streaming parser", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			strategy.initializeStreamingParser(context)
			strategy.processStreamingChunk("<change><search>")

			// Buffer should have content
			expect(strategy.getStreamingBuffer().length).toBeGreaterThan(0)

			// Reset should clear the buffer
			strategy.resetStreamingParser()
			expect(strategy.getStreamingBuffer()).toBe("")
		})

		it("should provide access to streaming buffer for debugging", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			strategy.initializeStreamingParser(context)

			// Initially empty
			expect(strategy.getStreamingBuffer()).toBe("")

			// Add some content
			const chunk = "<change><search><![CDATA[test"
			strategy.processStreamingChunk(chunk)

			// Buffer should contain the chunk
			expect(strategy.getStreamingBuffer()).toContain("test")
		})

		it("should provide access to completed changes for debugging", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			strategy.initializeStreamingParser(context)

			// Initially no completed changes
			expect(strategy.getStreamingCompletedChanges()).toEqual([])

			// Process a complete change
			const documentContent = mockDocument.getText()
			const completeChange = `<change><search><![CDATA[${documentContent}]]></search><replace><![CDATA[function test() {
	// Added comment
	return true;
}]]></replace></change>`

			strategy.processStreamingChunk(completeChange)

			// Should now have completed changes
			const completedChanges = strategy.getStreamingCompletedChanges()
			expect(completedChanges.length).toBeGreaterThan(0)
		})
	})

	describe("prompt generation", () => {
		it("should generate both prompts efficiently with getPrompts", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
				userInput: "Add a comment",
				range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
			}

			const { systemPrompt, userPrompt } = strategy.getPrompts(context)
			expect(systemPrompt).toContain("CRITICAL OUTPUT FORMAT")
			expect(systemPrompt).toContain("XML-formatted changes")
			expect(userPrompt).toContain("Add a comment")
			expect(userPrompt).toContain("<<<AUTOCOMPLETE_HERE>>>")
		})

		it("should generate system prompt via getPrompts", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}
			const { systemPrompt } = strategy.getPrompts(context)
			expect(systemPrompt).toContain("CRITICAL OUTPUT FORMAT")
			expect(systemPrompt).toContain("XML-formatted changes")
		})

		it("should generate suggestion prompt with context via getPrompts", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
				userInput: "Add a comment",
				range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
			}

			const { userPrompt } = strategy.getPrompts(context)
			expect(userPrompt).toContain("Add a comment")
			expect(userPrompt).toContain("<<<AUTOCOMPLETE_HERE>>>")
		})
	})
})

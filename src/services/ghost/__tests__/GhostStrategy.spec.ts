import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import * as vscode from "vscode"
import { GhostStrategy } from "../GhostStrategy"
import { GhostSuggestionContext, ASTContext } from "../types"
import { MockTextDocument } from "../../mocking/MockTextDocument"

// Create a mock Node class for testing
class MockNode {
	id: number = 1
	startIndex: number = 0
	endIndex: number = 0
	startPosition: { row: number; column: number } = { row: 0, column: 0 }
	endPosition: { row: number; column: number } = { row: 0, column: 0 }
	type: string = ""
	text: string = ""
	isNamed: boolean = true
	tree: any = {}
	parent: any = null
	childCount: number = 0
	namedChildCount: number = 0
	firstChild: any = null
	lastChild: any = null
	firstNamedChild: any = null
	lastNamedChild: any = null
	nextSibling: any = null
	previousSibling: any = null
	nextNamedSibling: any = null
	previousNamedSibling: any = null
	_childFunction: ((index: number) => any) | null = null
	descendantForPosition: ((startPosition: any, endPosition?: any) => any) | null = null

	constructor(props: Partial<MockNode> = {}) {
		Object.assign(this, props)
	}

	child(index: number): any {
		if (this._childFunction) {
			return this._childFunction(index)
		}
		return null
	}

	namedChild(index: number): any {
		return null
	}

	childForFieldName(fieldName: string): any {
		return null
	}

	childForFieldId(fieldId: number): any {
		return null
	}

	descendantForIndex(startIndex: number, endIndex?: number): any {
		return null
	}

	toString(): string {
		return this.text
	}

	walk(): any {
		return {}
	}

	namedDescendantForIndex(startIndex: number, endIndex?: number): any {
		return null
	}

	namedDescendantForPosition(startPosition: any, endPosition?: any): any {
		return null
	}

	descendantsOfType(type: string | string[], startPosition?: any, endPosition?: any): any[] {
		return []
	}
}

// Mock web-tree-sitter
vi.mock("web-tree-sitter", () => ({
	Node: vi.fn().mockImplementation(() => ({})),
}))

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
	let mockASTContext: ASTContext
	let mockRangeASTNode: MockNode

	beforeEach(() => {
		strategy = new GhostStrategy()
		mockDocument = new MockTextDocument(vscode.Uri.parse("file:///test.js"), "function test() {\n  return true;\n}")

		// Create child node
		const childNode = new MockNode({
			type: "return_statement",
			text: "return true;",
		})

		// Create parent node
		const parentNode = new MockNode({
			type: "function_declaration",
			text: "function test() { return true; }",
		})

		// Create previous sibling
		const prevSibling = new MockNode({
			type: "keyword",
			text: "function",
		})

		// Create next sibling
		const nextSibling = new MockNode({
			type: "parameters",
			text: "()",
		})

		// Create the main node with a proper child function
		mockRangeASTNode = new MockNode({
			type: "identifier",
			text: "test",
			parent: parentNode,
			previousSibling: prevSibling,
			nextSibling: nextSibling,
			childCount: 1,
			_childFunction: (index: number) => (index === 0 ? childNode : null),
		})

		// Create mock root node
		const mockRootNode = new MockNode({
			type: "program",
			text: "function test() { return true; }",
		})
		mockRootNode.descendantForPosition = vi.fn().mockReturnValue(mockRangeASTNode)

		// Create mock AST context
		mockASTContext = {
			rootNode: mockRootNode as any,
			language: "javascript",
		}
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("parseResponse", () => {
		it("should handle search-and-replace XML format", async () => {
			// Get the exact content from the mock document to ensure perfect matching
			const documentContent = mockDocument.getText()

			// Create the search and replace response using the exact document content
			const searchAndReplaceResponse = `<change><search><![CDATA[${documentContent}]]></search><replace><![CDATA[function test() {
		// Added comment
		return true;
}]]></replace></change>`
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			const result = await strategy.parseResponse(searchAndReplaceResponse, context)
			expect(result.hasSuggestions()).toBe(true)

			// Verify that the suggestion file was created and has operations
			const file = result.getFile(mockDocument.uri)
			expect(file).toBeDefined()
			expect(file!.isEmpty()).toBe(false)

			// Verify that operations were created
			const operations = file!.getAllOperations()
			expect(operations.length).toBeGreaterThan(0)
		})

		it("should return empty suggestions for unrecognized format", async () => {
			const unrecognizedResponse = "This is just plain text without any recognized format"
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			const result = await strategy.parseResponse(unrecognizedResponse, context)
			expect(result.hasSuggestions()).toBe(false)
		})

		it("should find and replace search patterns with trailing whitespace", async () => {
			// Test case to verify that the parseSearchAndReplaceFormat function
			// correctly finds and replaces content when search patterns have trailing whitespace
			const originalContent = `function App() {
		const fibonnaci =

		return (
		  <div>Hello</div>
		);
}`

			const testDocument = new MockTextDocument(vscode.Uri.parse("file:///App.tsx"), originalContent)

			const searchAndReplaceResponse = `<change><search><![CDATA[  const fibonnaci =
]]></search><replace><![CDATA[  const fibonacci = (n: number): number => {
			 if (n <= 1) return n;
			 return fibonacci(n - 1) + fibonacci(n - 2);
		};
]]></replace></change>`

			const context: GhostSuggestionContext = {
				document: testDocument,
			}

			const result = await strategy.parseResponse(searchAndReplaceResponse, context)
			expect(result.hasSuggestions()).toBe(true)

			// Verify that the search pattern was found and suggestions were created
			const suggestionFile = result.getFile(testDocument.uri)
			expect(suggestionFile).toBeDefined()

			// Check that operations were created (this means the search pattern was found)
			const operations = suggestionFile!.getAllOperations()
			expect(operations.length).toBeGreaterThan(0)

			// Verify that some operations are additions (meaning replacement content was added)
			const addOperations = operations.filter((op) => op.type === "+")
			expect(addOperations.length).toBeGreaterThan(0)

			// Check that the replacement content includes the function definition
			const hasFunction = addOperations.some((op) => op.content.includes("fibonacci = (n: number): number =>"))
			expect(hasFunction).toBe(true)
		})
	})
})

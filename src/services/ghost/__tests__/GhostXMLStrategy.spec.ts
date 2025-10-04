import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import * as vscode from "vscode"
import { GhostXmlStrategy } from "../GhostXmlStrategy"
import { GhostSuggestionContext, ASTContext } from "../types"
import { MockTextDocument } from "../../mocking/MockTextDocument"
import { PromptStrategyManager } from "../PromptStrategyManager"

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
	DiagnosticSeverity: {
		Error: 0,
		Warning: 1,
		Information: 2,
		Hint: 3,
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

describe("GhostXMLStrategy", () => {
	let strategy: GhostXmlStrategy
	let mockDocument: MockTextDocument
	let mockASTContext: ASTContext
	let mockRangeASTNode: MockNode

	beforeEach(() => {
		strategy = new GhostXmlStrategy()
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

		it("should finish streaming parser and return final results", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			strategy.initializeStreamingParser(context)

			// Add some partial content
			strategy.processStreamingChunk("<change><search><![CDATA[test")

			// Finish should handle any remaining content
			const result = strategy.finishStreamingParser()
			expect(result).toBeDefined()
			expect(result.suggestions).toBeDefined()
		})
	})

	describe("prompt generation", () => {
		it("should generate system prompt", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
			}
			const systemPrompt = strategy.getSystemPrompt(context)
			expect(systemPrompt).toContain("CRITICAL OUTPUT FORMAT")
			expect(systemPrompt).toContain("XML-formatted changes")
		})

		it("should generate suggestion prompt with context", () => {
			const context: GhostSuggestionContext = {
				document: mockDocument,
				userInput: "Add a comment",
				range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
			}

			const suggestionPrompt = strategy.getSuggestionPrompt(context)
			expect(suggestionPrompt).toContain("Add a comment")
			expect(suggestionPrompt).toContain("<<<AUTOCOMPLETE_HERE>>>")
		})

		it("should use PromptStrategyManager to generate system prompt", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
				userInput: "Complete this function",
			}

			const prompt = strategy.getSystemPrompt(context)

			// Should contain base instructions from strategy system
			expect(prompt).toContain("CRITICAL OUTPUT FORMAT")
		})

		it("should select UserRequestStrategy when user input is provided", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				lineAt: (line: number) => ({ text: "const x = 1;" }),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
				userInput: "Add a function to calculate sum",
			}

			const systemPrompt = strategy.getSystemPrompt(context)
			const userPrompt = strategy.getSuggestionPrompt(context)

			// UserRequestStrategy should be selected
			expect(systemPrompt).toContain("Execute User's Explicit Request")
			expect(userPrompt).toContain("Add a function to calculate sum")
		})

		it("should delegate to PromptStrategyManager", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				lineAt: (line: number) => ({ text: "const x = 1;" }),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			const prompt = strategy.getSuggestionPrompt(context)

			// Should return a structured prompt
			expect(prompt).toBeDefined()
			expect(prompt.length).toBeGreaterThan(0)
		})
	})

	describe("Integration", () => {
		it("should work with both system and user prompts", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				lineAt: (line: number) => ({ text: "const x = 1;" }),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
				userInput: "Complete this function",
			}

			const systemPrompt = strategy.getSystemPrompt(context)
			const userPrompt = strategy.getSuggestionPrompt(context)

			// System prompt should contain format instructions
			expect(systemPrompt).toContain("CRITICAL OUTPUT FORMAT")
			// User prompt should contain the user input
			expect(userPrompt).toContain("Complete this function")
		})

		it("should properly delegate to PromptStrategyManager", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			const systemPrompt = strategy.getSystemPrompt(context)
			const userPrompt = strategy.getSuggestionPrompt(context)

			expect(systemPrompt).toBeDefined()
			expect(systemPrompt.length).toBeGreaterThan(0)
			expect(userPrompt).toBeDefined()
			expect(userPrompt.length).toBeGreaterThan(0)
		})

		it("should properly integrate with strategy manager for all use cases", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;\n",
				lineAt: (line: number) => ({ text: line === 0 ? "const x = 1;" : "" }),
				lineCount: 2,
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => (position.line === 0 ? 13 : 14),
			} as vscode.TextDocument

			// Test different contexts
			const contexts = [
				// User request
				{
					document: mockDocument,
					userInput: "Add type annotation",
				},
				// Error fix
				{
					document: mockDocument,
					diagnostics: [
						{
							severity: vscode.DiagnosticSeverity.Error,
							message: "Type error",
							range: { start: { line: 0 } } as vscode.Range,
						} as vscode.Diagnostic,
					],
				},
				// Selection refactor
				{
					document: mockDocument,
					range: {
						isEmpty: false,
						start: { line: 0, character: 0 },
						end: { line: 0, character: 12 },
					} as vscode.Range,
				},
				// New line completion
				{
					document: mockDocument,
					range: {
						isEmpty: true,
						start: { line: 1, character: 0 },
					} as vscode.Range,
				},
			]

			contexts.forEach((context) => {
				const systemPrompt = strategy.getSystemPrompt(context as GhostSuggestionContext)
				const userPrompt = strategy.getSuggestionPrompt(context as GhostSuggestionContext)

				expect(systemPrompt).toBeDefined()
				expect(systemPrompt.length).toBeGreaterThan(0)
				expect(userPrompt).toBeDefined()
				expect(userPrompt.length).toBeGreaterThan(0)
			})
		})
	})

	describe("Strategy Selection", () => {
		let manager: PromptStrategyManager

		beforeEach(() => {
			manager = new PromptStrategyManager()
		})

		it("should select appropriate strategy based on context", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "// TODO: implement sum function\n",
				lineAt: (line: number) => ({
					text: line === 0 ? "// TODO: implement sum function" : "",
					lineNumber: line,
				}),
				lineCount: 2,
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => (position.line === 1 ? 32 : 0),
			} as vscode.TextDocument

			const mockRange = {
				start: { line: 1, character: 0 } as vscode.Position,
				end: { line: 1, character: 0 } as vscode.Position,
				isEmpty: true,
			} as vscode.Range

			// Test comment-driven context
			const commentContext: GhostSuggestionContext = {
				document: mockDocument,
				range: mockRange,
			}

			const result = manager.buildPrompt(commentContext)

			// Should select UserRequestStrategy when there's a comment context
			// The strategy selection logic prioritizes user requests over new line completion
			expect(result.strategy.name).toBe("User Request")
		})

		it("should fallback to UserRequestStrategy when no specific strategy matches", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;\n",
				lineAt: (line: number) => ({ text: "const x = 1;" }),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			const result = manager.buildPrompt(context)

			// Should fallback to UserRequestStrategy (the default strategy)
			expect(result.strategy.name).toBe("User Request")
		})
	})
})

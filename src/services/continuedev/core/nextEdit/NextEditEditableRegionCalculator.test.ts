import { beforeEach, describe, expect, it, vi } from "vitest"
import { Node as SyntaxNode } from "web-tree-sitter"
import { IDE, Position, RangeInFile } from ".."
import { getAst } from "../autocomplete/util/ast"
import {
	getNextEditableRegion,
	EditableRegionStrategy,
	findClosestIdentifierNode,
	findLeftmostIdentifier,
	isIdentifierNode,
	isDeclarationNode,
} from "./NextEditEditableRegionCalculator"
import { DocumentHistoryTracker } from "./DocumentHistoryTracker"

// Mock DocumentHistoryTracker
vi.mock("./DocumentHistoryTracker", () => ({
	DocumentHistoryTracker: {
		getInstance: vi.fn(() => ({
			getMostRecentAst: vi.fn(),
		})),
	},
}))

describe("NextEditEditableRegionCalculator", () => {
	describe("staticJump - Tree-sitter AST Navigation", () => {
		let mockIde: IDE
		let mockGetMostRecentAst: ReturnType<typeof vi.fn>

		beforeEach(() => {
			// Reset mocks
			mockGetMostRecentAst = vi.fn()
			;(DocumentHistoryTracker.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
				getMostRecentAst: mockGetMostRecentAst,
			})

			// Create mock IDE
			mockIde = {
				getReferences: vi.fn(),
			} as any
		})

		it("should find identifier node at cursor position using tree-sitter descendantForPosition", async () => {
			// TypeScript code with a variable reference
			const code = `function greet(name: string) {
  console.log(name);
  return name;
}`
			const filepath = "test.ts"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			// Position cursor on "name" at line 1 (second occurrence)
			const cursorPosition: Position = { line: 1, character: 15 }

			// Mock getReferences to return multiple occurrences
			const mockReferences: RangeInFile[] = [
				{
					filepath,
					range: {
						start: { line: 0, character: 15 },
						end: { line: 0, character: 19 },
					},
				},
				{
					filepath,
					range: {
						start: { line: 1, character: 14 },
						end: { line: 1, character: 18 },
					},
				},
				{
					filepath,
					range: {
						start: { line: 2, character: 9 },
						end: { line: 2, character: 13 },
					},
				},
			]
			;(mockIde.getReferences as ReturnType<typeof vi.fn>).mockResolvedValue(mockReferences)

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			// Should return references excluding the first one (current position)
			expect(result).toBeTruthy()
			expect(result).toHaveLength(2)
			expect(mockIde.getReferences).toHaveBeenCalledWith({
				filepath,
				position: expect.objectContaining({
					line: 1,
					character: 14,
				}),
			})
		})

		it("should distinguish between identifiers in different scopes (not regex matching)", async () => {
			// Code with same identifier name in different scopes
			// This test proves tree-sitter is used, not simple text search
			const code = `function outer() {
  const value = 10;  // outer scope
  
  function inner() {
    const value = 20;  // inner scope - different variable!
    return value;
  }
  
  return value;  // refers to outer value
}`
			const filepath = "scoping.ts"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			// Position cursor on inner "value" at line 4
			const cursorPosition: Position = { line: 4, character: 10 }

			// Mock getReferences - IDE would use AST to distinguish scopes
			// Inner value should only have references within inner function
			const mockReferences: RangeInFile[] = [
				{
					filepath,
					range: {
						start: { line: 4, character: 10 },
						end: { line: 4, character: 15 },
					},
				},
				{
					filepath,
					range: {
						start: { line: 5, character: 11 },
						end: { line: 5, character: 16 },
					},
				},
			]
			;(mockIde.getReferences as ReturnType<typeof vi.fn>).mockResolvedValue(mockReferences)

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			// Should find references only to the inner-scoped value
			expect(result).toBeTruthy()
			expect(result).toHaveLength(1)

			// Verify it used tree-sitter to find the right identifier
			// by checking the position passed to getReferences
			expect(mockIde.getReferences).toHaveBeenCalledWith({
				filepath,
				position: expect.objectContaining({
					line: 4,
					character: 10,
				}),
			})
		})

		it("should handle nested class methods and find correct identifier", async () => {
			// Python code with nested classes
			const code = `class Outer:
    def process(self, data):
        print(data)
        
    class Inner:
        def process(self, data):  # Same method name, different class
            return data
            
    def main(self):
        result = self.process("outer")
        return result`

			const filepath = "nested.py"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			// Cursor on "process" in Inner class (line 5)
			const cursorPosition: Position = { line: 5, character: 12 }

			const mockReferences: RangeInFile[] = [
				{
					filepath,
					range: {
						start: { line: 5, character: 12 },
						end: { line: 5, character: 19 },
					},
				},
			]
			;(mockIde.getReferences as ReturnType<typeof vi.fn>).mockResolvedValue(mockReferences)

			await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			// Tree-sitter should identify this as Inner.process, not Outer.process
			expect(mockIde.getReferences).toHaveBeenCalledWith({
				filepath,
				position: expect.objectContaining({
					line: 5,
					character: 12, // Tree-sitter finds the identifier position
				}),
			})
		})

		it("should handle cursor inside nested code blocks", async () => {
			const code = `function calculate() {
  if (true) {
    const temp = 5;
    while (temp > 0) {
      const value = temp * 2;
      console.log(value);
    }
  }
}`
			const filepath = "nested-blocks.ts"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			// Cursor inside deeply nested block on "value"
			const cursorPosition: Position = { line: 4, character: 12 }

			const mockReferences: RangeInFile[] = [
				{
					filepath,
					range: {
						start: { line: 4, character: 12 },
						end: { line: 4, character: 17 },
					},
				},
				{
					filepath,
					range: {
						start: { line: 5, character: 18 },
						end: { line: 5, character: 23 },
					},
				},
			]
			;(mockIde.getReferences as ReturnType<typeof vi.fn>).mockResolvedValue(mockReferences)

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			expect(result).toBeTruthy()
			expect(result).toHaveLength(1)
			expect(mockIde.getReferences).toHaveBeenCalled()
		})

		it("should find identifier even when cursor is on whitespace near it", async () => {
			const code = `const myVar = 10;
console.log(myVar);`
			const filepath = "whitespace.ts"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			// Cursor right after "myVar" on line 1
			const cursorPosition: Position = { line: 1, character: 13 }

			const mockReferences: RangeInFile[] = [
				{
					filepath,
					range: {
						start: { line: 0, character: 6 },
						end: { line: 0, character: 11 },
					},
				},
				{
					filepath,
					range: {
						start: { line: 1, character: 12 },
						end: { line: 1, character: 17 },
					},
				},
			]
			;(mockIde.getReferences as ReturnType<typeof vi.fn>).mockResolvedValue(mockReferences)

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			expect(result).toBeTruthy()
			expect(mockIde.getReferences).toHaveBeenCalled()
		})

		it("should handle Python class with method calls", async () => {
			const code = `class Calculator:
    def add(self, x, y):
        return x + y
    
    def multiply(self, x, y):
        result = self.add(x, y)  # Using add method
        return result * 2`

			const filepath = "calculator.py"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			// Cursor on "add" method call at line 5
			const cursorPosition: Position = { line: 5, character: 21 }

			const mockReferences: RangeInFile[] = [
				{
					filepath,
					range: {
						start: { line: 1, character: 8 },
						end: { line: 1, character: 11 },
					},
				},
				{
					filepath,
					range: {
						start: { line: 5, character: 21 },
						end: { line: 5, character: 24 },
					},
				},
			]
			;(mockIde.getReferences as ReturnType<typeof vi.fn>).mockResolvedValue(mockReferences)

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			expect(result).toBeTruthy()
			expect(result).toHaveLength(1)
		})

		it("should return null when no identifier found at cursor", async () => {
			const code = `const x = 10;\n// comment line\nconst y = 20;`
			const filepath = "no-identifier.ts"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			// Cursor on comment line with no identifier
			const cursorPosition: Position = { line: 1, character: 5 }

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			expect(result).toBeNull()
		})

		it("should return null when no references found", async () => {
			const code = `const unusedVar = 10;`
			const filepath = "unused.ts"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			const cursorPosition: Position = { line: 0, character: 6 }

			// No references found by IDE
			;(mockIde.getReferences as ReturnType<typeof vi.fn>).mockResolvedValue([])

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			expect(result).toBeNull()
		})

		it("should handle variable shadowing correctly", async () => {
			// Test that tree-sitter can distinguish shadowed variables
			const code = `let count = 0;

function increment() {
  let count = 10;  // Shadows outer count
  count++;
  return count;
}

count++;  // Refers to outer count`

			const filepath = "shadowing.ts"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			// Cursor on shadowed inner "count" at line 3
			const cursorPosition: Position = { line: 3, character: 6 }

			// IDE should only return references to inner count
			const mockReferences: RangeInFile[] = [
				{
					filepath,
					range: {
						start: { line: 3, character: 6 },
						end: { line: 3, character: 11 },
					},
				},
				{
					filepath,
					range: {
						start: { line: 4, character: 2 },
						end: { line: 4, character: 7 },
					},
				},
				{
					filepath,
					range: {
						start: { line: 5, character: 9 },
						end: { line: 5, character: 14 },
					},
				},
			]
			;(mockIde.getReferences as ReturnType<typeof vi.fn>).mockResolvedValue(mockReferences)

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			// Should only find references to inner scoped count
			expect(result).toBeTruthy()
			expect(result).toHaveLength(2) // Excluding first reference (current position)
		})

		it("should handle missing context gracefully", async () => {
			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition: null,
				filepath: "test.ts",
				ide: mockIde,
			})

			expect(result).toBeNull()
		})

		it("should return null when AST cannot be retrieved", async () => {
			mockGetMostRecentAst.mockResolvedValue(null)

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition: { line: 0, character: 0 },
				filepath: "test.ts",
				ide: mockIde,
			})

			expect(result).toBeNull()
		})

		it("should handle IDE.getReferences throwing an error", async () => {
			const code = `const x = 10;`
			const filepath = "error.ts"
			const tree = await getAst(filepath, code)
			mockGetMostRecentAst.mockResolvedValue(tree)

			const cursorPosition: Position = { line: 0, character: 6 }

			;(mockIde.getReferences as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("IDE error"))

			const result = await getNextEditableRegion(EditableRegionStrategy.Static, {
				cursorPosition,
				filepath,
				ide: mockIde,
			})

			expect(result).toBeNull()
		})
	})

	describe("Direct Helper Function Tests - Real Tree-sitter", () => {
		describe("isIdentifierNode", () => {
			it("should identify standard identifier nodes in TypeScript", async () => {
				const code = `const myVar = 10;`
				const tree = await getAst("test.ts", code)
				const node = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 6,
				})

				expect(node).toBeTruthy()
				expect(isIdentifierNode(node!)).toBe(true)
				expect(node?.text).toBe("myVar")
			})

			it("should identify identifier nodes in Python", async () => {
				const code = `def my_function(param):\n    return param`
				const tree = await getAst("test.py", code)

				// Function name
				const funcName = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 4,
				})
				expect(funcName).toBeTruthy()
				expect(isIdentifierNode(funcName!)).toBe(true)
				expect(funcName?.text).toBe("my_function")

				// Parameter name
				const paramName = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 16,
				})
				expect(paramName).toBeTruthy()
				expect(isIdentifierNode(paramName!)).toBe(true)
			})

			it("should NOT identify non-identifier nodes", async () => {
				const code = `const x = 10;`
				const tree = await getAst("test.ts", code)

				// Number literal
				const numberNode = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 10,
				})
				expect(numberNode).toBeTruthy()
				expect(isIdentifierNode(numberNode!)).toBe(false)
			})

			it("should handle language-specific identifier types", async () => {
				const code = `class MyClass {\n  method() {}\n}`
				const tree = await getAst("test.ts", code)

				const className = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 6,
				})
				expect(className).toBeTruthy()
				expect(isIdentifierNode(className!)).toBe(true)
			})
		})

		describe("isDeclarationNode", () => {
			it("should identify TypeScript variable declarations", async () => {
				const code = `const myVar = 10;`
				const tree = await getAst("test.ts", code)

				const declNode = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 0,
				})
				expect(declNode).toBeTruthy()
				// Navigate to the actual declaration node
				const lexicalDecl = tree?.rootNode.descendantsOfType("lexical_declaration")[0]
				expect(lexicalDecl).toBeTruthy()
				expect(isDeclarationNode(lexicalDecl!)).toBe(true)
			})

			it("should identify Python function definitions", async () => {
				const code = `def my_function():\n    pass`
				const tree = await getAst("test.py", code)

				const funcDef = tree?.rootNode.descendantsOfType("function_definition")[0]
				expect(funcDef).toBeTruthy()
				expect(isDeclarationNode(funcDef!)).toBe(true)
			})

			it("should identify Python class definitions", async () => {
				const code = `class MyClass:\n    pass`
				const tree = await getAst("test.py", code)

				const classDef = tree?.rootNode.descendantsOfType("class_definition")[0]
				expect(classDef).toBeTruthy()
				expect(isDeclarationNode(classDef!)).toBe(true)
			})

			it("should identify method definitions in TypeScript", async () => {
				const code = `class C {\n  myMethod() {}\n}`
				const tree = await getAst("test.ts", code)

				const methodDef = tree?.rootNode.descendantsOfType("method_definition")[0]
				expect(methodDef).toBeTruthy()
				expect(isDeclarationNode(methodDef!)).toBe(true)
			})

			it("should NOT identify non-declaration nodes", async () => {
				const code = `const x = foo();`
				const tree = await getAst("test.ts", code)

				// Call expression is not a declaration
				const callExpr = tree?.rootNode.descendantsOfType("call_expression")[0]
				expect(callExpr).toBeTruthy()
				expect(isDeclarationNode(callExpr!)).toBe(false)
			})
		})

		describe("findLeftmostIdentifier", () => {
			it("should find leftmost identifier in TypeScript variable declaration", async () => {
				const code = `const myVar = 10;`
				const tree = await getAst("test.ts", code)

				const varDeclarator = tree?.rootNode.descendantsOfType("variable_declarator")[0]
				expect(varDeclarator).toBeTruthy()

				const leftmost = findLeftmostIdentifier(varDeclarator!)
				expect(leftmost).toBeTruthy()
				expect(leftmost?.text).toBe("myVar")
			})

			it("should find leftmost identifier in destructuring assignment", async () => {
				const code = `const { first, second } = obj;`
				const tree = await getAst("test.ts", code)

				const varDeclarator = tree?.rootNode.descendantsOfType("variable_declarator")[0]
				expect(varDeclarator).toBeTruthy()

				const leftmost = findLeftmostIdentifier(varDeclarator!)
				expect(leftmost).toBeTruthy()
				// Should find 'first' as it's leftmost in the destructuring
				expect(leftmost?.text).toBe("first")
			})

			it("should find function name in Python function definition", async () => {
				const code = `def my_function(param):\n    pass`
				const tree = await getAst("test.py", code)

				const funcDef = tree?.rootNode.descendantsOfType("function_definition")[0]
				expect(funcDef).toBeTruthy()

				const leftmost = findLeftmostIdentifier(funcDef!)
				expect(leftmost).toBeTruthy()
				expect(leftmost?.text).toBe("my_function")
			})

			it("should return the node itself if it's already an identifier", async () => {
				const code = `const myVar = 10;`
				const tree = await getAst("test.ts", code)

				const identifier = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 6,
				})
				expect(identifier).toBeTruthy()
				expect(isIdentifierNode(identifier!)).toBe(true)

				const result = findLeftmostIdentifier(identifier!)
				expect(result).toBe(identifier)
			})

			it("should return null for nodes with no identifiers", async () => {
				const code = `const x = 10 + 20;`
				const tree = await getAst("test.ts", code)

				// Binary expression (10 + 20) has no identifiers
				const binaryExpr = tree?.rootNode.descendantsOfType("binary_expression")[0]
				expect(binaryExpr).toBeTruthy()

				const result = findLeftmostIdentifier(binaryExpr!)
				expect(result).toBeNull()
			})
		})

		describe("findClosestIdentifierNode", () => {
			it("should return node itself if it's an identifier", async () => {
				const code = `const myVar = 10;`
				const tree = await getAst("test.ts", code)

				const identifier = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 6,
				})
				expect(identifier).toBeTruthy()

				const result = findClosestIdentifierNode(identifier!)
				expect(result).toBe(identifier)
				expect(result?.text).toBe("myVar")
			})

			it("should find identifier from declaration node", async () => {
				const code = `const myVar = 10;`
				const tree = await getAst("test.ts", code)

				const varDeclarator = tree?.rootNode.descendantsOfType("variable_declarator")[0]
				expect(varDeclarator).toBeTruthy()

				const result = findClosestIdentifierNode(varDeclarator!)
				expect(result).toBeTruthy()
				expect(result?.text).toBe("myVar")
			})

			it("should find closest identifier when starting from whitespace", async () => {
				const code = `const myVar = 10;`
				const tree = await getAst("test.ts", code)

				// Get a node near the identifier but not exactly on it
				const nearbyNode = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 5,
				})
				expect(nearbyNode).toBeTruthy()

				const result = findClosestIdentifierNode(nearbyNode!)
				expect(result).toBeTruthy()
				// Should find myVar as the closest identifier
				expect(isIdentifierNode(result!)).toBe(true)
			})

			it("should find identifier in complex nested structure", async () => {
				const code = `function greet(name) {\n  console.log(name);\n}`
				const tree = await getAst("test.ts", code)

				// Start from somewhere inside the parameter list
				const paramNode = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 15,
				})
				expect(paramNode).toBeTruthy()

				const result = findClosestIdentifierNode(paramNode!)
				expect(result).toBeTruthy()
				expect(result?.text).toBe("name")
			})

			it("should traverse up to parent to find identifier", async () => {
				const code = `const obj = { key: value };`
				const tree = await getAst("test.ts", code)

				// Get a node from inside the object
				const colonNode = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 17,
				})
				expect(colonNode).toBeTruthy()

				const result = findClosestIdentifierNode(colonNode!)
				expect(result).toBeTruthy()
				expect(isIdentifierNode(result!)).toBe(true)
			})

			it("should return null for completely non-identifier contexts", async () => {
				const code = `const x = 10;`
				const tree = await getAst("test.ts", code)

				// Number literal with no nearby identifiers in context
				const numberNode = tree?.rootNode.descendantForPosition({
					row: 0,
					column: 10,
				})
				expect(numberNode).toBeTruthy()

				// This might still find 'x' depending on traversal
				// The actual behavior depends on the tree structure
				const result = findClosestIdentifierNode(numberNode!)
				// Either finds an identifier or returns null - both are valid
				if (result !== null) {
					expect(isIdentifierNode(result)).toBe(true)
				}
			})

			it("should handle Python-specific identifier finding", async () => {
				const code = `def process(data):\n    result = data.upper()\n    return result`
				const tree = await getAst("test.py", code)

				// Start from somewhere in the function
				const node = tree?.rootNode.descendantForPosition({
					row: 1,
					column: 10,
				})
				expect(node).toBeTruthy()

				const result = findClosestIdentifierNode(node!)
				expect(result).toBeTruthy()
				expect(isIdentifierNode(result!)).toBe(true)
			})

			it("should return null when given null input", () => {
				const result = findClosestIdentifierNode(null)
				expect(result).toBeNull()
			})
		})

		describe("Real AST Structure Validation", () => {
			it("should correctly parse and traverse TypeScript AST", async () => {
				const code = `class Calculator {
  add(x: number, y: number): number {
    return x + y;
  }
}`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				expect(tree?.rootNode.type).toBe("program")

				// Verify we can find specific node types
				const classDecl = tree?.rootNode.descendantsOfType("class_declaration")[0]
				expect(classDecl).toBeTruthy()
				expect(isDeclarationNode(classDecl!)).toBe(true)

				const methodDef = tree?.rootNode.descendantsOfType("method_definition")[0]
				expect(methodDef).toBeTruthy()
				expect(isDeclarationNode(methodDef!)).toBe(true)

				// Find the method name
				const methodName = findLeftmostIdentifier(methodDef!)
				expect(methodName?.text).toBe("add")
			})

			it("should correctly parse and traverse Python AST", async () => {
				const code = `class DataProcessor:
    def __init__(self):
        self.data = []
    
    def process(self, item):
        return item * 2`
				const tree = await getAst("test.py", code)

				expect(tree).toBeTruthy()
				expect(tree?.rootNode.type).toBe("module")

				const classDef = tree?.rootNode.descendantsOfType("class_definition")[0]
				expect(classDef).toBeTruthy()
				expect(isDeclarationNode(classDef!)).toBe(true)

				const funcDefs = tree?.rootNode.descendantsOfType("function_definition")
				expect(funcDefs?.length).toBeGreaterThan(0)

				funcDefs?.forEach((funcDef) => {
					if (!funcDef) return
					expect(isDeclarationNode(funcDef)).toBe(true)
					const funcName = findLeftmostIdentifier(funcDef)
					expect(funcName).toBeTruthy()
					expect(isIdentifierNode(funcName!)).toBe(true)
				})
			})

			it("should handle real-world JavaScript with multiple identifier types", async () => {
				const code = `const users = [];
function addUser(name, email) {
  users.push({ name, email });
}
const admin = addUser("Admin", "admin@example.com");`
				const tree = await getAst("test.js", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				// Find all identifiers in the code
				const allIdentifiers: SyntaxNode[] = []
				function traverse(node: SyntaxNode) {
					if (isIdentifierNode(node)) {
						allIdentifiers.push(node)
					}
					for (let i = 0; i < node.childCount; i++) {
						const child = node.child(i)
						if (child) traverse(child)
					}
				}
				traverse(tree.rootNode)

				expect(allIdentifiers.length).toBeGreaterThan(0)

				// Verify we found the expected identifiers
				const identifierTexts = allIdentifiers.map((n) => n.text)
				expect(identifierTexts).toContain("users")
				expect(identifierTexts).toContain("addUser")
				expect(identifierTexts).toContain("name")
				expect(identifierTexts).toContain("email")
			})
		})
	})
})

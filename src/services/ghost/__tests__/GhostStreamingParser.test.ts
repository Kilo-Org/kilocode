import { GhostStreamingParser, findBestMatch } from "../GhostStreamingParser"
import { GhostSuggestionContext, GhostSuggestionEditOperation } from "../types"

// Mock vscode module
vi.mock("vscode", () => ({
	Uri: {
		file: (path: string) => ({ toString: () => path, fsPath: path }),
	},
	workspace: {
		asRelativePath: (uri: any) => uri.toString(),
	},
}))

describe("GhostStreamingParser", () => {
	let parser: GhostStreamingParser
	let mockDocument: any
	let context: GhostSuggestionContext

	beforeEach(() => {
		parser = new GhostStreamingParser()

		// Create mock document
		mockDocument = {
			uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
			getText: () => `function test() {
	return true;
}`,
			languageId: "typescript",
		}

		context = {
			document: mockDocument,
		}

		parser.initialize(context)
	})

	afterEach(() => {
		parser.reset()
	})

	describe("finishStream", () => {
		it("should handle incomplete XML", () => {
			const incompleteXml = "<change><search><![CDATA["
			const result = parser.parseResponse(incompleteXml)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(false)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should parse complete change blocks", () => {
			const completeChange = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment
	return true;
}]]></replace></change>`

			const result = parser.parseResponse(completeChange)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})

		it("should handle complete response built from multiple chunks", () => {
			const fullResponse = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment
	return true;
}]]></replace></change>`

			const result = parser.parseResponse(fullResponse)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})

		it("should handle multiple complete changes", () => {
			const fullResponse = `<change><search><![CDATA[function test() {]]></search><replace><![CDATA[function test() {
	// First change]]></replace></change><change><search><![CDATA[return true;]]></search><replace><![CDATA[return false; // Second change]]></replace></change>`

			const result = parser.parseResponse(fullResponse)

			expect(result.hasNewSuggestions).toBe(true)
			expect(parser.getCompletedChanges()).toHaveLength(2)
		})

		it("should detect when response is complete", () => {
			const completeResponse = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment
	return true;
}]]></replace></change>`

			const result = parser.parseResponse(completeResponse)

			expect(result.isComplete).toBe(true)
		})

		it("should detect incomplete response", () => {
			const incompleteResponse = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment`

			const result = parser.parseResponse(incompleteResponse)

			expect(result.isComplete).toBe(false)
		})

		it("should handle cursor marker correctly", () => {
			const changeWithCursor = `<change><search><![CDATA[function test() {
	<<<AUTOCOMPLETE_HERE>>>return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment<<<AUTOCOMPLETE_HERE>>>
	return true;
}]]></replace></change>`

			const result = parser.parseResponse(changeWithCursor)

			expect(result.hasNewSuggestions).toBe(true)
			// Verify cursor marker is preserved in search content for matching
			const changes = parser.getCompletedChanges()
			expect(changes[0].search).toContain("<<<AUTOCOMPLETE_HERE>>>") // Should preserve in search for matching
			expect(changes[0].replace).toContain("<<<AUTOCOMPLETE_HERE>>>") // Should preserve in replace
			expect(changes[0].cursorPosition).toBeDefined() // Should have cursor position info
		})

		it("should extract cursor position correctly", () => {
			const changeWithCursor = `<change><search><![CDATA[return true;]]></search><replace><![CDATA[// Comment here<<<AUTOCOMPLETE_HERE>>>
	return false;]]></replace></change>`

			const result = parser.parseResponse(changeWithCursor)

			expect(result.hasNewSuggestions).toBe(true)
			const changes = parser.getCompletedChanges()
			expect(changes[0].cursorPosition).toBe(15) // Position after "// Comment here"
		})

		it("should handle cursor marker in search content for matching", () => {
			// Mock document WITHOUT cursor marker (parser should add it)
			const mockDocumentWithoutCursor: any = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `function test() {
	return true;
}`,
				languageId: "typescript",
				offsetAt: (position: any) => 20, // Mock cursor position
			}

			const mockRange: any = {
				start: { line: 1, character: 1 },
				end: { line: 1, character: 1 },
				isEmpty: true,
				isSingleLine: true,
			}

			const contextWithCursor = {
				document: mockDocumentWithoutCursor,
				range: mockRange,
			}

			parser.initialize(contextWithCursor)

			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[// New function
function fibonacci(n: number): number {
		if (n <= 1) return n;
		return fibonacci(n - 1) + fibonacci(n - 2);
}]]></replace></change>`

			const result = parser.parseResponse(changeWithCursor)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})

		it("should handle document that already contains cursor marker", () => {
			// Mock document that already contains cursor marker
			const mockDocumentWithCursor: any = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `function test() {
	<<<AUTOCOMPLETE_HERE>>>
}`,
				languageId: "typescript",
			}

			const contextWithCursor = {
				document: mockDocumentWithCursor,
			}

			parser.initialize(contextWithCursor)

			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[// New function
function fibonacci(n: number): number {
		if (n <= 1) return n;
		return fibonacci(n - 1) + fibonacci(n - 2);
}]]></replace></change>`

			const result = parser.parseResponse(changeWithCursor)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})

		it("should not create extra newline when replacing cursor marker on empty line", () => {
			// Mock document with cursor marker on an empty line (line 17)
			const mockDocumentWithCursor: any = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `function test() {
	return true;
}

// Some other code
function another() {
	const x = 1;
}

// Line 16
<<<AUTOCOMPLETE_HERE>>>
// Line 18`,
				languageId: "typescript",
			}

			const contextWithCursor = {
				document: mockDocumentWithCursor,
			}

			parser.initialize(contextWithCursor)

			// This is the exact response from the logs showing the issue
			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[// implement function to calculate factorial
function calculateFactorial(n: number): number {
		  if (n <= 1) return 1;
		  return n * calculateFactorial(n - 1);
}]]></replace></change>`

			const result = parser.parseResponse(changeWithCursor)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)

			// Verify the result doesn't have an extra blank line before "// Line 18"
			// The suggestion should replace the empty line (with cursor marker) with the new code
			const file = result.suggestions.getFile(mockDocumentWithCursor.uri.toString())
			expect(file).toBeDefined()

			// Check that operations don't add unnecessary blank lines
			const operations = file!.getAllOperations()
			const additionLines = operations
				.filter((op: GhostSuggestionEditOperation) => op.type === "+")
				.map((op: GhostSuggestionEditOperation) => op.content)

			// The first line should be the comment, not an empty line
			expect(additionLines[0]).toBe("// implement function to calculate factorial")
		})

		it("should not create extra newline when cursor marker is at start of empty line", () => {
			// Mock document with cursor marker at the very start of an empty line
			const mockDocumentWithCursor: any = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `function implementYetAnotherFeature() {
		  // Implementation of yet another described functionality
		  console.log("Yet another feature implemented");
}
<<<AUTOCOMPLETE_HERE>>>`,
				languageId: "typescript",
			}

			const contextWithCursor = {
				document: mockDocumentWithCursor,
			}

			parser.initialize(contextWithCursor)

			// Response that should replace the marker and empty line
			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[function implementYetAnotherFeature() {
		  // Implementation of yet another described functionality
		  console.log("Yet another feature implemented");
}]]></replace></change>`

			const result = parser.parseResponse(changeWithCursor)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)

			// Verify no extra blank line is created
			const file = result.suggestions.getFile(mockDocumentWithCursor.uri.toString())
			expect(file).toBeDefined()

			const operations = file!.getAllOperations()
			// There should be a deletion (the newline) and additions (the new function)
			const deletions = operations.filter((op: GhostSuggestionEditOperation) => op.type === "-")
			const additions = operations.filter((op: GhostSuggestionEditOperation) => op.type === "+")

			// Should have a deletion for the newline
			expect(deletions.length).toBeGreaterThan(0)
			// Should have additions for the new function
			expect(additions.length).toBeGreaterThan(0)
		})

		it("should handle malformed XML gracefully", () => {
			const malformedXml = `<change><search><![CDATA[test]]><replace><![CDATA[replacement]]></replace></change>`

			const result = parser.parseResponse(malformedXml)

			// Should not crash and should not produce suggestions
			expect(result.hasNewSuggestions).toBe(false)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle empty response", () => {
			const result = parser.parseResponse("")

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true) // Empty is considered complete
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle whitespace-only response", () => {
			const result = parser.parseResponse("   \n\t  ")

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should not create extra newline when there's an empty line before the cursor marker", () => {
			// Mock document with an empty line before the cursor marker
			const mockDocumentWithCursor: any = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `// impl
function implementation() {
		  // This is the implementation of the functionality described in the comment
		  console.log('Functionality implemented');
}

<<<AUTOCOMPLETE_HERE>>>`,
				languageId: "typescript",
			}

			const contextWithCursor = {
				document: mockDocumentWithCursor,
			}

			parser.initialize(contextWithCursor)

			// Response that should replace the marker and consume the empty line before it
			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[// Add new functionality here
function newFunctionality() {
		  // Implementation of new functionality
		  console.log('New functionality added');
}]]></replace></change>`

			const result = parser.parseResponse(changeWithCursor)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)

			// Verify the empty line before the marker is consumed
			const file = result.suggestions.getFile(mockDocumentWithCursor.uri.toString())
			expect(file).toBeDefined()

			const operations = file!.getAllOperations()
			const deletions = operations.filter((op: GhostSuggestionEditOperation) => op.type === "-")
			const additions = operations.filter((op: GhostSuggestionEditOperation) => op.type === "+")

			// Should have a deletion for the empty line
			expect(deletions.length).toBeGreaterThan(0)
			// Should have additions for the new function
			expect(additions.length).toBeGreaterThan(0)

			// First addition should be the comment
			const additionLines = additions.map((op: GhostSuggestionEditOperation) => op.content)
			expect(additionLines[0]).toBe("// Add new functionality here")
		})
		// TODO: this should be turned back on when we have the latest parser
		it.skip("should add newline when cursor marker is at end of line with content", () => {
			// Mock document with cursor marker at the end of a comment line
			const mockDocumentWithCursor: any = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `// impl
function implementFeature() {
			 // Implementation code here
}

// implement another feature

function implementAnotherFeature() {
			 // Implementation code for another feature
}

// implement function to add two numbers<<<AUTOCOMPLETE_HERE>>>`,
				languageId: "typescript",
			}

			const contextWithCursor = {
				document: mockDocumentWithCursor,
			}

			parser.initialize(contextWithCursor)

			// Response that should add a newline before the function
			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[function addNumbers(a: number, b: number): number {
			 return a + b;
}]]></replace></change>`

			const result = parser.parseResponse(changeWithCursor)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)

			// Verify the function is on a new line, not concatenated with the comment
			const file = result.suggestions.getFile(mockDocumentWithCursor.uri.toString())
			expect(file).toBeDefined()

			const operations = file!.getAllOperations()
			const additions = operations.filter((op: GhostSuggestionEditOperation) => op.type === "+")

			// Should have additions for the new function
			expect(additions.length).toBeGreaterThan(0)

			// Check that we have both the comment line and the function (as separate additions)
			const commentAddition = additions.find((op: GhostSuggestionEditOperation) =>
				op.content.includes("// implement function to add two numbers"),
			)
			const functionAddition = additions.find((op: GhostSuggestionEditOperation) =>
				op.content.includes("function addNumbers"),
			)

			// Both should exist as separate operations
			expect(commentAddition).toBeDefined()
			expect(functionAddition).toBeDefined()

			// The function should be on a later line than the comment
			expect(functionAddition!.line).toBeGreaterThan(commentAddition!.line)
		})

		it("should not add extra newline when LLM response starts with newline for cursor marker on its own line", () => {
			// This test reproduces the exact issue from the logs where the LLM returns
			// a replacement that starts with a newline when the cursor marker is on its own line
			const mockDocumentWithCursor: any = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `// implement function add two
function addTwo(a: number, b: number): number {
			 return a + b;
}


// implement function subtract two
function subtractTwo(a: number, b: number): number {
			 return a - b;
}
// implement function multiply two
<<<AUTOCOMPLETE_HERE>>>`,
				languageId: "typescript",
			}

			const contextWithCursor = {
				document: mockDocumentWithCursor,
			}

			parser.initialize(contextWithCursor)

			// The LLM response starts with a newline after CDATA (this is the bug scenario)
			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[
function multiplyTwo(a: number, b: number): number {
			 return a * b;
}]]></replace></change>`

			const result = parser.parseResponse(changeWithCursor)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)

			// Verify NO extra blank line is created between the comment and the function
			const file = result.suggestions.getFile(mockDocumentWithCursor.uri.toString())
			expect(file).toBeDefined()

			const operations = file!.getAllOperations()
			const additions = operations.filter((op: GhostSuggestionEditOperation) => op.type === "+")

			// Should have additions for the new function
			expect(additions.length).toBeGreaterThan(0)

			// The first addition should be the function, not an empty line
			// Check that the first line of content is the function declaration
			const firstAddition = additions[0]
			expect(firstAddition.content).toMatch(/^function multiplyTwo/)
		})
	})

	describe("reset", () => {
		it("should clear all state when reset", () => {
			const change = `<change><search><![CDATA[test]]></search><replace><![CDATA[replacement]]></replace></change>`

			parser.parseResponse(change)
			expect(parser.buffer).not.toBe("")
			expect(parser.getCompletedChanges()).toHaveLength(1)

			parser.reset()
			expect(parser.buffer).toBe("")
			expect(parser.getCompletedChanges()).toHaveLength(0)
		})
	})

	describe("findBestMatch", () => {
		describe("exact matches", () => {
			it("should find exact match at start", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "function test()"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should find exact match in middle", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "return true;"

				const index = findBestMatch(content, search)
				expect(index).toBe(19)
			})

			it("should find exact match at end", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "}"

				const index = findBestMatch(content, search)
				expect(index).toBe(32)
			})

			it("should find exact multiline match", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "function test() {\n\treturn true;\n}"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})
		})

		describe("whitespace variations", () => {
			it("should handle tabs vs spaces", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "function test() {\n    return true;\n}" // Spaces instead of tab

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle extra spaces in content", () => {
				const content = "function  test()  {\n\treturn true;\n}" // Extra spaces
				const search = "function test() {\n\treturn true;\n}"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle different line endings (\\n vs \\r\\n)", () => {
				const content = "function test() {\r\n\treturn true;\r\n}"
				const search = "function test() {\n\treturn true;\n}"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle trailing whitespace differences", () => {
				const content = "function test() {  \n\treturn true;\n}"
				const search = "function test() {\n\treturn true;\n}"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle leading whitespace differences", () => {
				const content = "  function test() {\n\treturn true;\n}"
				const search = "function test() {\n\treturn true;\n}"

				const index = findBestMatch(content, search)
				expect(index).toBe(2)
			})

			it("should handle multiple consecutive spaces vs single space", () => {
				const content = "const x    =    5;"
				const search = "const x = 5;"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle trailing newline in search pattern", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "return true;\n"

				const index = findBestMatch(content, search)
				// Fuzzy matcher handles this by normalizing whitespace
				expect(index).toBe(19)
			})

			it("should handle trailing newline when content has more newlines", () => {
				const content = "function test() {\n\treturn true;\n\n\n}"
				const search = "return true;\n"

				const index = findBestMatch(content, search)
				// Fuzzy matcher handles this by normalizing whitespace
				expect(index).toBe(19)
			})
		})

		describe("newline matching", () => {
			it("should NOT match newline with space", () => {
				const content = "line1\nline2"
				const search = "line1 line2"

				const index = findBestMatch(content, search)
				expect(index).toBe(-1)
			})

			it("should NOT match newline with tab", () => {
				const content = "line1\nline2"
				const search = "line1\tline2"

				const index = findBestMatch(content, search)
				expect(index).toBe(-1)
			})

			it("should NOT match space with newline", () => {
				const content = "line1 line2"
				const search = "line1\nline2"

				const index = findBestMatch(content, search)
				expect(index).toBe(-1)
			})

			it("should match \\n with \\r\\n", () => {
				const content = "line1\r\nline2"
				const search = "line1\nline2"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should match \\r\\n with \\n", () => {
				const content = "line1\nline2"
				const search = "line1\r\nline2"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should match \\r with \\n", () => {
				const content = "line1\rline2"
				const search = "line1\nline2"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle multiple newlines correctly", () => {
				const content = "line1\n\nline2"
				const search = "line1\n\nline2"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should still handle spaces and tabs flexibly (non-newline whitespace)", () => {
				const content = "const x  =  5;"
				const search = "const x\t=\t5;"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle mixed whitespace correctly", () => {
				const content = "function test() {\n\treturn  true;\n}"
				const search = "function test() {\n    return true;\n}"

				const index = findBestMatch(content, search)
				// Should match because tabs/spaces are flexible but newlines must match
				expect(index).toBe(0)
			})
		})

		describe("edge cases", () => {
			it("should return -1 for empty content", () => {
				const content = ""
				const search = "test"

				const index = findBestMatch(content, search)
				expect(index).toBe(-1)
			})

			it("should return -1 for empty pattern", () => {
				const content = "function test() {}"
				const search = ""

				const index = findBestMatch(content, search)
				expect(index).toBe(-1)
			})

			it("should return -1 when pattern is longer than content", () => {
				const content = "short"
				const search = "this is a much longer pattern"

				const index = findBestMatch(content, search)
				expect(index).toBe(-1)
			})

			it("should return -1 for no match", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "nonexistent code"

				const index = findBestMatch(content, search)
				expect(index).toBe(-1)
			})

			it("should handle pattern with only whitespace", () => {
				const content = "a   b"
				const search = "   "

				const index = findBestMatch(content, search)
				expect(index).toBeGreaterThanOrEqual(0)
			})

			it("should handle content with only whitespace", () => {
				const content = "   \n\t  "
				const search = "test"

				const index = findBestMatch(content, search)
				expect(index).toBe(-1)
			})
		})

		describe("real-world scenarios", () => {
			it("should handle code with inconsistent indentation", () => {
				// Use explicit \t and spaces to ensure correct test case
				const content = 'function example() {\n\tif (true) {\n\t\tconsole.log("test");\n\t}\n}'
				const search = 'function example() {\n    if (true) {\n        console.log("test");\n    }\n}'

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle code with mixed tabs and spaces", () => {
				const content = "function test() {\n\t  return true;\n}"
				const search = "function test() {\n    return true;\n}"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle actual different line endings in code", () => {
				const content = "function test() {\r\n\treturn true;\r\n}"
				const search = "function test() {\n\treturn true;\n}"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should find match when content has extra trailing whitespace", () => {
				const content = "const x = 5;   \nconst y = 10;"
				const search = "const x = 5;\nconst y = 10;"

				const index = findBestMatch(content, search)
				expect(index).toBe(0)
			})

			it("should handle partial matches correctly", () => {
				const content = "function test() { return true; }\nfunction test2() { return false; }"
				const search = "function test2() { return false; }"

				const index = findBestMatch(content, search)
				expect(index).toBe(33)
			})
		})

		describe("performance", () => {
			it("should handle large content efficiently", () => {
				const content = "x".repeat(10000) + "needle" + "y".repeat(10000)
				const search = "needle"

				const startTime = performance.now()
				const index = findBestMatch(content, search)
				const endTime = performance.now()

				expect(index).toBe(10000)
				expect(endTime - startTime).toBeLessThan(50) // Should complete quickly
			})

			it("should handle large pattern efficiently", () => {
				const pattern = "x".repeat(1000)
				const content = "y".repeat(5000) + pattern + "z".repeat(5000)

				const startTime = performance.now()
				const index = findBestMatch(content, pattern)
				const endTime = performance.now()

				expect(index).toBe(5000)
				expect(endTime - startTime).toBeLessThan(100)
			})

			it("should handle worst-case scenario (no match with similar patterns)", () => {
				const content = "a".repeat(1000) + "b"
				const search = "a".repeat(1000) + "c"

				const startTime = performance.now()
				const index = findBestMatch(content, search)
				const endTime = performance.now()

				expect(index).toBe(-1)
				expect(endTime - startTime).toBeLessThan(200)
			})
		})

		describe("trimmed search fallback", () => {
			it("should NOT find match with leading whitespace in pattern (fuzzy matcher limitation)", () => {
				const content = "function test() {}"
				const search = "  function test() {}"

				const index = findBestMatch(content, search)
				// Fuzzy matcher doesn't handle leading whitespace in pattern that doesn't exist in content
				expect(index).toBe(-1)
			})

			it("should find match with trailing whitespace in pattern", () => {
				const content = "function test() {}"
				const search = "function test() {}  "

				const index = findBestMatch(content, search)
				// Fuzzy matcher now allows trailing whitespace in pattern
				expect(index).toBe(0)
			})

			it("should NOT find match with both leading and trailing whitespace in pattern (fuzzy matcher limitation)", () => {
				const content = "function test() {}"
				const search = "  function test() {}  "

				const index = findBestMatch(content, search)
				// Fuzzy matcher doesn't handle leading/trailing whitespace in pattern that doesn't exist in content
				expect(index).toBe(-1)
			})
		})
	})

	describe("error handling", () => {
		it("should handle context without document", () => {
			const contextWithoutDoc = {} as GhostSuggestionContext
			parser.initialize(contextWithoutDoc)

			const change = `<change><search><![CDATA[test]]></search><replace><![CDATA[replacement]]></replace></change>`
			const result = parser.parseResponse(change)

			expect(result.suggestions.hasSuggestions()).toBe(false)
		})
	})

	describe("performance", () => {
		it("should handle large responses efficiently", () => {
			const largeChange = `<change><search><![CDATA[${"x".repeat(10000)}]]></search><replace><![CDATA[${"y".repeat(10000)}]]></replace></change>`

			const startTime = performance.now()
			const result = parser.parseResponse(largeChange)
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(100) // Should complete in under 100ms
			expect(result.hasNewSuggestions).toBe(true)
		})

		it("should handle large concatenated responses efficiently", () => {
			const largeResponse = Array(1000).fill("x").join("")
			const startTime = performance.now()

			parser.parseResponse(largeResponse)
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(200) // Should complete in under 200ms
		})
	})
})

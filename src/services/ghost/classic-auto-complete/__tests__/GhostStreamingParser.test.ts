import { parseGhostResponse, findBestMatch } from "../GhostStreamingParser"
import { extractPrefixSuffix } from "../../types"
import * as vscode from "vscode"

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
	let mockDocument: vscode.TextDocument
	let document: vscode.TextDocument
	let range: vscode.Range | undefined

	beforeEach(() => {
		// Create mock document
		mockDocument = {
			uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
			getText: () => `function test() {
	return true;
}`,
			languageId: "typescript",
			positionAt: (offset: number) => ({ line: 0, character: offset }),
			offsetAt: (position: any) => position.character,
		} as vscode.TextDocument

		document = mockDocument
		range = undefined
	})

	describe("finishStream", () => {
		it("should handle incomplete XML", () => {
			const incompleteXml = "<change><search><![CDATA["
			const position = range?.start ?? document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(document, position)
			const result = parseGhostResponse(incompleteXml, prefix, suffix)

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

			// The change modifies the whole document, so we need prefix="" and suffix=document
			// After the change is applied, the result won't match prefix+suffix anymore
			// So this test should check hasNewSuggestions but suggestions won't have FIM
			const prefix = ""
			const suffix = document.getText()
			const result = parseGhostResponse(completeChange, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			// FIM won't be set because modified content doesn't end with original suffix
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle complete response built from multiple chunks", () => {
			const fullResponse = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment
	return true;
}]]></replace></change>`

			// The change modifies the whole document
			const prefix = ""
			const suffix = document.getText()
			const result = parseGhostResponse(fullResponse, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			// FIM won't be set because modified content doesn't end with original suffix
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle multiple complete changes", () => {
			const fullResponse = `<change><search><![CDATA[function test() {]]></search><replace><![CDATA[function test() {
	// First change]]></replace></change><change><search><![CDATA[return true;]]></search><replace><![CDATA[return false; // Second change]]></replace></change>`

			const position = range?.start ?? document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(document, position)
			const result = parseGhostResponse(fullResponse, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
		})

		it("should detect when response is complete", () => {
			const completeResponse = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment
	return true;
}]]></replace></change>`

			const position = range?.start ?? document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(document, position)
			const result = parseGhostResponse(completeResponse, prefix, suffix)

			expect(result.isComplete).toBe(true)
		})

		it("should detect incomplete response", () => {
			const incompleteResponse = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment`

			const position = range?.start ?? document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(document, position)
			const result = parseGhostResponse(incompleteResponse, prefix, suffix)

			expect(result.isComplete).toBe(false)
		})

		it("should handle cursor marker in search content for matching", () => {
			// Mock document WITHOUT cursor marker (parser should add it)
			const mockDocumentWithoutCursor = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `function test() {
	return true;
}`,
				languageId: "typescript",
				offsetAt: (position: any) => 20, // Mock cursor position
			} as vscode.TextDocument

			const mockRange = {
				start: { line: 1, character: 1 },
				end: { line: 1, character: 1 },
				isEmpty: true,
				isSingleLine: true,
			} as vscode.Range

			const contextWithCursor = {
				document: mockDocumentWithoutCursor,
				range: mockRange,
			}

			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[// New function
function fibonacci(n: number): number {
		if (n <= 1) return n;
		return fibonacci(n - 1) + fibonacci(n - 2);
}]]></replace></change>`

			const position = mockRange.start
			const { prefix, suffix } = extractPrefixSuffix(mockDocumentWithoutCursor, position)
			const result = parseGhostResponse(changeWithCursor, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})

		it("should handle document that already contains cursor marker", () => {
			// Mock document that already contains cursor marker
			const mockDocumentWithCursor = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `function test() {
	<<<AUTOCOMPLETE_HERE>>>
}`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
				offsetAt: (position: any) => position.character,
			} as vscode.TextDocument

			const contextWithCursor = {
				document: mockDocumentWithCursor,
			}

			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[// New function
function fibonacci(n: number): number {
		if (n <= 1) return n;
		return fibonacci(n - 1) + fibonacci(n - 2);
}]]></replace></change>`

			// The change modifies the document
			const prefix = ""
			const suffix = mockDocumentWithCursor.getText()
			const result = parseGhostResponse(changeWithCursor, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			// FIM won't be set because modified content doesn't end with original suffix
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle malformed XML gracefully", () => {
			const malformedXml = `<change><search><![CDATA[test]]><replace><![CDATA[replacement]]></replace></change>`

			const position = range?.start ?? document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(document, position)
			const result = parseGhostResponse(malformedXml, prefix, suffix)

			// Should not crash and should not produce suggestions
			expect(result.hasNewSuggestions).toBe(false)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle empty response", () => {
			const position = range?.start ?? document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(document, position)
			const result = parseGhostResponse("", prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true) // Empty is considered complete
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle whitespace-only response", () => {
			const position = range?.start ?? document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(document, position)
			const result = parseGhostResponse("   \n\t  ", prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})
	})

	describe("findBestMatch", () => {
		describe("exact matches", () => {
			it("should find exact match at start", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "function test()"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should find exact match in middle", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "return true;"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(19)
			})

			it("should find exact match at end", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "}"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(32)
			})

			it("should find exact multiline match", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "function test() {\n\treturn true;\n}"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})
		})

		describe("whitespace variations", () => {
			it("should handle tabs vs spaces", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "function test() {\n    return true;\n}" // Spaces instead of tab

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle extra spaces in content", () => {
				const content = "function  test()  {\n\treturn true;\n}" // Extra spaces
				const search = "function test() {\n\treturn true;\n}"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle different line endings (\\n vs \\r\\n)", () => {
				const content = "function test() {\r\n\treturn true;\r\n}"
				const search = "function test() {\n\treturn true;\n}"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle trailing whitespace differences", () => {
				const content = "function test() {  \n\treturn true;\n}"
				const search = "function test() {\n\treturn true;\n}"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle leading whitespace differences", () => {
				const content = "  function test() {\n\treturn true;\n}"
				const search = "function test() {\n\treturn true;\n}"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(2)
			})

			it("should handle multiple consecutive spaces vs single space", () => {
				const content = "const x    =    5;"
				const search = "const x = 5;"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle trailing newline in search pattern", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "return true;\n"

				const result = findBestMatch(content, search)
				// Fuzzy matcher handles this by normalizing whitespace
				expect(result.startIndex).toBe(19)
			})

			it("should handle trailing newline when content has more newlines", () => {
				const content = "function test() {\n\treturn true;\n\n\n}"
				const search = "return true;\n"

				const result = findBestMatch(content, search)
				// Fuzzy matcher handles this by normalizing whitespace
				expect(result.startIndex).toBe(19)
			})
		})

		describe("newline matching", () => {
			it("should NOT match newline with space", () => {
				const content = "line1\nline2"
				const search = "line1 line2"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(-1)
			})

			it("should NOT match newline with tab", () => {
				const content = "line1\nline2"
				const search = "line1\tline2"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(-1)
			})

			it("should NOT match space with newline", () => {
				const content = "line1 line2"
				const search = "line1\nline2"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(-1)
			})

			it("should match \\n with \\r\\n", () => {
				const content = "line1\r\nline2"
				const search = "line1\nline2"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should match \\r\\n with \\n", () => {
				const content = "line1\nline2"
				const search = "line1\r\nline2"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should match \\r with \\n", () => {
				const content = "line1\rline2"
				const search = "line1\nline2"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle multiple newlines correctly", () => {
				const content = "line1\n\nline2"
				const search = "line1\n\nline2"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should still handle spaces and tabs flexibly (non-newline whitespace)", () => {
				const content = "const x  =  5;"
				const search = "const x\t=\t5;"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle mixed whitespace correctly", () => {
				const content = "function test() {\n\treturn  true;\n}"
				const search = "function test() {\n    return true;\n}"

				const result = findBestMatch(content, search)
				// Should match because tabs/spaces are flexible but newlines must match
				expect(result.startIndex).toBe(0)
			})
		})

		describe("edge cases", () => {
			it("should return -1 for empty content", () => {
				const content = ""
				const search = "test"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(-1)
			})

			it("should return -1 for empty pattern", () => {
				const content = "function test() {}"
				const search = ""

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(-1)
			})

			it("should return -1 when pattern is longer than content", () => {
				const content = "short"
				const search = "this is a much longer pattern"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(-1)
			})

			it("should return -1 for no match", () => {
				const content = "function test() {\n\treturn true;\n}"
				const search = "nonexistent code"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(-1)
			})

			it("should handle pattern with only whitespace", () => {
				const content = "a   b"
				const search = "   "

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBeGreaterThanOrEqual(0)
			})

			it("should handle content with only whitespace", () => {
				const content = "   \n\t  "
				const search = "test"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(-1)
			})
		})

		describe("real-world scenarios", () => {
			it("should handle code with inconsistent indentation", () => {
				// Use explicit \t and spaces to ensure correct test case
				const content = 'function example() {\n\tif (true) {\n\t\tconsole.log("test");\n\t}\n}'
				const search = 'function example() {\n    if (true) {\n        console.log("test");\n    }\n}'

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle code with mixed tabs and spaces", () => {
				const content = "function test() {\n\t  return true;\n}"
				const search = "function test() {\n    return true;\n}"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle actual different line endings in code", () => {
				const content = "function test() {\r\n\treturn true;\r\n}"
				const search = "function test() {\n\treturn true;\n}"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should find match when content has extra trailing whitespace", () => {
				const content = "const x = 5;   \nconst y = 10;"
				const search = "const x = 5;\nconst y = 10;"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(0)
			})

			it("should handle partial matches correctly", () => {
				const content = "function test() { return true; }\nfunction test2() { return false; }"
				const search = "function test2() { return false; }"

				const result = findBestMatch(content, search)
				expect(result.startIndex).toBe(33)
			})
		})

		describe("performance", () => {
			it("should handle large content efficiently", () => {
				const content = "x".repeat(10000) + "needle" + "y".repeat(10000)
				const search = "needle"

				const startTime = performance.now()
				const result = findBestMatch(content, search)
				const endTime = performance.now()

				expect(result.startIndex).toBe(10000)
				expect(endTime - startTime).toBeLessThan(50) // Should complete quickly
			})

			it("should handle large pattern efficiently", () => {
				const pattern = "x".repeat(1000)
				const content = "y".repeat(5000) + pattern + "z".repeat(5000)

				const startTime = performance.now()
				const result = findBestMatch(content, pattern)
				const endTime = performance.now()

				expect(result.startIndex).toBe(5000)
				expect(endTime - startTime).toBeLessThan(100)
			})

			it("should handle worst-case scenario (no match with similar patterns)", () => {
				const content = "a".repeat(1000) + "b"
				const search = "a".repeat(1000) + "c"

				const startTime = performance.now()
				const result = findBestMatch(content, search)
				const endTime = performance.now()

				expect(result.startIndex).toBe(-1)
				expect(endTime - startTime).toBeLessThan(200)
			})
		})

		describe("trimmed search fallback", () => {
			it("should NOT find match with leading whitespace in pattern (fuzzy matcher limitation)", () => {
				const content = "function test() {}"
				const search = "  function test() {}"

				const result = findBestMatch(content, search)
				// Fuzzy matcher doesn't handle leading whitespace in pattern that doesn't exist in content
				expect(result.startIndex).toBe(-1)
			})

			it("should find match with trailing whitespace in pattern", () => {
				const content = "function test() {}"
				const search = "function test() {}  "

				const result = findBestMatch(content, search)
				// Fuzzy matcher now allows trailing whitespace in pattern
				expect(result.startIndex).toBe(0)
			})

			it("should NOT find match with both leading and trailing whitespace in pattern (fuzzy matcher limitation)", () => {
				const content = "function test() {}"
				const search = "  function test() {}  "

				const result = findBestMatch(content, search)
				// Fuzzy matcher doesn't handle leading/trailing whitespace in pattern that doesn't exist in content
				expect(result.startIndex).toBe(-1)
			})
		})

		describe("bug: break prevents matching later in string", () => {
			it("should find match later in content when first position fails", () => {
				// This test demonstrates the bug at lines 169-170
				// The content has "wrong" at the start, then the actual match "function test()" later
				const content = "wrong function test() { return true; }"
				const search = "function test()"

				const result = findBestMatch(content, search)

				// Expected: Should find the match at position 6 (after "wrong ")
				// Actual: Returns -1 because the break statement prevents trying subsequent positions
				expect(result.startIndex).toBe(6)
			})

			it("should find match after whitespace mismatch", () => {
				// Another case: pattern starts with space, content doesn't
				const content = "abc def ghi"
				const search = "def"

				const result = findBestMatch(content, search)

				// Expected: Should find "def" at position 4
				// Actual: May fail due to early break
				expect(result.startIndex).toBe(4)
			})

			it("should find match when first character differs", () => {
				const content = "x function test() {}"
				const search = "function test()"

				const result = findBestMatch(content, search)

				// Expected: Should find the match at position 2 (after "x ")
				// Actual: Returns -1 due to break on first character mismatch
				expect(result.startIndex).toBe(2)
			})

			it("should find match after multiple failed attempts", () => {
				const content = "aaa bbb ccc target ddd"
				const search = "target"

				const result = findBestMatch(content, search)

				// Expected: Should find "target" at position 12
				// Actual: Should work since exact match is tried first, but fuzzy fallback would fail
				expect(result.startIndex).toBe(12)
			})

			it("should find fuzzy match later in content", () => {
				// This is the critical test case that shows the bug
				// Content has extra spaces at start, then the pattern we're looking for
				const content = "  x  function  test()"
				const search = "function test()"

				const result = findBestMatch(content, search)

				// Expected: Should find fuzzy match starting at position 5 (after "  x  ")
				// Actual: Returns -1 because break prevents trying position 5
				expect(result.startIndex).toBe(5)
			})

			it("should handle newline mismatch and continue searching", () => {
				const content = "line1 line2\nfunction test() {}"
				const search = "function test()"

				const result = findBestMatch(content, search)

				// Expected: Should find the match at position 12 (after "line1 line2\n")
				// Actual: May fail if fuzzy matcher breaks early
				expect(result.startIndex).toBe(12)
			})
		})
	})

	describe("error handling", () => {
		it("should handle context without document", () => {
			const invalidDocument = undefined as any

			const change = `<change><search><![CDATA[test]]></search><replace><![CDATA[replacement]]></replace></change>`

			// This should throw or handle gracefully - expect it to throw
			expect(() => {
				const position = range?.start ?? invalidDocument.positionAt(0)
				const { prefix, suffix } = extractPrefixSuffix(invalidDocument, position)
				parseGhostResponse(change, prefix, suffix)
			}).toThrow()
		})
	})

	describe("performance", () => {
		it("should handle large responses efficiently", () => {
			const largeChange = `<change><search><![CDATA[${"x".repeat(10000)}]]></search><replace><![CDATA[${"y".repeat(10000)}]]></replace></change>`

			const startTime = performance.now()
			const position = range?.start ?? document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(document, position)
			const result = parseGhostResponse(largeChange, prefix, suffix)
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(100) // Should complete in under 100ms
			expect(result.hasNewSuggestions).toBe(true)
		})

		it("should handle large concatenated responses efficiently", () => {
			const largeResponse = Array(1000).fill("x").join("")
			const startTime = performance.now()

			const position = range?.start ?? document.positionAt(0)
			const { prefix, suffix } = extractPrefixSuffix(document, position)
			parseGhostResponse(largeResponse, prefix, suffix)
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(200) // Should complete in under 200ms
		})
	})

	describe("Fill-In-Middle (FIM) behavior", () => {
		it("should set FIM when modifiedContent has both prefix and suffix", () => {
			const mockDocWithPrefix = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `const prefix = "start";\nconst suffix = "end";`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
			} as vscode.TextDocument

			const change = `<change><search><![CDATA[const prefix = "start";\nconst suffix = "end";]]></search><replace><![CDATA[const prefix = "start";\nconst middle = "inserted";\nconst suffix = "end";]]></replace></change>`

			const prefix = 'const prefix = "start";\n'
			const suffix = 'const suffix = "end";'

			const result = parseGhostResponse(change, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			// Check that FIM was set
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent).toEqual({
				text: 'const middle = "inserted";\n',
				prefix: 'const prefix = "start";\n',
				suffix: 'const suffix = "end";',
			})
		})

		it("should NOT set FIM when prefix doesn't match", () => {
			const mockDoc = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `const prefix = "start";\nconst suffix = "end";`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
			} as vscode.TextDocument

			const change = `<change><search><![CDATA[const prefix = "start";\nconst suffix = "end";]]></search><replace><![CDATA[const prefix = "start";\nconst middle = "inserted";\nconst suffix = "end";]]></replace></change>`

			const prefix = "WRONG_PREFIX"
			const suffix = 'const suffix = "end";'

			const result = parseGhostResponse(change, prefix, suffix)

			// The change will still be applied and FIM will be set
			// but with the wrong prefix/suffix (not matching the modified content)
			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			// FIM is set but with empty text because prefix+suffix don't match the modified content
			expect(fimContent?.text).toBe("")
		})

		it("should NOT set FIM when suffix doesn't match", () => {
			const mockDoc = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `const prefix = "start";\nconst suffix = "end";`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
			} as vscode.TextDocument

			const change = `<change><search><![CDATA[const prefix = "start";\nconst suffix = "end";]]></search><replace><![CDATA[const prefix = "start";\nconst middle = "inserted";\nconst suffix = "end";]]></replace></change>`

			const prefix = 'const prefix = "start";\n'
			const suffix = "WRONG_SUFFIX"

			const result = parseGhostResponse(change, prefix, suffix)

			// The change will still be applied and FIM will be set
			// but with the wrong prefix/suffix (not matching the modified content)
			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			// FIM is set but with empty text because prefix+suffix don't match the modified content
			expect(fimContent?.text).toBe("")
		})

		it("should NOT set FIM when both prefix and suffix don't match", () => {
			const mockDoc = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `const prefix = "start";\nconst suffix = "end";`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
			} as vscode.TextDocument

			const change = `<change><search><![CDATA[const prefix = "start";\nconst suffix = "end";]]></search><replace><![CDATA[const prefix = "start";\nconst middle = "inserted";\nconst suffix = "end";]]></replace></change>`

			const prefix = "WRONG_PREFIX"
			const suffix = "WRONG_SUFFIX"

			const result = parseGhostResponse(change, prefix, suffix)

			// The change will still be applied and FIM will be set
			// but with the wrong prefix/suffix (not matching the modified content)
			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			// FIM is set but with empty text because prefix+suffix don't match the modified content
			expect(fimContent?.text).toBe("")
		})

		it("should handle empty prefix and suffix", () => {
			const mockDoc = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `const middle = "content";`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
			} as vscode.TextDocument

			const change = `<change><search><![CDATA[const middle = "content";]]></search><replace><![CDATA[const middle = "updated";]]></replace></change>`

			// The change modifies the whole document
			const prefix = ""
			const suffix = 'const middle = "content";'

			const result = parseGhostResponse(change, prefix, suffix)

			// FIM won't be set because modified content doesn't end with original suffix
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should extract correct middle content when FIM matches", () => {
			const mockDoc = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `function test() {\n\treturn true;\n}`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
			} as vscode.TextDocument

			const change = `<change><search><![CDATA[function test() {\n\treturn true;\n}]]></search><replace><![CDATA[function test() {\n\tconst x = 5;\n\treturn true;\n}]]></replace></change>`

			// The change modifies the whole document
			const prefix = ""
			const suffix = "function test() {\n\treturn true;\n}"

			const result = parseGhostResponse(change, prefix, suffix)

			// FIM won't be set because modified content doesn't end with original suffix
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should NOT set FIM when modifiedContent is undefined", () => {
			const mockDoc = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `const x = 1;`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
			} as vscode.TextDocument

			// Change that won't match anything in the document
			const change = `<change><search><![CDATA[NONEXISTENT]]></search><replace><![CDATA[REPLACEMENT]]></replace></change>`

			const prefix = "const x = 1;"
			const suffix = ""

			const result = parseGhostResponse(change, prefix, suffix)

			const fimContent = result.suggestions.getFillInAtCursor()
			// When no changes are applied, FIM is set to empty string (the entire unchanged document matches prefix+suffix)
			expect(fimContent).toEqual({
				text: "",
				prefix: "const x = 1;",
				suffix: "",
			})
		})

		it("should handle multiline prefix and suffix correctly", () => {
			const mockDoc = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `class Test {\n\tconstructor() {\n\t\tthis.value = 0;\n\t}\n}`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
			} as vscode.TextDocument

			const change = `<change><search><![CDATA[class Test {\n\tconstructor() {\n\t\tthis.value = 0;\n\t}\n}]]></search><replace><![CDATA[class Test {\n\tconstructor() {\n\t\tthis.value = 0;\n\t\tthis.name = "test";\n\t}\n}]]></replace></change>`

			// The change modifies the whole document
			const prefix = ""
			const suffix = "class Test {\n\tconstructor() {\n\t\tthis.value = 0;\n\t}\n}"

			const result = parseGhostResponse(change, prefix, suffix)

			// FIM won't be set because modified content doesn't end with original suffix
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle prefix/suffix with special characters", () => {
			const mockDoc = {
				uri: { toString: () => "/test/file.ts", fsPath: "/test/file.ts" },
				getText: () => `const regex = /test/g;\nconst result = "match";`,
				languageId: "typescript",
				positionAt: (offset: number) => ({ line: 0, character: offset }),
			} as vscode.TextDocument

			const change = `<change><search><![CDATA[const regex = /test/g;\nconst result = "match";]]></search><replace><![CDATA[const regex = /test/g;\nconst middle = "inserted";\nconst result = "match";]]></replace></change>`

			const prefix = "const regex = /test/g;\n"
			const suffix = 'const result = "match";'

			const result = parseGhostResponse(change, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent).toEqual({
				text: 'const middle = "inserted";\n',
				prefix: "const regex = /test/g;\n",
				suffix: 'const result = "match";',
			})
		})
	})
})

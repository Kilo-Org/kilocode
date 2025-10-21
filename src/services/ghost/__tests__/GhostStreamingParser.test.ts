import { GhostStreamingParser, findBestMatch } from "../GhostStreamingParser"
import { GhostSuggestionContext } from "../types"

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
		it("should find exact matches", () => {
			const content = "function test() {\n\treturn true;\n}"
			const search = "return true;"

			const index = findBestMatch(content, search)
			expect(index).toBeGreaterThan(-1)
		})

		it("should handle whitespace differences", () => {
			const content = "function test() {\n\treturn true;\n}"
			const search = "function test() {\n    return true;\n}" // Different indentation

			const index = findBestMatch(content, search)
			expect(index).toBeGreaterThan(-1)
		})

		it("should return -1 for no match", () => {
			const content = "function test() {\n\treturn true;\n}"
			const search = "nonexistent code"

			const index = findBestMatch(content, search)
			expect(index).toBe(-1)
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

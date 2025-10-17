import { GhostStreamingParser, findBestMatch } from "../GhostStreamingParser"
import { AutocompleteInput } from "../types"

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
	let input: AutocompleteInput
	const prefix = `function test() {
	return true;
}`
	const suffix = ""

	beforeEach(() => {
		parser = new GhostStreamingParser()

		input = {
			isUntitledFile: false,
			completionId: "test-id",
			filepath: "/test/file.ts",
			pos: { line: 2, character: 1 },
			recentlyVisitedRanges: [],
			recentlyEditedRanges: [],
		}

		parser.initialize(input, prefix, suffix)
	})

	afterEach(() => {
		parser.reset()
	})

	describe("processChunk", () => {
		it("should handle incomplete XML chunks", () => {
			const chunk1 = "<change><search><![CDATA["
			const result1 = parser.processChunk(chunk1)

			expect(result1.hasNewContent).toBe(false)
			expect(result1.isComplete).toBe(false)
			expect(result1.outcome !== undefined).toBe(false)
		})

		it("should parse complete change blocks", () => {
			const completeChange = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment
	return true;
}]]></replace></change>`

			const result = parser.processChunk(completeChange)

			expect(result.hasNewContent).toBe(true)
			expect(result.outcome !== undefined).toBe(true)
		})

		it("should handle multiple chunks building up to complete change", () => {
			const chunks = [
				"<change><search><![CDATA[function test() {",
				"\n\treturn true;",
				"\n}]]></search><replace><![CDATA[function test() {",
				"\n\t// Added comment",
				"\n\treturn true;",
				"\n}]]></replace></change>",
			]

			let finalResult
			for (const chunk of chunks) {
				finalResult = parser.processChunk(chunk)
			}

			expect(finalResult!.hasNewContent).toBe(true)
			expect(finalResult!.outcome).toBeDefined()
		})

		it("should handle multiple complete changes in sequence", () => {
			const change1 = `<change><search><![CDATA[function test() {]]></search><replace><![CDATA[function test() {
	// First change]]></replace></change>`

			const change2 = `<change><search><![CDATA[return true;]]></search><replace><![CDATA[return false; // Second change]]></replace></change>`

			const result1 = parser.processChunk(change1)
			const result2 = parser.processChunk(change2)

			expect(result1.hasNewContent).toBe(true)
			expect(result2.hasNewContent).toBe(true)
			expect(parser.getCompletedChanges()).toHaveLength(2)
		})

		it("should detect when response is complete", () => {
			const completeResponse = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment
	return true;
}]]></replace></change>`

			const result = parser.processChunk(completeResponse)

			expect(result.isComplete).toBe(true)
		})

		it("should detect incomplete response", () => {
			const incompleteResponse = `<change><search><![CDATA[function test() {
	return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment`

			const result = parser.processChunk(incompleteResponse)

			expect(result.isComplete).toBe(false)
		})

		it("should handle cursor marker correctly", () => {
			const changeWithCursor = `<change><search><![CDATA[function test() {
	<<<AUTOCOMPLETE_HERE>>>return true;
}]]></search><replace><![CDATA[function test() {
	// Added comment<<<AUTOCOMPLETE_HERE>>>
	return true;
}]]></replace></change>`

			const result = parser.processChunk(changeWithCursor)

			expect(result.hasNewContent).toBe(true)
			// Verify cursor marker is preserved in search content for matching
			const changes = parser.getCompletedChanges()
			expect(changes[0].search).toContain("<<<AUTOCOMPLETE_HERE>>>") // Should preserve in search for matching
			expect(changes[0].replace).toContain("<<<AUTOCOMPLETE_HERE>>>") // Should preserve in replace
			expect(changes[0].cursorPosition).toBeDefined() // Should have cursor position info
		})

		it("should extract cursor position correctly", () => {
			const changeWithCursor = `<change><search><![CDATA[return true;]]></search><replace><![CDATA[// Comment here<<<AUTOCOMPLETE_HERE>>>
	return false;]]></replace></change>`

			const result = parser.processChunk(changeWithCursor)

			expect(result.hasNewContent).toBe(true)
			const changes = parser.getCompletedChanges()
			expect(changes[0].cursorPosition).toBe(15) // Position after "// Comment here"
		})

		it("should handle cursor marker in search content for matching", () => {
			// Re-initialize parser for this test
			const testInput: AutocompleteInput = {
				isUntitledFile: false,
				completionId: "test-id-2",
				filepath: "/test/file.ts",
				pos: { line: 1, character: 1 },
				recentlyVisitedRanges: [],
				recentlyEditedRanges: [],
			}
			const testPrefix = `function test() {
	return true;
}`
			const testSuffix = ""

			parser.initialize(testInput, testPrefix, testSuffix)

			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[// New function
function fibonacci(n: number): number {
		if (n <= 1) return n;
		return fibonacci(n - 1) + fibonacci(n - 2);
}]]></replace></change>`

			const result = parser.processChunk(changeWithCursor)

			expect(result.hasNewContent).toBe(true)
			expect(result.outcome !== undefined).toBe(true)
		})

		it("should handle document that already contains cursor marker", () => {
			// Re-initialize parser for this test
			const testInput: AutocompleteInput = {
				isUntitledFile: false,
				completionId: "test-id-3",
				filepath: "/test/file.ts",
				pos: { line: 1, character: 0 },
				recentlyVisitedRanges: [],
				recentlyEditedRanges: [],
			}
			const testPrefix = `function test() {
	<<<AUTOCOMPLETE_HERE>>>
}`
			const testSuffix = ""

			parser.initialize(testInput, testPrefix, testSuffix)

			const changeWithCursor = `<change><search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search><replace><![CDATA[// New function
function fibonacci(n: number): number {
		if (n <= 1) return n;
		return fibonacci(n - 1) + fibonacci(n - 2);
}]]></replace></change>`

			const result = parser.processChunk(changeWithCursor)

			expect(result.hasNewContent).toBe(true)
			expect(result.outcome !== undefined).toBe(true)
		})

		it("should handle malformed XML gracefully", () => {
			const malformedXml = `<change><search><![CDATA[test]]><replace><![CDATA[replacement]]></replace></change>`

			const result = parser.processChunk(malformedXml)

			// Should not crash and should not produce suggestions
			expect(result.hasNewContent).toBe(false)
			expect(result.outcome !== undefined).toBe(false)
		})

		it("should handle empty chunks", () => {
			const result = parser.processChunk("")

			expect(result.hasNewContent).toBe(false)
			expect(result.isComplete).toBe(true) // Empty is considered complete
			expect(result.outcome !== undefined).toBe(false)
		})

		it("should handle whitespace-only chunks", () => {
			const result = parser.processChunk("   \n\t  ")

			expect(result.hasNewContent).toBe(false)
			expect(result.isComplete).toBe(true)
			expect(result.outcome !== undefined).toBe(false)
		})
	})

	describe("reset", () => {
		it("should clear all state when reset", () => {
			const change = `<change><search><![CDATA[test]]></search><replace><![CDATA[replacement]]></replace></change>`

			parser.processChunk(change)
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
		it("should throw error if not initialized", () => {
			const uninitializedParser = new GhostStreamingParser()

			expect(() => {
				uninitializedParser.processChunk("test")
			}).toThrow("Parser not initialized")
		})

		it("should handle empty input", () => {
			const emptyInput: AutocompleteInput = {
				isUntitledFile: false,
				completionId: "empty-id",
				filepath: "",
				pos: { line: 0, character: 0 },
				recentlyVisitedRanges: [],
				recentlyEditedRanges: [],
			}
			parser.initialize(emptyInput, "", "")

			const change = `<change><search><![CDATA[test]]></search><replace><![CDATA[replacement]]></replace></change>`
			const result = parser.processChunk(change)

			expect(result.outcome).toBeDefined()
		})
	})

	describe("performance", () => {
		it("should handle large chunks efficiently", () => {
			const largeChange = `<change><search><![CDATA[${"x".repeat(10000)}]]></search><replace><![CDATA[${"y".repeat(10000)}]]></replace></change>`

			const startTime = performance.now()
			const result = parser.processChunk(largeChange)
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(100) // Should complete in under 100ms
			expect(result.hasNewContent).toBe(true)
		})

		it("should handle many small chunks efficiently", () => {
			const chunks = Array(1000).fill("x")
			const startTime = performance.now()

			for (const chunk of chunks) {
				parser.processChunk(chunk)
			}
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(200) // Should complete in under 200ms
		})
	})
})

import { parseGhostResponse, extractHoleContent } from "../GhostStreamingParser"
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

describe("GhostStreamingParser - Hole Filling", () => {
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

	describe("extractHoleContent", () => {
		it("should extract content from complete HOLE tags", () => {
			const response = "<HOLE>console.log('hello');</HOLE>"
			const content = extractHoleContent(response)

			expect(content).toBe("console.log('hello');")
		})

		it("should extract multiline content", () => {
			const response = `<HOLE>function test() {
	return true;
}</HOLE>`
			const content = extractHoleContent(response)

			expect(content).toBe(`function test() {
	return true;
}`)
		})

		it("should return undefined for incomplete HOLE tags", () => {
			const response = "<HOLE>console.log('hello');"
			const content = extractHoleContent(response)

			expect(content).toBeUndefined()
		})

		it("should return undefined for missing opening tag", () => {
			const response = "console.log('hello');</HOLE>"
			const content = extractHoleContent(response)

			expect(content).toBeUndefined()
		})

		it("should return undefined for no HOLE tags", () => {
			const response = "console.log('hello');"
			const content = extractHoleContent(response)

			expect(content).toBeUndefined()
		})

		it("should handle empty HOLE content", () => {
			const response = "<HOLE></HOLE>"
			const content = extractHoleContent(response)

			expect(content).toBe("")
		})

		it("should handle HOLE with whitespace", () => {
			const response = "<HOLE>   \n\t  </HOLE>"
			const content = extractHoleContent(response)

			expect(content).toBe("   \n\t  ")
		})

		it("should extract only first HOLE if multiple present", () => {
			const response = "<HOLE>first</HOLE><HOLE>second</HOLE>"
			const content = extractHoleContent(response)

			expect(content).toBe("first")
		})

		it("should handle case-insensitive tags", () => {
			const response = "<hole>content</hole>"
			const content = extractHoleContent(response)

			expect(content).toBe("content")
		})

		it("should handle HOLE with special characters", () => {
			const response = "<HOLE>const regex = /test/g;</HOLE>"
			const content = extractHoleContent(response)

			expect(content).toBe("const regex = /test/g;")
		})

		it("should handle HOLE with XML-like content", () => {
			const response = "<HOLE><div>test</div></HOLE>"
			const content = extractHoleContent(response)

			expect(content).toBe("<div>test</div>")
		})
	})

	describe("parseGhostResponse", () => {
		it("should parse complete HOLE response", () => {
			const response = "<HOLE>console.log('test');</HOLE>"
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})

		it("should handle incomplete HOLE response and sanitize it", () => {
			const response = "<HOLE>console.log('test');"
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			// After sanitization, the closing tag is added, so it becomes complete
			expect(result.hasNewSuggestions).toBe(true)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})

		it("should handle empty HOLE response", () => {
			const response = "<HOLE></HOLE>"
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle empty response", () => {
			const response = ""
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle whitespace-only response", () => {
			const response = "   \n\t  "
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should set FIM when hole content is provided", () => {
			const response = "<HOLE>const x = 5;</HOLE>"
			const prefix = "function test() {\n\t"
			const suffix = "\n\treturn x;\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent).toEqual({
				text: "const x = 5;",
				prefix: "function test() {\n\t",
				suffix: "\n\treturn x;\n}",
			})
		})

		it("should handle multiline hole content", () => {
			const response = `<HOLE>const x = 5;
	const y = 10;
	return x + y;</HOLE>`
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent?.text).toBe(`const x = 5;
	const y = 10;
	return x + y;`)
		})

		it("should handle hole content with special characters", () => {
			const response = '<HOLE>const regex = /test/g;\nconst str = "hello";</HOLE>'
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent?.text).toBe('const regex = /test/g;\nconst str = "hello";')
		})

		it("should detect when response is complete", () => {
			const response = "<HOLE>console.log('test');</HOLE>"
			const prefix = ""
			const suffix = ""

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.isComplete).toBe(true)
		})

		it("should detect incomplete response and sanitize it", () => {
			const response = "<HOLE>console.log('test');"
			const prefix = ""
			const suffix = ""

			const result = parseGhostResponse(response, prefix, suffix)

			// After sanitization, becomes complete
			expect(result.isComplete).toBe(true)
		})

		it("should handle response with text before HOLE tag", () => {
			const response = "Some explanation text\n<HOLE>console.log('test');</HOLE>"
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})

		it("should handle response with text after HOLE tag", () => {
			const response = "<HOLE>console.log('test');</HOLE>\nSome explanation text"
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})
	})

	describe("sanitization", () => {
		it("should sanitize incomplete closing HOLE tag", () => {
			const response = "<HOLE>console.log('test');</HOLE"
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			// After sanitization, should be complete
			expect(result.isComplete).toBe(true)
			expect(result.hasNewSuggestions).toBe(true)
		})

		it("should sanitize missing closing HOLE tag", () => {
			const response = "<HOLE>console.log('test');"
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			// After sanitization, should be complete
			expect(result.isComplete).toBe(true)
			expect(result.hasNewSuggestions).toBe(true)
		})

		it("should not add closing tag if response ends with <", () => {
			const response = "<HOLE>console.log('test');<"
			const prefix = "function test() {\n\t"
			const suffix = "\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			// Should remain incomplete (streaming in progress)
			expect(result.isComplete).toBe(false)
		})
	})

	describe("Fill-In-Middle (FIM) behavior", () => {
		it("should set FIM when hole content is provided", () => {
			const response = '<HOLE>const middle = "inserted";</HOLE>'
			const prefix = 'const prefix = "start";\n'
			const suffix = '\nconst suffix = "end";'

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent).toEqual({
				text: 'const middle = "inserted";',
				prefix: 'const prefix = "start";\n',
				suffix: '\nconst suffix = "end";',
			})
		})

		it("should handle empty prefix", () => {
			const response = "<HOLE>const x = 5;</HOLE>"
			const prefix = ""
			const suffix = "\nconst y = 10;"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent?.text).toBe("const x = 5;")
		})

		it("should handle empty suffix", () => {
			const response = "<HOLE>const x = 5;</HOLE>"
			const prefix = "const y = 10;\n"
			const suffix = ""

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent?.text).toBe("const x = 5;")
		})

		it("should handle both empty prefix and suffix", () => {
			const response = "<HOLE>const x = 5;</HOLE>"
			const prefix = ""
			const suffix = ""

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent?.text).toBe("const x = 5;")
		})

		it("should handle multiline prefix and suffix", () => {
			const response = '<HOLE>this.name = "test";</HOLE>'
			const prefix = "class Test {\n\tconstructor() {\n\t\tthis.value = 0;\n\t\t"
			const suffix = "\n\t}\n}"

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent?.text).toBe('this.name = "test";')
		})

		it("should handle prefix/suffix with special characters", () => {
			const response = '<HOLE>const middle = "inserted";</HOLE>'
			const prefix = "const regex = /test/g;\n"
			const suffix = '\nconst result = "match";'

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.suggestions.hasSuggestions()).toBe(true)
			const fimContent = result.suggestions.getFillInAtCursor()
			expect(fimContent).toEqual({
				text: 'const middle = "inserted";',
				prefix: "const regex = /test/g;\n",
				suffix: '\nconst result = "match";',
			})
		})
	})

	describe("error handling", () => {
		it("should handle malformed XML gracefully", () => {
			const malformedXml = "<HOLE>test<HOLE>nested</HOLE>"
			const prefix = ""
			const suffix = ""

			const result = parseGhostResponse(malformedXml, prefix, suffix)

			// Should extract first valid HOLE content
			expect(result.hasNewSuggestions).toBe(true)
		})

		it("should handle response without HOLE tags", () => {
			const response = "Just some text without tags"
			const prefix = ""
			const suffix = ""

			const result = parseGhostResponse(response, prefix, suffix)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})
	})

	describe("performance", () => {
		it("should handle large hole content efficiently", () => {
			const largeContent = "x".repeat(10000)
			const response = `<HOLE>${largeContent}</HOLE>`

			const startTime = performance.now()
			const result = parseGhostResponse(response, "", "")
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(100)
			expect(result.hasNewSuggestions).toBe(true)
		})

		it("should handle large response efficiently", () => {
			const largeResponse = "x".repeat(10000) + "<HOLE>content</HOLE>"

			const startTime = performance.now()
			const result = parseGhostResponse(largeResponse, "", "")
			const endTime = performance.now()

			expect(endTime - startTime).toBeLessThan(100)
			expect(result.hasNewSuggestions).toBe(true)
		})
	})
})

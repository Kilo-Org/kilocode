import { sanitizeXMLConservative } from "../GhostStreamingParser"
import { GhostSuggestionContext } from "../../types"
import * as vscode from "vscode"

// Mock vscode workspace
vi.mock("vscode", async () => {
	const actual = await vi.importActual("vscode")
	return {
		...actual,
		workspace: {
			asRelativePath: vi.fn().mockReturnValue("test/file.ts"),
		},
		Range: vi.fn().mockImplementation((startLine, startChar, endLine, endChar) => ({
			start: { line: startLine, character: startChar },
			end: { line: endLine, character: endChar },
		})),
	}
})

describe("GhostStreamingParser - XML Sanitization (Hole Filling)", () => {
	let mockContext: GhostSuggestionContext

	beforeEach(() => {
		// Create mock document
		const mockDocument = {
			getText: vi.fn().mockReturnValue("function multiply(<HOLE></HOLE>"),
			uri: { fsPath: "/test/file.ts", toString: () => "file:///test/file.ts" } as vscode.Uri,
			offsetAt: vi.fn().mockReturnValue(17),
		} as unknown as vscode.TextDocument

		mockContext = {
			document: mockDocument,
			range: { start: { line: 0, character: 17 }, end: { line: 0, character: 17 } } as vscode.Range,
		}
	})

	describe("sanitizeXMLConservative", () => {
		it("should fix incomplete closing tag </HOLE without >", () => {
			const incompleteXML = `<HOLE>function multiply(a, b) {
	return a * b;
}</HOLE`

			const sanitized = sanitizeXMLConservative(incompleteXML)
			expect(sanitized).toContain("</HOLE>")
			expect(sanitized).toBe(incompleteXML + ">")
		})

		it("should add missing </HOLE> tag entirely", () => {
			const incompleteXML = `<HOLE>function multiply(a, b) {
	return a * b;
}`

			const sanitized = sanitizeXMLConservative(incompleteXML)
			expect(sanitized).toContain("</HOLE>")
			expect(sanitized).toBe(incompleteXML + "</HOLE>")
		})

		it("should not fix when buffer ends with incomplete tag marker", () => {
			const incompleteXML = `<HOLE>function multiply(a, b) {
	return a * b;
}<`

			const sanitized = sanitizeXMLConservative(incompleteXML)
			expect(sanitized).toBe(incompleteXML)
		})

		it("should handle already complete XML without modification", () => {
			const completeXML = `<HOLE>function multiply(a, b) {
	return a * b;
}</HOLE>`

			const sanitized = sanitizeXMLConservative(completeXML)
			expect(sanitized).toBe(completeXML)
		})

		it("should handle empty HOLE tags", () => {
			const emptyHole = "<HOLE></HOLE>"
			const sanitized = sanitizeXMLConservative(emptyHole)
			expect(sanitized).toBe(emptyHole)
		})

		it("should handle HOLE with only whitespace", () => {
			const whitespaceHole = "<HOLE>   \n\t  </HOLE>"
			const sanitized = sanitizeXMLConservative(whitespaceHole)
			expect(sanitized).toBe(whitespaceHole)
		})

		it("should fix incomplete opening tag", () => {
			const incompleteOpening = "<HOLE>content"
			const sanitized = sanitizeXMLConservative(incompleteOpening)
			expect(sanitized).toBe(incompleteOpening + "</HOLE>")
		})

		it("should not modify when no HOLE tags present", () => {
			const noHole = "just some text"
			const sanitized = sanitizeXMLConservative(noHole)
			expect(sanitized).toBe(noHole)
		})

		it("should handle case-insensitive tags", () => {
			const lowerCase = "<hole>content</hole"
			const sanitized = sanitizeXMLConservative(lowerCase)
			// Should fix the incomplete closing tag (adds uppercase HOLE)
			expect(sanitized).toContain("</HOLE>")
		})

		it("should handle multiple incomplete tags (only fixes first)", () => {
			const multipleIncomplete = "<HOLE>first</HOLE<HOLE>second"
			const sanitized = sanitizeXMLConservative(multipleIncomplete)
			// Should fix the first incomplete tag
			expect(sanitized).toContain("</HOLE>")
		})

		it("should handle HOLE with special characters", () => {
			const specialChars = "<HOLE>const regex = /test/g;</HOLE>"
			const sanitized = sanitizeXMLConservative(specialChars)
			expect(sanitized).toBe(specialChars)
		})

		it("should handle HOLE with nested XML-like content", () => {
			const nestedXML = "<HOLE><div>test</div></HOLE>"
			const sanitized = sanitizeXMLConservative(nestedXML)
			expect(sanitized).toBe(nestedXML)
		})

		it("should handle streaming scenario - incomplete tag at end", () => {
			const streaming = "<HOLE>console.log('streaming');"
			const sanitized = sanitizeXMLConservative(streaming)
			// Should add closing tag since it's not ending with <
			expect(sanitized).toBe(streaming + "</HOLE>")
		})

		it("should not add closing tag when actively streaming (ends with <)", () => {
			const activeStreaming = "<HOLE>console.log('streaming');<"
			const sanitized = sanitizeXMLConservative(activeStreaming)
			// Should NOT add closing tag - still streaming
			expect(sanitized).toBe(activeStreaming)
		})
	})
})

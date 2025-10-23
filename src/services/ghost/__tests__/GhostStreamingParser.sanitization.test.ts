import { GhostStreamingParser, sanitizeXMLConservative } from "../GhostStreamingParser"
import { GhostSuggestionContext } from "../types"
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

describe("GhostStreamingParser - XML Sanitization", () => {
	let parser: GhostStreamingParser
	let mockContext: GhostSuggestionContext

	beforeEach(() => {
		parser = new GhostStreamingParser()

		// Create mock document
		const mockDocument = {
			getText: vi.fn().mockReturnValue("function mutliply(<<<AUTOCOMPLETE_HERE>>>>"),
			uri: { fsPath: "/test/file.ts", toString: () => "file:///test/file.ts" } as vscode.Uri,
			offsetAt: vi.fn().mockReturnValue(17), // Position after "function mutliply("
		} as unknown as vscode.TextDocument

		mockContext = {
			document: mockDocument,
			range: { start: { line: 0, character: 17 }, end: { line: 0, character: 17 } } as vscode.Range,
		}

		parser.initialize(mockContext)
	})

	describe("sanitizeXMLConservative", () => {
		it("should fix incomplete closing tag </change without > when stream is complete", () => {
			const incompleteXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change`

			// Test sanitization directly
			const sanitized = sanitizeXMLConservative(incompleteXML)
			expect(sanitized).toContain("</change>")
			expect(sanitized).toBe(incompleteXML.replace("</change", "</change>"))
			// Verify the incomplete tag was fixed
			expect(incompleteXML).toMatch(/\/change$/)
			expect(sanitized).toMatch(/\/change>$/)
		})

		it("should add missing </change> tag entirely when stream is complete", () => {
			const incompleteXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace>`

			// Test sanitization directly
			const sanitized = sanitizeXMLConservative(incompleteXML)
			expect(sanitized).toContain("</change>")
			expect(sanitized).toBe(incompleteXML + "</change>")
		})

		it("should not fix when search/replace pairs are incomplete", () => {
			const incompleteXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></change`

			// Test sanitization directly - should NOT modify when replace is incomplete
			const sanitized = sanitizeXMLConservative(incompleteXML)
			expect(sanitized).toBe(incompleteXML)
		})

		it("should not fix when multiple change blocks are present", () => {
			const incompleteXML = `<change><search><![CDATA[test1]]></search><replace><![CDATA[test1]]></replace></change><change><search><![CDATA[test2]]></search><replace><![CDATA[test2]]></replace></change`

			// Test sanitization directly - should NOT modify when multiple changes present
			const sanitized = sanitizeXMLConservative(incompleteXML)
			expect(sanitized).toBe(incompleteXML)
		})

		it("should not fix when buffer ends with incomplete tag marker", () => {
			const incompleteXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace><`

			// Test sanitization directly - should NOT modify when ending with incomplete tag
			const sanitized = sanitizeXMLConservative(incompleteXML)
			expect(sanitized).toBe(incompleteXML)
		})

		it("should apply sanitization when stream is complete", () => {
			// Build up the full response from chunks
			const fullResponse = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>]]></search><replace><![CDATA[function mutliply(a, b) {]]></replace></change`

			// Test sanitization directly
			const sanitized = sanitizeXMLConservative(fullResponse)
			expect(sanitized).toContain("</change>")
			expect(sanitized).toBe(fullResponse.replace("</change", "</change>"))
		})

		it("should handle already complete XML without modification", () => {
			const completeXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change>`

			// Test sanitization directly - should NOT modify already complete XML
			const sanitized = sanitizeXMLConservative(completeXML)
			expect(sanitized).toBe(completeXML)
		})

		it("should handle malformed CDATA sections - the actual bug from user logs", () => {
			// This reproduces the EXACT malformed CDATA issue from user logs
			const malformedCDataXML = `<change><search><![CDATA[function getRedirectUrl(txn: CreditTransaction | undefined) {
		<<<AUTOCOMPLETE_HERE>>>

		const params = new URLSearchParams();</![CDATA[</search><replace><![CDATA[function getRedirectUrl(txn: CreditTransaction | undefined) {
		if (!txn) {
		  return '/organizations';
		}

		const params = new URLSearchParams();</![CDATA[</replace></change>`

			// Test sanitization directly - should fix malformed CDATA
			const sanitized = sanitizeXMLConservative(malformedCDataXML)
			expect(sanitized).not.toContain("</![CDATA[")
			expect(sanitized).toContain("]]>")
			// Verify the malformed CDATA closures are replaced
			const expectedSanitized = malformedCDataXML.replace(/<\/!\[CDATA\[/g, "]]>")
			expect(sanitized).toBe(expectedSanitized)
		})
	})
})

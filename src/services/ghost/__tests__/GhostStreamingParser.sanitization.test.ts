import { GhostStreamingParser } from "../GhostStreamingParser"
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

			// Simulate stream completion by calling finishStream with full response
			const result = parser.parseResponse(incompleteXML)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
			expect(parser.getCompletedChanges()).toHaveLength(1)

			const change = parser.getCompletedChanges()[0]
			expect(change.search).toBe("function mutliply(<<<AUTOCOMPLETE_HERE>>>>\n")
			expect(change.replace).toBe("function mutliply(a, b) {\n")
		})

		it("should add missing </change> tag entirely when stream is complete", () => {
			const incompleteXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace>`

			// Simulate stream completion
			const result = parser.parseResponse(incompleteXML)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
			expect(parser.getCompletedChanges()).toHaveLength(1)

			const change = parser.getCompletedChanges()[0]
			expect(change.search).toBe("function mutliply(<<<AUTOCOMPLETE_HERE>>>>\n")
			expect(change.replace).toBe("function mutliply(a, b) {\n")
		})

		it("should not fix when search/replace pairs are incomplete", () => {
			const incompleteXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></change`

			const result = parser.parseResponse(incompleteXML)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.suggestions.hasSuggestions()).toBe(false)
			expect(parser.getCompletedChanges()).toHaveLength(0)
		})

		it("should not fix when multiple change blocks are present", () => {
			const incompleteXML = `<change><search><![CDATA[test1]]></search><replace><![CDATA[test1]]></replace></change><change><search><![CDATA[test2]]></search><replace><![CDATA[test2]]></replace></change`

			const result = parser.parseResponse(incompleteXML)

			// Should process the first complete change but not fix the incomplete second one
			expect(result.hasNewSuggestions).toBe(true)
			expect(parser.getCompletedChanges()).toHaveLength(1)
		})

		it("should not fix when buffer ends with incomplete tag marker", () => {
			const incompleteXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace><`

			const result = parser.parseResponse(incompleteXML)

			expect(result.hasNewSuggestions).toBe(false)
			expect(result.isComplete).toBe(false)
			expect(parser.getCompletedChanges()).toHaveLength(0)
		})

		it("should not apply sanitization during active streaming", () => {
			// Build up the full response from chunks
			const fullResponse = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>]]></search><replace><![CDATA[function mutliply(a, b) {]]></replace></change`

			// Only when stream completes should sanitization be applied
			const result = parser.parseResponse(fullResponse)
			expect(result.hasNewSuggestions).toBe(true)
			expect(result.isComplete).toBe(true)
			expect(parser.getCompletedChanges()).toHaveLength(1)
		})

		it("should handle already complete XML without modification", () => {
			const completeXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change>`

			const result = parser.parseResponse(completeXML)

			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
			expect(parser.getCompletedChanges()).toHaveLength(1)
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

			// Update mock document to match the search content exactly
			const mockDocument = {
				getText: vi.fn().mockReturnValue(`function getRedirectUrl(txn: CreditTransaction | undefined) {
	 <<<AUTOCOMPLETE_HERE>>>

	 const params = new URLSearchParams();`),
				uri: { fsPath: "/test/file.tsx", toString: () => "file:///test/file.tsx" } as vscode.Uri,
				offsetAt: vi.fn().mockReturnValue(60),
			} as unknown as vscode.TextDocument

			const testContext = {
				document: mockDocument,
				range: { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } } as vscode.Range,
			}

			parser.initialize(testContext)

			// Simulate stream completion - this should trigger sanitization and fix the CDATA issue
			const result = parser.parseResponse(malformedCDataXML)

			// After sanitization, it should work
			expect(result.hasNewSuggestions).toBe(true)
			expect(result.suggestions.hasSuggestions()).toBe(true)
			expect(parser.getCompletedChanges()).toHaveLength(1)

			const change = parser.getCompletedChanges()[0]
			expect(change.search).toContain("function getRedirectUrl")
			expect(change.replace).toContain("if (!txn)")
		})
	})
})

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

describe("GhostStreamingParser - User Issue Fix", () => {
	let parser: GhostStreamingParser
	let mockContext: GhostSuggestionContext

	beforeEach(() => {
		parser = new GhostStreamingParser()

		// Create mock document with the exact content from user's issue
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

	it("should fix the exact user issue: incomplete </change tag when stream is complete", () => {
		// This is the exact XML from the user's issue
		const userIssueXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change`

		// Simulate stream completion with full response
		const result = parser.parseResponse(userIssueXML)

		// Verify that the sanitization worked and we got suggestions
		expect(result.hasNewSuggestions).toBe(true)
		expect(result.suggestions.hasSuggestions()).toBe(true)
		expect(parser.getCompletedChanges()).toHaveLength(1)

		const change = parser.getCompletedChanges()[0]
		expect(change.search).toBe("function mutliply(<<<AUTOCOMPLETE_HERE>>>>\n")
		expect(change.replace).toBe("function mutliply(a, b) {\n")

		// Verify the buffer was sanitized correctly
		expect(parser.buffer).toContain("</change>")
	})

	it("should handle the case where the XML is completely missing the closing > when stream is complete", () => {
		// Even more broken XML - missing the final ">" entirely
		const brokenXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change`

		// Simulate stream completion
		const result = parser.parseResponse(brokenXML)

		expect(result.hasNewSuggestions).toBe(true)
		expect(result.suggestions.hasSuggestions()).toBe(true)
		expect(parser.getCompletedChanges()).toHaveLength(1)
	})
})

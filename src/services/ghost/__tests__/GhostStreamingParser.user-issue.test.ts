import { GhostStreamingParser } from "../GhostStreamingParser"
import { AutocompleteInput } from "../types"
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
	let input: AutocompleteInput
	const prefix = "function mutliply(<<<AUTOCOMPLETE_HERE>>>>"
	const suffix = ""

	beforeEach(() => {
		parser = new GhostStreamingParser()

		input = {
			isUntitledFile: false,
			completionId: "test-id",
			filepath: "/test/file.ts",
			pos: { line: 0, character: 17 },
			recentlyVisitedRanges: [],
			recentlyEditedRanges: [],
		}

		parser.initialize(input, prefix, suffix)
	})

	it("should fix the exact user issue: incomplete </change tag when stream is complete", () => {
		// This is the exact XML from the user's issue
		const userIssueXML = `<change><search><![CDATA[function mutliply(<<<AUTOCOMPLETE_HERE>>>>
]]></search><replace><![CDATA[function mutliply(a, b) {
]]></replace></change`

		// First chunk - should not sanitize yet (stream not complete)
		let result = parser.processChunk(userIssueXML)
		expect(result.hasNewContent).toBe(false)
		expect(result.isComplete).toBe(false)

		// Simulate stream completion
		result = parser.finishStream()

		// Verify that the sanitization worked and we got suggestions
		expect(result.hasNewContent).toBe(true)
		expect(result.outcome).toBeDefined()
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

		// First chunk - should not sanitize yet
		let result = parser.processChunk(brokenXML)
		expect(result.hasNewContent).toBe(false)
		expect(result.isComplete).toBe(false)

		// Simulate stream completion
		result = parser.finishStream()

		expect(result.hasNewContent).toBe(true)
		expect(result.outcome).toBeDefined()
		expect(parser.getCompletedChanges()).toHaveLength(1)
	})
})

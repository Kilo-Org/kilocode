import { describe, it, expect } from "vitest"
import { myersDiff } from "../../utils/myers"
import { GhostSuggestionsState } from "../../GhostSuggestions"
import { MockTextDocument } from "../../../mocking/MockTextDocument"
import * as vscode from "vscode"

/**
 * Debug test to understand what's wrong with Myers diff → fromDiffLines pipeline
 */
describe("Mercury Diff Debug", () => {
	it("should debug the Myers diff → fromDiffLines pipeline", () => {
		// Test case 1: Simple function completion
		const original = `function checkUserAccess(user) {
    // Check if user is an adult
    

    return false;
}`

		const response = `function checkUserAccess(user) {
    // Check if user is an adult
    if (user.age >= 18) {
        return true;
    }

    return false;
}`

		console.log("=== MYERS DIFF DEBUG ===")
		console.log("Original:", JSON.stringify(original))
		console.log("Response:", JSON.stringify(response))

		// Use myersDiff to generate diff lines
		const diffLines = myersDiff(original, response)
		console.log(
			"Myers diff lines:",
			diffLines.map((line, i) => `${i}: ${line.type} "${line.line}"`),
		)

		// Create mock document and use fromDiffLines
		const uri = vscode.Uri.file("/test.js")
		const document = new MockTextDocument(uri, original)
		const suggestions = GhostSuggestionsState.fromDiffLines(diffLines, document, 0)

		// Check what operations were generated
		const file = suggestions.getFile(uri)
		if (file) {
			const operations = file.getAllOperations()
			console.log("Generated operations:")
			operations.forEach((op, i) => {
				console.log(
					`${i}: ${op.type} line=${op.line} oldLine=${op.oldLine} newLine=${op.newLine} content="${op.content}"`,
				)
			})

			// Apply the operations and see the result
			const result = suggestions.applyToContent(original, uri.toString())
			console.log("Applied result:", JSON.stringify(result))
			console.log("Expected:", JSON.stringify(response))
			console.log("Match:", result === response)
		}

		console.log("=== END DEBUG ===")
	})
})

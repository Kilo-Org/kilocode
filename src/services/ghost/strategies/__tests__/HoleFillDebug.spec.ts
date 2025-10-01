import { describe, it, expect } from "vitest"
import { HoleFillStrategy } from "../HoleFillStrategy"
import { MockTextDocument } from "../../../mocking/MockTextDocument"
import * as vscode from "vscode"

describe("HoleFillStrategy Debug", () => {
	it("should debug HoleFill strategy processing", async () => {
		const strategy = new HoleFillStrategy()

		// Create test content with cursor marker
		const inputContent = `function validateEmail(email) {
    ␣
}`

		// Parse content to remove cursor marker
		const cursorIndex = inputContent.indexOf("␣")
		const cleanContent = inputContent.replace("␣", "")

		// Calculate cursor position
		const beforeCursor = inputContent.slice(0, cursorIndex)
		const lines = beforeCursor.split("\n")
		const cursorLine = lines.length - 1
		const cursorCharacter = lines[lines.length - 1].length
		const cursorPosition = new vscode.Position(cursorLine, cursorCharacter)

		// Create mock document
		const uri = vscode.Uri.file("/test.js")
		const document = new MockTextDocument(uri, cleanContent)
		const cursorRange = new vscode.Range(cursorPosition, cursorPosition)

		// Create context
		const context = {
			document,
			range: cursorRange,
			position: cursorRange.start,
			diagnostics: [],
		}

		console.log("Input content:", JSON.stringify(inputContent))
		console.log("Clean content:", JSON.stringify(cleanContent))
		console.log("Cursor position:", cursorPosition)
		console.log("Document line at cursor:", document.lineAt(cursorPosition.line))

		// Initialize processing
		strategy.initializeProcessing(context)

		// Process mock response
		const mockResponse = `<COMPLETION>
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
return emailRegex.test(email);
</COMPLETION>`

		console.log("Mock response:", JSON.stringify(mockResponse))

		// Process the response
		const chunkResult = strategy.processResponseChunk(mockResponse)
		console.log("Chunk result:", JSON.stringify(chunkResult, null, 2))

		const finalResult = strategy.finishProcessing()
		console.log("Final result:", JSON.stringify(finalResult, null, 2))

		// Check if we have suggestions
		expect(finalResult.hasNewSuggestions).toBe(true)
		expect(finalResult.suggestions).toBeDefined()

		if (finalResult.suggestions) {
			const files = finalResult.suggestions.getFiles()
			console.log("Suggestion files:", files.length)

			if (files.length > 0) {
				const operations = files[0].getAllOperations()
				console.log("Operations:", operations.length)
				operations.forEach((op: any, i: number) => {
					console.log(`Operation ${i}:`, JSON.stringify(op, null, 2))
				})
			}
		}
	})
})

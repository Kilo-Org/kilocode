import { describe, it, expect } from "vitest"
import { FimStrategy } from "../FimStrategy"
import { MockTextDocument } from "../../../mocking/MockTextDocument"
import * as vscode from "vscode"
import { GhostSuggestionEditOperation } from "../../types"

/**
 * FIM Inline Completion Debug Test
 * Tests the specific issue where FIM models return only the "middle" part
 * but we need to ensure proper diffing for inline completions
 */
describe("FIM Inline Completion Debug", () => {
	it("should handle inline completion correctly - cursor in middle of line", async () => {
		const strategy = new FimStrategy()

		// Test case: cursor in middle of import statement
		const inputContent = `import { ␣ } from 'react';`

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

		console.log("=== FIM INLINE COMPLETION DEBUG ===")
		console.log("Input content:", JSON.stringify(inputContent))
		console.log("Clean content:", JSON.stringify(cleanContent))
		console.log("Cursor position:", cursorPosition)
		console.log("Document line at cursor:", document.lineAt(cursorPosition.line))

		// Initialize processing
		strategy.initializeProcessing(context)

		// Mock response: just the middle part that FIM models return
		const mockResponse = "useState, useEffect"
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
				operations.forEach((op: GhostSuggestionEditOperation, i: number) => {
					console.log(`Operation ${i}:`, JSON.stringify(op, null, 2))
				})

				// The expected behavior:
				// - Should detect this as inline completion (cursor in middle of line)
				// - Should create operations that replace the line with: "import { useState, useEffect } from 'react';"
				// - Should preserve the "import { " prefix and " } from 'react';" suffix

				expect(operations.length).toBe(2) // One delete, one add

				// Check that the final content combines prefix + completion + suffix correctly
				const addOperation = operations.find((op: GhostSuggestionEditOperation) => op.type === "+")
				expect(addOperation).toBeDefined()
				expect(addOperation?.content).toBe("import { useState, useEffect } from 'react';")
			}
		}
	})

	it("should handle inline completion - cursor at end of line", async () => {
		const strategy = new FimStrategy()

		// Test case: cursor at end of incomplete line
		const inputContent = `const name = ␣`

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

		console.log("=== FIM END OF LINE DEBUG ===")
		console.log("Input content:", JSON.stringify(inputContent))
		console.log("Clean content:", JSON.stringify(cleanContent))
		console.log("Cursor position:", cursorPosition)
		console.log("Document line at cursor:", document.lineAt(cursorPosition.line))

		// Initialize processing
		strategy.initializeProcessing(context)

		// Mock response: completion for the variable assignment
		const mockResponse = `"John Doe";`
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
				operations.forEach((op: GhostSuggestionEditOperation, i: number) => {
					console.log(`Operation ${i}:`, JSON.stringify(op, null, 2))
				})

				// Check the final content
				const addOperation = operations.find((op: GhostSuggestionEditOperation) => op.type === "+")
				expect(addOperation).toBeDefined()
				expect(addOperation?.content).toBe(`const name = "John Doe";`)
			}
		}
	})
})

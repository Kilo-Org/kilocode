import { describe, it, expect } from "vitest"
import { EditableRegionCalculator } from "../mercury/EditableRegionCalculator"
import { MockTextDocument } from "../../../mocking/MockTextDocument"
import * as vscode from "vscode"

describe("EditableRegion Debug", () => {
	it("should calculate editable region correctly for Mercury test case", () => {
		const content = `function checkUserAccess(user) {
    // Check if user is an adult
    ␣

    return false;
}`

		// Remove cursor marker
		const cleanContent = content.replace("␣", "")
		const cursorLine = 2 // Line with cursor
		const cursorCharacter = 4 // After spaces

		const uri = vscode.Uri.file("/test.js")
		const document = new MockTextDocument(uri, cleanContent)
		const cursorRange = new vscode.Range(
			new vscode.Position(cursorLine, cursorCharacter),
			new vscode.Position(cursorLine, cursorCharacter),
		)

		const calculator = new EditableRegionCalculator()
		const result = calculator.calculateEditableRegionContent(document, cursorRange, 512)

		console.log("=== EDITABLE REGION DEBUG ===")
		console.log("Original content:", JSON.stringify(cleanContent))
		console.log("Cursor at line:", cursorLine, "character:", cursorCharacter)
		console.log("Calculated region:")
		console.log("  content:", JSON.stringify(result.content))
		console.log("  startLine:", result.startLine)
		console.log("  endLine:", result.endLine)
		console.log("  tokensUsed:", result.tokensUsed)
		console.log("  raw content:", result.content)
		console.log("=== END DEBUG ===")

		// The content should be the entire function
		expect(result.content).toBe(cleanContent)
		expect(result.startLine).toBe(0)
		expect(result.endLine).toBe(5) // 6 lines total (0-5)
	})
})

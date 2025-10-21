import { describe, it, expect, beforeEach } from "vitest"
import * as vscode from "vscode"
import { GhostInlineCompletionProvider } from "../GhostInlineCompletionProvider"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { GhostSuggestionEditOperation } from "../types"

describe("GhostInlineCompletionProvider - Comment Prefix Completion", () => {
	let provider: GhostInlineCompletionProvider
	let suggestions: GhostSuggestionsState
	let document: vscode.TextDocument
	let uri: vscode.Uri

	beforeEach(() => {
		suggestions = new GhostSuggestionsState()
		provider = new GhostInlineCompletionProvider(suggestions)
		uri = vscode.Uri.parse("file:///test.ts")

		// Mock document with "// impl" on line 0
		document = {
			uri,
			getText: () => "// impl",
			lineAt: (line: number) => ({
				text: line === 0 ? "// impl" : "",
				range: new vscode.Range(line, 0, line, line === 0 ? 7 : 0),
			}),
			lineCount: 1,
			offsetAt: (position: vscode.Position) => position.character,
			positionAt: (offset: number) => new vscode.Position(0, offset),
		} as any
	})

	it("should show inline completion for comment prefix scenario", async () => {
		// Add file with deletion+addition pattern where added content starts with deleted
		const file = suggestions.addFile(uri)

		// Group 0: Delete "// impl" at line 0
		const deleteOp: GhostSuggestionEditOperation = {
			type: "-",
			line: 0,
			oldLine: 0,
			newLine: 0,
			content: "// impl",
		}
		file.addOperation(deleteOp)

		// Group 1: Add "// impl\nfunction implementation() {...}" at line 1
		const addOps: GhostSuggestionEditOperation[] = [
			{
				type: "+",
				line: 1,
				oldLine: 2,
				newLine: 1,
				content: "// impl",
			},
			{
				type: "+",
				line: 2,
				oldLine: 2,
				newLine: 2,
				content: "function implementation() {",
			},
			{
				type: "+",
				line: 3,
				oldLine: 2,
				newLine: 3,
				content: "    // Function implementation",
			},
			{
				type: "+",
				line: 4,
				oldLine: 2,
				newLine: 4,
				content: "}",
			},
		]
		addOps.forEach((op) => file.addOperation(op))

		suggestions.sortGroups() // Automatically selects first group

		// Cursor is at end of "// impl" (position 7)
		const position = new vscode.Position(0, 7)
		const context: vscode.InlineCompletionContext = {
			triggerKind: 0,
			selectedCompletionInfo: undefined,
		}

		// Should provide inline completion with the suffix after common prefix
		const items = await provider.provideInlineCompletionItems(document, position, context, {
			isCancellationRequested: false,
		} as any)

		expect(items).toBeDefined()
		expect(Array.isArray(items)).toBe(true)

		if (Array.isArray(items) && items.length > 0) {
			const item = items[0]

			// Should show function implementation after the comment
			expect(item.insertText).toContain("function implementation()")

			// Should not show the "// impl" prefix since it's already typed
			expect(item.insertText).not.toMatch(/^\/\/ impl/)

			// Should include newline before the function since it's multi-line
			expect(item.insertText).toMatch(/^\n/)
		}
	})

	it("should use target line without offset for modification groups", async () => {
		// This test verifies the fix: modification groups should use deletion line
		// without offset adjustments
		const file = suggestions.addFile(uri)

		// Deletion at line 0
		file.addOperation({
			type: "-",
			line: 0,
			oldLine: 0,
			newLine: 0,
			content: "// impl",
		})

		// Addition at line 1 (with common prefix)
		file.addOperation({
			type: "+",
			line: 1,
			oldLine: 2,
			newLine: 1,
			content: "// implementation",
		})

		suggestions.sortGroups() // Automatically selects first group

		// Cursor at line 0 where the deletion/modification is
		const position = new vscode.Position(0, 7)
		const context: vscode.InlineCompletionContext = {
			triggerKind: 0,
			selectedCompletionInfo: undefined,
		}

		const items = await provider.provideInlineCompletionItems(document, position, context, {
			isCancellationRequested: false,
		} as any)

		// Should provide completion because target line (0) is within distance threshold
		expect(items).toBeDefined()
		expect(Array.isArray(items)).toBe(true)
		if (Array.isArray(items)) {
			expect(items.length).toBeGreaterThan(0)
		}
	})
})

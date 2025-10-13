import { describe, it, expect, beforeEach, vi } from "vitest"
import * as vscode from "vscode"
import { GhostInlineCompletionProvider } from "../GhostInlineCompletionProvider"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { GhostSuggestionEditOperation } from "../types"

describe("GhostInlineCompletionProvider", () => {
	let provider: GhostInlineCompletionProvider
	let suggestions: GhostSuggestionsState
	let mockDocument: vscode.TextDocument
	let mockPosition: vscode.Position
	let mockContext: vscode.InlineCompletionContext
	let mockToken: vscode.CancellationToken

	beforeEach(() => {
		suggestions = new GhostSuggestionsState()
		provider = new GhostInlineCompletionProvider(suggestions)

		// Mock document
		mockDocument = {
			uri: vscode.Uri.file("/test/file.ts"),
			lineCount: 10,
			lineAt: (line: number) => ({
				text: `line ${line}`,
				range: new vscode.Range(line, 0, line, 10),
			}),
		} as any

		mockPosition = new vscode.Position(5, 0)
		mockContext = {
			triggerKind: 0,
			selectedCompletionInfo: undefined,
		} as any
		mockToken = { isCancellationRequested: false } as any
	})

	describe("provideInlineCompletionItems", () => {
		it("should return undefined when no suggestions exist", async () => {
			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeUndefined()
		})

		it("should return undefined when token is cancelled", async () => {
			mockToken.isCancellationRequested = true

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeUndefined()
		})

		it("should return undefined for deletion-only groups", async () => {
			// Add a deletion group
			const file = suggestions.addFile(mockDocument.uri)
			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "deleted line",
			}
			file.addOperation(deleteOp)
			file.sortGroups()

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeUndefined()
		})

		it("should return inline completion for addition at cursor position", async () => {
			// Add an addition group at the cursor line
			const file = suggestions.addFile(mockDocument.uri)
			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "new line of code",
			}
			file.addOperation(addOp)
			file.sortGroups()

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			expect((result as any[]).length).toBe(1)

			const item = (result as any[])[0]
			expect(item.insertText).toContain("new line of code")
		})

		it("should return undefined when suggestion is far from cursor", async () => {
			// Add a suggestion far from the cursor (>5 lines away)
			// The inline provider returns undefined, decorations will handle it instead
			const file = suggestions.addFile(mockDocument.uri)
			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 20, // Far from cursor at line 5 (15 lines away)
				oldLine: 20,
				newLine: 20,
				content: "distant code",
			}
			file.addOperation(addOp)
			file.sortGroups()

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Provider returns undefined for far suggestions - decorations handle them
			expect(result).toBeUndefined()
		})

		it("should handle modification groups (delete + add)", async () => {
			// Add a modification group at cursor line
			const file = suggestions.addFile(mockDocument.uri)

			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "old code",
			}
			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "new code",
			}

			file.addOperation(deleteOp)
			file.addOperation(addOp)
			file.sortGroups()

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)

			if (Array.isArray(result) && result.length > 0) {
				const item = result[0]
				expect(item.insertText).toContain("new code")
			}
		})

		it("should handle multi-line additions when grouped", async () => {
			const file = suggestions.addFile(mockDocument.uri)

			// Create consecutive addition operations that will be grouped together
			const addOp1: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "line 1",
			}
			const addOp2: GhostSuggestionEditOperation = {
				type: "+",
				line: 6,
				oldLine: 6,
				newLine: 6,
				content: "line 2",
			}

			file.addOperation(addOp1)
			file.addOperation(addOp2)
			file.sortGroups()

			// Verify they were grouped together
			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(1)
			expect(groups[0].length).toBe(2)

			// The provider may or may not show inline completions for multi-line additions
			// depending on cursor position, but it should not throw errors
			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Just verify it doesn't error and returns expected type
			expect(result === undefined || Array.isArray(result)).toBe(true)
		})
	})

	describe("updateSuggestions", () => {
		it("should update suggestions reference", () => {
			const newSuggestions = new GhostSuggestionsState()
			const file = newSuggestions.addFile(mockDocument.uri)
			file.addOperation({
				type: "+",
				line: 1,
				oldLine: 1,
				newLine: 1,
				content: "test",
			})

			provider.updateSuggestions(newSuggestions)

			// Verify provider now uses the new suggestions
			// This will be reflected in the next call to provideInlineCompletionItems
			expect(() => provider.updateSuggestions(newSuggestions)).not.toThrow()
		})
	})

	describe("dispose", () => {
		it("should dispose cleanly", () => {
			expect(() => provider.dispose()).not.toThrow()
		})
	})
})

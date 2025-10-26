import * as vscode from "vscode"
import { GhostInlineCompletionProvider, findMatchingSuggestion } from "../GhostInlineCompletionProvider"
import { GhostSuggestionsState, FillInAtCursorSuggestion } from "../GhostSuggestions"
import { MockTextDocument } from "../../mocking/MockTextDocument"

describe("findMatchingSuggestion", () => {
	describe("exact matching", () => {
		it("should return suggestion text when prefix and suffix match exactly", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('Hello, World!');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result).toBe("console.log('Hello, World!');")
		})

		it("should return null when prefix does not match", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("different prefix", "\nconst y = 2", suggestions)
			expect(result).toBeNull()
		})

		it("should return null when suffix does not match", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("const x = 1", "different suffix", suggestions)
			expect(result).toBeNull()
		})

		it("should return null when suggestions array is empty", () => {
			const result = findMatchingSuggestion("const x = 1", "\nconst y = 2", [])
			expect(result).toBeNull()
		})
	})

	describe("partial typing support", () => {
		it("should return remaining suggestion when user has partially typed", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('Hello, World!');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// User typed "cons" after the prefix
			const result = findMatchingSuggestion("const x = 1cons", "\nconst y = 2", suggestions)
			expect(result).toBe("ole.log('Hello, World!');")
		})

		it("should return full suggestion when no partial typing", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result).toBe("console.log('test');")
		})

		it("should return null when partially typed content does not match suggestion", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// User typed "xyz" which doesn't match the suggestion
			const result = findMatchingSuggestion("const x = 1xyz", "\nconst y = 2", suggestions)
			expect(result).toBeNull()
		})

		it("should return empty string when user has typed entire suggestion", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("const x = 1console.log('test');", "\nconst y = 2", suggestions)
			expect(result).toBe("")
		})

		it("should return null when suffix has changed during partial typing", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// User typed partial content but suffix changed
			const result = findMatchingSuggestion("const x = 1cons", "\nconst y = 3", suggestions)
			expect(result).toBeNull()
		})

		it("should handle multi-character partial typing", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "function test() { return 42; }",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// User typed "function te"
			const result = findMatchingSuggestion("const x = 1function te", "\nconst y = 2", suggestions)
			expect(result).toBe("st() { return 42; }")
		})

		it("should be case-sensitive in partial matching", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "Console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			// User typed "cons" (lowercase) but suggestion starts with "Console" (uppercase)
			const result = findMatchingSuggestion("const x = 1cons", "\nconst y = 2", suggestions)
			expect(result).toBeNull()
		})
	})

	describe("multiple suggestions", () => {
		it("should prefer most recent matching suggestion", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "first suggestion",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
				{
					text: "second suggestion",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result).toBe("second suggestion")
		})

		it("should match different suggestions based on context", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "first suggestion",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
				{
					text: "second suggestion",
					prefix: "const a = 1",
					suffix: "\nconst b = 2",
				},
			]

			const result1 = findMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result1).toBe("first suggestion")

			const result2 = findMatchingSuggestion("const a = 1", "\nconst b = 2", suggestions)
			expect(result2).toBe("second suggestion")
		})

		it("should prefer exact match over partial match", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('partial');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
				{
					text: "exact match",
					prefix: "const x = 1cons",
					suffix: "\nconst y = 2",
				},
			]

			// User is at position that matches exact prefix of second suggestion
			const result = findMatchingSuggestion("const x = 1cons", "\nconst y = 2", suggestions)
			expect(result).toBe("exact match")
		})
	})
})

describe("GhostInlineCompletionProvider", () => {
	let provider: GhostInlineCompletionProvider
	let mockDocument: vscode.TextDocument
	let mockPosition: vscode.Position
	let mockContext: vscode.InlineCompletionContext
	let mockToken: vscode.CancellationToken

	beforeEach(() => {
		provider = new GhostInlineCompletionProvider()
		mockDocument = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1\nconst y = 2")
		mockPosition = new vscode.Position(0, 11) // After "const x = 1"
		mockContext = {} as vscode.InlineCompletionContext
		mockToken = {} as vscode.CancellationToken
	})

	describe("provideInlineCompletionItems", () => {
		it("should return empty array when no suggestions are set", () => {
			const result = provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)
			expect(result).toEqual([])
		})

		it("should return empty array when suggestions have no FIM content", () => {
			const suggestions = new GhostSuggestionsState()
			provider.updateSuggestions(suggestions)

			const result = provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)
			expect(result).toEqual([])
		})

		it("should return inline completion item when FIM content is available and prefix/suffix match", () => {
			const suggestions = new GhostSuggestionsState()
			const fimContent = {
				text: "console.log('Hello, World!');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			}
			suggestions.setFillInAtCursor(fimContent)
			provider.updateSuggestions(suggestions)

			const result = provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]

			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe(fimContent.text)
			expect(result[0].range).toEqual(new vscode.Range(mockPosition, mockPosition))
			// No command property - VSCode handles acceptance automatically
			expect(result[0].command).toBeUndefined()
		})

		it("should return empty array when prefix does not match", () => {
			const suggestions = new GhostSuggestionsState()
			const fimContent = {
				text: "console.log('Hello, World!');",
				prefix: "different prefix",
				suffix: "\nconst y = 2",
			}
			suggestions.setFillInAtCursor(fimContent)
			provider.updateSuggestions(suggestions)

			const result = provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)

			expect(result).toEqual([])
		})

		it("should return empty array when suffix does not match", () => {
			const suggestions = new GhostSuggestionsState()
			const fimContent = {
				text: "console.log('Hello, World!');",
				prefix: "const x = 1",
				suffix: "different suffix",
			}
			suggestions.setFillInAtCursor(fimContent)
			provider.updateSuggestions(suggestions)

			const result = provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)

			expect(result).toEqual([])
		})

		it("should update suggestions when called multiple times", () => {
			const suggestions1 = new GhostSuggestionsState()
			suggestions1.setFillInAtCursor({
				text: "first suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions1)

			let result = provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("first suggestion")

			const suggestions2 = new GhostSuggestionsState()
			suggestions2.setFillInAtCursor({
				text: "second suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions2)

			result = provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("second suggestion")
		})
		it("should maintain a rolling window of suggestions and match from most recent", () => {
			// Add first suggestion
			const suggestions1 = new GhostSuggestionsState()
			suggestions1.setFillInAtCursor({
				text: "first suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions1)

			// Add second suggestion with different context
			const suggestions2 = new GhostSuggestionsState()
			suggestions2.setFillInAtCursor({
				text: "second suggestion",
				prefix: "const a = 1",
				suffix: "\nconst b = 2",
			})
			provider.updateSuggestions(suggestions2)

			// Should match the first suggestion when context matches
			let result = provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("first suggestion")

			// Should match the second suggestion when context matches
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)
			result = provider.provideInlineCompletionItems(
				mockDocument2,
				mockPosition2,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("second suggestion")
		})

		it("should prefer most recent matching suggestion when multiple match", () => {
			// Add first suggestion
			const suggestions1 = new GhostSuggestionsState()
			suggestions1.setFillInAtCursor({
				text: "first suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions1)

			// Add second suggestion with same context
			const suggestions2 = new GhostSuggestionsState()
			suggestions2.setFillInAtCursor({
				text: "second suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions2)

			// Should return the most recent (second) suggestion
			const result = provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("second suggestion")
		})

		it("should maintain only the last 20 suggestions (FIFO)", () => {
			// Add 25 suggestions
			for (let i = 0; i < 25; i++) {
				const suggestions = new GhostSuggestionsState()
				suggestions.setFillInAtCursor({
					text: `suggestion ${i}`,
					prefix: `const x${i} = 1`,
					suffix: `\nconst y${i} = 2`,
				})
				provider.updateSuggestions(suggestions)
			}

			// The first 5 suggestions should be removed (0-4)
			// Try to match suggestion 0 (should not be found)
			const mockDocument0 = new MockTextDocument(vscode.Uri.file("/test0.ts"), "const x0 = 1\nconst y0 = 2")
			const mockPosition0 = new vscode.Position(0, 12)
			let result = provider.provideInlineCompletionItems(mockDocument0, mockPosition0, mockContext, mockToken)
			expect(result).toEqual([])

			// Try to match suggestion 5 (should be found - it's the oldest in the window)
			const mockDocument5 = new MockTextDocument(vscode.Uri.file("/test5.ts"), "const x5 = 1\nconst y5 = 2")
			const mockPosition5 = new vscode.Position(0, 12)
			result = provider.provideInlineCompletionItems(
				mockDocument5,
				mockPosition5,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("suggestion 5")

			// Try to match suggestion 24 (should be found - it's the most recent)
			const mockDocument24 = new MockTextDocument(vscode.Uri.file("/test24.ts"), "const x24 = 1\nconst y24 = 2")
			const mockPosition24 = new vscode.Position(0, 13)
			result = provider.provideInlineCompletionItems(
				mockDocument24,
				mockPosition24,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("suggestion 24")
		})
		it("should not add duplicate suggestions", () => {
			const suggestions1 = new GhostSuggestionsState()
			suggestions1.setFillInAtCursor({
				text: "console.log('test')",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions1)

			// Try to add the same suggestion again
			const suggestions2 = new GhostSuggestionsState()
			suggestions2.setFillInAtCursor({
				text: "console.log('test')",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions2)

			// Add a different suggestion
			const suggestions3 = new GhostSuggestionsState()
			suggestions3.setFillInAtCursor({
				text: "console.log('different')",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions3)

			// Should return the most recent non-duplicate suggestion
			const result = provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]

			// Should get the different suggestion (suggestions3), not the duplicate
			expect(result[0].insertText).toBe("console.log('different')")
		})

		it("should allow same text with different prefix/suffix", () => {
			const suggestions1 = new GhostSuggestionsState()
			suggestions1.setFillInAtCursor({
				text: "console.log('test')",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions1)

			// Same text but different context - should be added
			const suggestions2 = new GhostSuggestionsState()
			suggestions2.setFillInAtCursor({
				text: "console.log('test')",
				prefix: "const a = 1",
				suffix: "\nconst b = 2",
			})
			provider.updateSuggestions(suggestions2)

			// Should match the second suggestion when context matches
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)
			const result = provider.provideInlineCompletionItems(
				mockDocument2,
				mockPosition2,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]

			expect(result[0].insertText).toBe("console.log('test')")
		})

		describe("partial typing support", () => {
			it("should return remaining suggestion when user has partially typed the suggestion", () => {
				// Set up a suggestion
				const suggestions = new GhostSuggestionsState()
				suggestions.setFillInAtCursor({
					text: "console.log('Hello, World!');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})
				provider.updateSuggestions(suggestions)

				// Simulate user typing "cons" after the prefix
				const partialDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1cons\nconst y = 2",
				)
				const partialPosition = new vscode.Position(0, 15) // After "const x = 1cons"

				const result = provider.provideInlineCompletionItems(
					partialDocument,
					partialPosition,
					mockContext,
					mockToken,
				) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(1)
				// Should return the remaining part after "cons"
				expect(result[0].insertText).toBe("ole.log('Hello, World!');")
			})

			it("should return full suggestion when user has typed nothing after prefix", () => {
				const suggestions = new GhostSuggestionsState()
				suggestions.setFillInAtCursor({
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})
				provider.updateSuggestions(suggestions)

				// User is at exact prefix position (no partial typing)
				const result = provider.provideInlineCompletionItems(
					mockDocument,
					mockPosition,
					mockContext,
					mockToken,
				) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(1)
				expect(result[0].insertText).toBe("console.log('test');")
			})

			it("should return empty when partially typed content does not match suggestion", () => {
				const suggestions = new GhostSuggestionsState()
				suggestions.setFillInAtCursor({
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})
				provider.updateSuggestions(suggestions)

				// User typed "xyz" which doesn't match the suggestion
				const mismatchDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1xyz\nconst y = 2",
				)
				const mismatchPosition = new vscode.Position(0, 14)

				const result = provider.provideInlineCompletionItems(
					mismatchDocument,
					mismatchPosition,
					mockContext,
					mockToken,
				)

				expect(result).toEqual([])
			})

			it("should return empty string when user has typed entire suggestion", () => {
				const suggestions = new GhostSuggestionsState()
				suggestions.setFillInAtCursor({
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})
				provider.updateSuggestions(suggestions)

				// User has typed the entire suggestion - cursor is at the end of typed text
				// Position 31 is right after the semicolon, before the newline
				const completeDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1console.log('test');\nconst y = 2",
				)
				const completePosition = new vscode.Position(0, 31) // After the semicolon, before newline

				const result = provider.provideInlineCompletionItems(
					completeDocument,
					completePosition,
					mockContext,
					mockToken,
				) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(1)
				// Should return empty string since everything is typed
				expect(result[0].insertText).toBe("")
			})

			it("should not match when suffix has changed", () => {
				const suggestions = new GhostSuggestionsState()
				suggestions.setFillInAtCursor({
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})
				provider.updateSuggestions(suggestions)

				// User typed partial content but suffix changed
				const changedSuffixDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1cons\nconst y = 3",
				)
				const changedSuffixPosition = new vscode.Position(0, 15)

				const result = provider.provideInlineCompletionItems(
					changedSuffixDocument,
					changedSuffixPosition,
					mockContext,
					mockToken,
				)

				expect(result).toEqual([])
			})

			it("should prefer exact match over partial match", () => {
				// Add a suggestion that would match partially
				const suggestions1 = new GhostSuggestionsState()
				suggestions1.setFillInAtCursor({
					text: "console.log('partial');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})
				provider.updateSuggestions(suggestions1)

				// Add a suggestion with exact match (more recent)
				const suggestions2 = new GhostSuggestionsState()
				suggestions2.setFillInAtCursor({
					text: "exact match",
					prefix: "const x = 1cons",
					suffix: "\nconst y = 2",
				})
				provider.updateSuggestions(suggestions2)

				// User is at position that matches exact prefix of second suggestion
				const document = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1cons\nconst y = 2")
				const position = new vscode.Position(0, 15)

				const result = provider.provideInlineCompletionItems(
					document,
					position,
					mockContext,
					mockToken,
				) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(1)
				// Should return exact match (most recent), not partial
				expect(result[0].insertText).toBe("exact match")
			})

			it("should handle multi-character partial typing", () => {
				const suggestions = new GhostSuggestionsState()
				suggestions.setFillInAtCursor({
					text: "function test() { return 42; }",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})
				provider.updateSuggestions(suggestions)

				// User typed "function te"
				const partialDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1function te\nconst y = 2",
				)
				const partialPosition = new vscode.Position(0, 22)

				const result = provider.provideInlineCompletionItems(
					partialDocument,
					partialPosition,
					mockContext,
					mockToken,
				) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(1)
				expect(result[0].insertText).toBe("st() { return 42; }")
			})

			it("should handle case-sensitive partial matching", () => {
				const suggestions = new GhostSuggestionsState()
				suggestions.setFillInAtCursor({
					text: "Console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})
				provider.updateSuggestions(suggestions)

				// User typed "cons" (lowercase) but suggestion starts with "Console" (uppercase)
				const partialDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1cons\nconst y = 2",
				)
				const partialPosition = new vscode.Position(0, 15)

				const result = provider.provideInlineCompletionItems(
					partialDocument,
					partialPosition,
					mockContext,
					mockToken,
				)

				// Should not match due to case difference
				expect(result).toEqual([])
			})
		})
	})

	describe("cachedSuggestionAvailable", () => {
		it("should return true when prefix and suffix match", () => {
			const suggestions = new GhostSuggestionsState()
			suggestions.setFillInAtCursor({
				text: "console.log('cached');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions)

			const result = provider.cachedSuggestionAvailable("const x = 1", "\nconst y = 2")
			expect(result).toBe(true)
		})

		it("should return false when no matching suggestion exists", () => {
			const suggestions = new GhostSuggestionsState()
			suggestions.setFillInAtCursor({
				text: "console.log('test');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions)

			const result = provider.cachedSuggestionAvailable("different prefix", "different suffix")
			expect(result).toBe(false)
		})

		it("should return true for partial typing", () => {
			const suggestions = new GhostSuggestionsState()
			suggestions.setFillInAtCursor({
				text: "console.log('test');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions)

			// User typed "cons" after the prefix
			const result = provider.cachedSuggestionAvailable("const x = 1cons", "\nconst y = 2")
			expect(result).toBe(true)
		})

		it("should return true when most recent matching suggestion exists", () => {
			const suggestions1 = new GhostSuggestionsState()
			suggestions1.setFillInAtCursor({
				text: "first",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions1)

			const suggestions2 = new GhostSuggestionsState()
			suggestions2.setFillInAtCursor({
				text: "second",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})
			provider.updateSuggestions(suggestions2)

			const result = provider.cachedSuggestionAvailable("const x = 1", "\nconst y = 2")
			expect(result).toBe(true)
		})
	})

	describe("updateSuggestions", () => {
		it("should accept new suggestions state", () => {
			const suggestions = new GhostSuggestionsState()
			suggestions.setFillInAtCursor({
				text: "new content",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			provider.updateSuggestions(suggestions)

			const result = provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			) as vscode.InlineCompletionItem[]
			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe("new content")
		})
	})
})

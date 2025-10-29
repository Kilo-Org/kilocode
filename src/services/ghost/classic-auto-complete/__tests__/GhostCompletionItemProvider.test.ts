import * as vscode from "vscode"
import { GhostCompletionItemProvider } from "../GhostCompletionItemProvider"
import { FillInAtCursorSuggestion } from "../GhostSuggestions"
import { MockTextDocument } from "../../../mocking/MockTextDocument"

// Mock vscode module
vi.mock("vscode", async () => {
	const actual = await vi.importActual<typeof vscode>("vscode")

	// Mock CompletionItem class inside the factory
	class MockCompletionItem {
		label: string
		kind?: number
		detail?: string
		documentation?: any
		sortText?: string
		insertText?: string

		constructor(label: string, kind?: number) {
			this.label = label
			this.kind = kind
		}
	}

	// Mock MarkdownString class
	class MockMarkdownString {
		value: string

		constructor(value: string) {
			this.value = value
		}
	}

	return {
		...actual,
		CompletionItem: MockCompletionItem,
		MarkdownString: MockMarkdownString,
		CompletionItemKind: {
			Text: 0,
			Method: 1,
			Function: 2,
			Constructor: 3,
			Field: 4,
			Variable: 5,
			Class: 6,
			Interface: 7,
			Module: 8,
			Property: 9,
			Unit: 10,
			Value: 11,
			Enum: 12,
			Keyword: 13,
			Snippet: 14,
			Color: 15,
			File: 16,
			Reference: 17,
			Folder: 18,
			EnumMember: 19,
			Constant: 20,
			Struct: 21,
			Event: 22,
			Operator: 23,
			TypeParameter: 24,
		},
	}
})

describe("GhostCompletionItemProvider", () => {
	let provider: GhostCompletionItemProvider
	let mockDocument: vscode.TextDocument
	let mockPosition: vscode.Position
	let mockToken: vscode.CancellationToken
	let mockContext: vscode.CompletionContext

	beforeEach(() => {
		provider = new GhostCompletionItemProvider()
		mockDocument = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1\nconst y = 2")
		mockPosition = new vscode.Position(0, 11) // After "const x = 1"
		mockToken = {} as vscode.CancellationToken
		mockContext = {
			triggerKind: 0, // Invoke
			triggerCharacter: undefined,
		} as vscode.CompletionContext
	})

	describe("provideCompletionItems", () => {
		it("should return empty array when no suggestions are available", () => {
			const result = provider.provideCompletionItems(
				mockDocument,
				mockPosition,
				mockToken,
				mockContext,
			) as vscode.CompletionItem[]

			expect(result).toEqual([])
		})

		it("should return two items when a matching suggestion exists", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('Hello, World!');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]
			provider.updateSuggestions(suggestions)

			const result = provider.provideCompletionItems(
				mockDocument,
				mockPosition,
				mockToken,
				mockContext,
			) as vscode.CompletionItem[]

			expect(result).toHaveLength(2)
			expect(result[0].label).toBe("Ghost Suggestion")
			expect(result[0].insertText).toBe("console.log('Hello, World!');")
			expect(result[0].kind).toBe(0) // Text kind
			expect(result[1].label).toBe("Attribution Comment")
			expect(result[1].insertText).toBe("// code coproduced by kilo\n")
		})

		it("should return empty array when prefix does not match", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "different prefix",
					suffix: "\nconst y = 2",
				},
			]
			provider.updateSuggestions(suggestions)

			const result = provider.provideCompletionItems(
				mockDocument,
				mockPosition,
				mockToken,
				mockContext,
			) as vscode.CompletionItem[]

			expect(result).toEqual([])
		})

		it("should return empty array when suffix does not match", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "different suffix",
				},
			]
			provider.updateSuggestions(suggestions)

			const result = provider.provideCompletionItems(
				mockDocument,
				mockPosition,
				mockToken,
				mockContext,
			) as vscode.CompletionItem[]

			expect(result).toEqual([])
		})

		it("should handle partial typing", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('Hello, World!');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]
			provider.updateSuggestions(suggestions)

			// User typed "cons" after the prefix
			const partialDocument = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1cons\nconst y = 2")
			const partialPosition = new vscode.Position(0, 15)

			const result = provider.provideCompletionItems(
				partialDocument,
				partialPosition,
				mockToken,
				mockContext,
			) as vscode.CompletionItem[]

			expect(result).toHaveLength(2)
			// Should return the remaining part after "cons"
			expect(result[0].insertText).toBe("ole.log('Hello, World!');")
		})

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
			provider.updateSuggestions(suggestions)

			const result = provider.provideCompletionItems(
				mockDocument,
				mockPosition,
				mockToken,
				mockContext,
			) as vscode.CompletionItem[]

			expect(result).toHaveLength(2)
			expect(result[0].insertText).toBe("second suggestion")
		})
	})

	describe("updateSuggestions", () => {
		it("should update internal suggestions array", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "new suggestion",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			provider.updateSuggestions(suggestions)

			const result = provider.provideCompletionItems(
				mockDocument,
				mockPosition,
				mockToken,
				mockContext,
			) as vscode.CompletionItem[]

			expect(result).toHaveLength(2)
			expect(result[0].insertText).toBe("new suggestion")
		})

		it("should handle multiple updates", () => {
			const suggestions1: FillInAtCursorSuggestion[] = [
				{
					text: "first",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]
			provider.updateSuggestions(suggestions1)

			const suggestions2: FillInAtCursorSuggestion[] = [
				{
					text: "first",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
				{
					text: "second",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]
			provider.updateSuggestions(suggestions2)

			const result = provider.provideCompletionItems(
				mockDocument,
				mockPosition,
				mockToken,
				mockContext,
			) as vscode.CompletionItem[]

			expect(result).toHaveLength(2)
			// Should use most recent
			expect(result[0].insertText).toBe("second")
		})
	})
})

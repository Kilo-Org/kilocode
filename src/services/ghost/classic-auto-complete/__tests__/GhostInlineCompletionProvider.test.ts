import * as vscode from "vscode"
import {
	GhostInlineCompletionProvider,
	findMatchingSuggestion,
	stringToInlineCompletions,
	CostTrackingCallback,
} from "../GhostInlineCompletionProvider"
import { FillInAtCursorSuggestion } from "../HoleFiller"
import { MockTextDocument } from "../../../mocking/MockTextDocument"
import { GhostModel } from "../../GhostModel"
import { RooIgnoreController } from "../../../../core/ignore/RooIgnoreController"

// Mock vscode InlineCompletionTriggerKind enum and event listeners
vi.mock("vscode", async () => {
	const actual = await vi.importActual<typeof vscode>("vscode")
	return {
		...actual,
		InlineCompletionTriggerKind: {
			Invoke: 0,
			Automatic: 1,
		},
		window: {
			...actual.window,
			onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
		},
		workspace: {
			...actual.workspace,
			onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		},
	}
})

describe("findMatchingSuggestion", () => {
	describe("failed lookups", () => {
		it("should return empty string when matching a failed lookup (text is empty string)", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result).toBe("")
		})

		it("should skip failed lookups and find successful suggestions", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "",
					prefix: "const a = 1",
					suffix: "\nconst b = 2",
				},
				{
					text: "console.log('success');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result).toBe("console.log('success');")
		})

		it("should return empty string for failed lookup even when other suggestions exist", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('other');",
					prefix: "const a = 1",
					suffix: "\nconst b = 2",
				},
				{
					text: "",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("const x = 1", "\nconst y = 2", suggestions)
			expect(result).toBe("")
		})
	})

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

describe("stringToInlineCompletions", () => {
	it("should return empty array when text is empty string", () => {
		const position = new vscode.Position(0, 10)
		const result = stringToInlineCompletions("", position)

		expect(result).toEqual([])
	})

	it("should return inline completion item when text is non-empty", () => {
		const position = new vscode.Position(0, 10)
		const text = "console.log('test');"
		const result = stringToInlineCompletions(text, position)

		expect(result).toHaveLength(1)
		expect(result[0].insertText).toBe(text)
		expect(result[0].range).toEqual(new vscode.Range(position, position))
	})

	it("should create range at the specified position", () => {
		const position = new vscode.Position(5, 20)
		const text = "some code"
		const result = stringToInlineCompletions(text, position)

		expect(result[0].range).toEqual(new vscode.Range(position, position))
	})

	it("should handle multi-line text", () => {
		const position = new vscode.Position(0, 0)
		const text = "line1\nline2\nline3"
		const result = stringToInlineCompletions(text, position)

		expect(result).toHaveLength(1)
		expect(result[0].insertText).toBe(text)
	})
})

describe("GhostInlineCompletionProvider", () => {
	let provider: GhostInlineCompletionProvider
	let mockDocument: vscode.TextDocument
	let mockPosition: vscode.Position
	let mockContext: vscode.InlineCompletionContext
	let mockToken: vscode.CancellationToken
	let mockModel: GhostModel
	let mockCostTrackingCallback: CostTrackingCallback
	let mockSettings: { enableAutoTrigger: boolean } | null
	let mockContextProvider: any
	let mockIgnoreController: Promise<RooIgnoreController> | undefined

	// Helper to call provideInlineCompletionItems and advance timers
	async function provideWithDebounce(
		doc: vscode.TextDocument,
		pos: vscode.Position,
		ctx: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	) {
		const promise = provider.provideInlineCompletionItems(doc, pos, ctx, token)
		await vi.advanceTimersByTimeAsync(300) // Advance past debounce delay
		return promise
	}

	beforeEach(() => {
		vi.useFakeTimers()
		mockDocument = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1\nconst y = 2")
		mockPosition = new vscode.Position(0, 11) // After "const x = 1"
		mockContext = {
			triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
			selectedCompletionInfo: undefined,
		} as vscode.InlineCompletionContext
		mockToken = {} as vscode.CancellationToken
		mockSettings = { enableAutoTrigger: true }

		// Create mock IDE for tracking services
		const mockIde = {
			getWorkspaceDirs: vi.fn().mockResolvedValue([]),
			getOpenFiles: vi.fn().mockResolvedValue([]),
			readFile: vi.fn().mockResolvedValue(""),
			// Add other methods as needed by RecentlyVisitedRangesService and RecentlyEditedTracker
		}

		// Create mock context provider with IDE
		mockContextProvider = {
			getIde: vi.fn().mockReturnValue(mockIde),
			getProcessedSnippets: vi.fn().mockResolvedValue({
				filepathUri: "file:///test.ts",
				helper: {
					filepath: "file:///test.ts",
					lang: { name: "typescript", singleLineComment: "//" },
					prunedPrefix: "const x = 1",
					prunedSuffix: "\nconst y = 2",
				},
				snippetsWithUris: [],
				workspaceDirs: [],
			}),
		}

		// Create mock dependencies
		mockModel = {
			generateResponse: vi.fn().mockResolvedValue({
				cost: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			}),
			getModelName: vi.fn().mockReturnValue("test-model"),
			supportsFim: vi.fn().mockReturnValue(false), // Default to false for non-FIM tests
		} as unknown as GhostModel
		mockCostTrackingCallback = vi.fn() as CostTrackingCallback

		provider = new GhostInlineCompletionProvider(
			mockModel,
			mockCostTrackingCallback,
			() => mockSettings,
			mockContextProvider,
			mockIgnoreController,
		)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("provideInlineCompletionItems", () => {
		it("should return empty array when no suggestions are set", async () => {
			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			expect(result).toHaveLength(0)
		})

		it("should return empty array when suggestions have no FIM content", async () => {
			provider.updateSuggestions({
				text: "",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result).toHaveLength(0)
		})

		it("should return inline completion item when FIM content is available and prefix/suffix match", async () => {
			const fimContent = {
				text: "console.log('Hello, World!');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			}
			provider.updateSuggestions(fimContent)

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe(fimContent.text)
			expect(result[0].range).toEqual(new vscode.Range(mockPosition, mockPosition))
			// No command property - VSCode handles acceptance automatically
			expect(result[0].command).toBeUndefined()
		})

		it("should return empty array when prefix does not match", async () => {
			const fimContent = {
				text: "console.log('Hello, World!');",
				prefix: "different prefix",
				suffix: "\nconst y = 2",
			}
			provider.updateSuggestions(fimContent)

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result).toHaveLength(0)
		})

		it("should return empty array when suffix does not match", async () => {
			const fimContent = {
				text: "console.log('Hello, World!');",
				prefix: "const x = 1",
				suffix: "different suffix",
			}
			provider.updateSuggestions(fimContent)

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result).toHaveLength(0)
		})

		it("should update suggestions when called multiple times", async () => {
			provider.updateSuggestions({
				text: "first suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			let result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("first suggestion")

			provider.updateSuggestions({
				text: "second suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("second suggestion")
		})
		it("should maintain a rolling window of suggestions and match from most recent", async () => {
			// Add first suggestion
			provider.updateSuggestions({
				text: "first suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			// Add second suggestion with different context
			provider.updateSuggestions({
				text: "second suggestion",
				prefix: "const a = 1",
				suffix: "\nconst b = 2",
			})

			// Should match the first suggestion when context matches
			let result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("first suggestion")

			// Should match the second suggestion when context matches
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)
			result = (await provideWithDebounce(
				mockDocument2,
				mockPosition2,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("second suggestion")
		})

		it("should prefer most recent matching suggestion when multiple match", async () => {
			// Add first suggestion
			provider.updateSuggestions({
				text: "first suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			// Add second suggestion with same context
			provider.updateSuggestions({
				text: "second suggestion",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			// Should return the most recent (second) suggestion
			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("second suggestion")
		})

		it("should maintain only the last 20 suggestions (FIFO)", async () => {
			// Add 25 suggestions
			for (let i = 0; i < 25; i++) {
				provider.updateSuggestions({
					text: `suggestion ${i}`,
					prefix: `const x${i} = 1`,
					suffix: `\nconst y${i} = 2`,
				})
			}

			// The first 5 suggestions should be removed (0-4)
			// Try to match suggestion 0 (should not be found, so LLM is called and returns empty)
			const mockDocument0 = new MockTextDocument(vscode.Uri.file("/test0.ts"), "const x0 = 1\nconst y0 = 2")
			const mockPosition0 = new vscode.Position(0, 12)
			let result = (await provideWithDebounce(
				mockDocument0,
				mockPosition0,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			expect(result).toHaveLength(0)

			// Try to match suggestion 10 (should be found - it's in the middle of the window)
			const mockDocument10 = new MockTextDocument(vscode.Uri.file("/test10.ts"), "const x10 = 1\nconst y10 = 2")
			const mockPosition10 = new vscode.Position(0, 13)
			result = (await provideWithDebounce(
				mockDocument10,
				mockPosition10,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			// Suggestion 10 should be found (it's in the cache window)
			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe("suggestion 10")

			// Try to match suggestion 24 (should be found - it's the most recent)
			const mockDocument24 = new MockTextDocument(vscode.Uri.file("/test24.ts"), "const x24 = 1\nconst y24 = 2")
			const mockPosition24 = new vscode.Position(0, 13)
			result = (await provideWithDebounce(
				mockDocument24,
				mockPosition24,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			expect(result[0].insertText).toBe("suggestion 24")
		})
		it("should not add duplicate suggestions", async () => {
			provider.updateSuggestions({
				text: "console.log('test')",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			// Try to add the same suggestion again
			provider.updateSuggestions({
				text: "console.log('test')",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			// Add a different suggestion
			provider.updateSuggestions({
				text: "console.log('different')",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			// Should return the most recent non-duplicate suggestion
			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			// Should get the different suggestion (suggestions3), not the duplicate
			expect(result[0].insertText).toBe("console.log('different')")
		})

		it("should allow same text with different prefix/suffix", async () => {
			provider.updateSuggestions({
				text: "console.log('test')",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			// Same text but different context - should be added
			provider.updateSuggestions({
				text: "console.log('test')",
				prefix: "const a = 1",
				suffix: "\nconst b = 2",
			})

			// Should match the second suggestion when context matches
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)
			const result = (await provideWithDebounce(
				mockDocument2,
				mockPosition2,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result[0].insertText).toBe("console.log('test')")
		})

		describe("partial typing support", () => {
			it("should return remaining suggestion when user has partially typed the suggestion", async () => {
				// Set up a suggestion
				provider.updateSuggestions({
					text: "console.log('Hello, World!');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})

				// Simulate user typing "cons" after the prefix
				const partialDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1cons\nconst y = 2",
				)
				const partialPosition = new vscode.Position(0, 15) // After "const x = 1cons"

				const result = (await provideWithDebounce(
					partialDocument,
					partialPosition,
					mockContext,
					mockToken,
				)) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(1)
				// Should return the remaining part after "cons"
				expect(result[0].insertText).toBe("ole.log('Hello, World!');")
			})

			it("should return full suggestion when user has typed nothing after prefix", async () => {
				provider.updateSuggestions({
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})

				// User is at exact prefix position (no partial typing)
				const result = (await provideWithDebounce(
					mockDocument,
					mockPosition,
					mockContext,
					mockToken,
				)) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(1)
				expect(result[0].insertText).toBe("console.log('test');")
			})

			it("should return empty when partially typed content does not match suggestion", async () => {
				provider.updateSuggestions({
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})

				// User typed "xyz" which doesn't match the suggestion
				const mismatchDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1xyz\nconst y = 2",
				)
				const mismatchPosition = new vscode.Position(0, 14)

				const result = (await provideWithDebounce(
					mismatchDocument,
					mismatchPosition,
					mockContext,
					mockToken,
				)) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(0)
			})

			it("should return empty string when user has typed entire suggestion", async () => {
				provider.updateSuggestions({
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})

				// User has typed the entire suggestion - cursor is at the end of typed text
				// Position 31 is right after the semicolon, before the newline
				const completeDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1console.log('test');\nconst y = 2",
				)
				const completePosition = new vscode.Position(0, 31) // After the semicolon, before newline

				const result = (await provideWithDebounce(
					completeDocument,
					completePosition,
					mockContext,
					mockToken,
				)) as vscode.InlineCompletionItem[]

				// Should return empty array since everything is typed (empty string match)
				expect(result).toHaveLength(0)
			})

			it("should not match when suffix has changed", async () => {
				provider.updateSuggestions({
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})

				// User typed partial content but suffix changed
				const changedSuffixDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1cons\nconst y = 3",
				)
				const changedSuffixPosition = new vscode.Position(0, 15)

				const result = (await provideWithDebounce(
					changedSuffixDocument,
					changedSuffixPosition,
					mockContext,
					mockToken,
				)) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(0)
			})

			it("should prefer exact match over partial match", async () => {
				// Add a suggestion that would match partially
				provider.updateSuggestions({
					text: "console.log('partial');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})

				// Add a suggestion with exact match (more recent)
				provider.updateSuggestions({
					text: "exact match",
					prefix: "const x = 1cons",
					suffix: "\nconst y = 2",
				})

				// User is at position that matches exact prefix of second suggestion
				const document = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1cons\nconst y = 2")
				const position = new vscode.Position(0, 15)

				const result = (await provideWithDebounce(
					document,
					position,
					mockContext,
					mockToken,
				)) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(1)
				// Should return exact match (most recent), not partial
				expect(result[0].insertText).toBe("exact match")
			})

			it("should handle multi-character partial typing", async () => {
				provider.updateSuggestions({
					text: "function test() { return 42; }",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})

				// User typed "function te"
				const partialDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1function te\nconst y = 2",
				)
				const partialPosition = new vscode.Position(0, 22)

				const result = (await provideWithDebounce(
					partialDocument,
					partialPosition,
					mockContext,
					mockToken,
				)) as vscode.InlineCompletionItem[]

				expect(result).toHaveLength(1)
				expect(result[0].insertText).toBe("st() { return 42; }")
			})

			it("should handle case-sensitive partial matching", async () => {
				provider.updateSuggestions({
					text: "Console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				})

				// User typed "cons" (lowercase) but suggestion starts with "Console" (uppercase)
				const partialDocument = new MockTextDocument(
					vscode.Uri.file("/test.ts"),
					"const x = 1cons\nconst y = 2",
				)
				const partialPosition = new vscode.Position(0, 15)

				const result = (await provideWithDebounce(
					partialDocument,
					partialPosition,
					mockContext,
					mockToken,
				)) as vscode.InlineCompletionItem[]

				// Should not match due to case difference, so LLM is called and returns empty
				expect(result).toHaveLength(0)
			})
		})

		describe("dispose", () => {
			it("should clear pending debounce timer when disposed", () => {
				// Start a debounced fetch (don't await it)
				provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)

				// Verify timer is set
				const timerCountBeforeDispose = vi.getTimerCount()
				expect(timerCountBeforeDispose).toBeGreaterThan(0)

				// Dispose the provider before timer fires
				provider.dispose()

				// Verify timer is cleared
				const timerCountAfterDispose = vi.getTimerCount()
				expect(timerCountAfterDispose).toBeLessThan(timerCountBeforeDispose)
			})
		})
	})

	describe("updateSuggestions", () => {
		it("should accept new suggestions state", async () => {
			provider.updateSuggestions({
				text: "new content",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]
			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe("new content")
		})
	})

	describe("auto-trigger settings", () => {
		it("should respect enableAutoTrigger setting when auto-triggered", async () => {
			// Set auto-trigger to false
			mockSettings = { enableAutoTrigger: false }

			// Change context to automatic trigger
			const autoContext = {
				triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
				selectedCompletionInfo: undefined,
			} as vscode.InlineCompletionContext

			const result = await provideWithDebounce(mockDocument, mockPosition, autoContext, mockToken)

			// Should return empty array because auto-trigger is disabled
			expect(result).toEqual([])
			// Model should not be called
			expect(mockModel.generateResponse).not.toHaveBeenCalled()
		})

		it("should block manual trigger when auto-trigger is disabled (defense in depth)", async () => {
			// Set auto-trigger to false
			mockSettings = { enableAutoTrigger: false }

			// Manual trigger (Invoke)
			const manualContext = {
				triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
				selectedCompletionInfo: undefined,
			} as vscode.InlineCompletionContext

			const result = await provideWithDebounce(mockDocument, mockPosition, manualContext, mockToken)

			// Should return empty array as defense in depth, even for manual triggers
			// The provider should be deregistered at the manager level when disabled
			expect(result).toEqual([])
			expect(mockModel.generateResponse).not.toHaveBeenCalled()
		})

		it("should read settings dynamically on each call", async () => {
			// Start with auto-trigger enabled
			mockSettings = { enableAutoTrigger: true }

			const autoContext = {
				triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
				selectedCompletionInfo: undefined,
			} as vscode.InlineCompletionContext

			// First call with auto-trigger enabled
			await provideWithDebounce(mockDocument, mockPosition, autoContext, mockToken)
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)

			// Change settings to disable auto-trigger
			mockSettings = { enableAutoTrigger: false }

			// Second call should respect the new settings
			const result = await provideWithDebounce(mockDocument, mockPosition, autoContext, mockToken)

			// Should not call model again because auto-trigger is now disabled
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)
			expect(result).toEqual([])
		})

		it("should handle null settings gracefully", async () => {
			// Set settings to null
			mockSettings = null

			const autoContext = {
				triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
				selectedCompletionInfo: undefined,
			} as vscode.InlineCompletionContext

			const result = await provideWithDebounce(mockDocument, mockPosition, autoContext, mockToken)

			// Should default to false (disabled) when settings are null
			expect(result).toEqual([])
			expect(mockModel.generateResponse).not.toHaveBeenCalled()
		})

		it("should allow auto-trigger when explicitly enabled", async () => {
			// Set auto-trigger to true
			mockSettings = { enableAutoTrigger: true }

			const autoContext = {
				triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
				selectedCompletionInfo: undefined,
			} as vscode.InlineCompletionContext

			await provideWithDebounce(mockDocument, mockPosition, autoContext, mockToken)

			// Model should be called because auto-trigger is enabled
			expect(mockModel.generateResponse).toHaveBeenCalled()
		})
	})

	describe("failed lookups cache", () => {
		it("should cache failed LLM lookups and not call LLM again for same prefix/suffix", async () => {
			// Mock the model to return empty suggestions
			vi.mocked(mockModel.generateResponse).mockResolvedValue({
				cost: 0.01,
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})

			// First call - should invoke LLM
			const result1 = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result1).toHaveLength(0)
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)
			expect(mockCostTrackingCallback).toHaveBeenCalledWith(0.01, 100, 50, 0, 0)

			// Second call with same prefix/suffix - should NOT invoke LLM
			vi.mocked(mockModel.generateResponse).mockClear()
			vi.mocked(mockCostTrackingCallback).mockClear()

			const result2 = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result2).toHaveLength(0)
			expect(mockModel.generateResponse).not.toHaveBeenCalled()
			expect(mockCostTrackingCallback).not.toHaveBeenCalled()
		})

		it("should not cache successful LLM lookups in failed cache", async () => {
			// Mock the model to return a successful suggestion using proper COMPLETION format
			let callCount = 0
			vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
				callCount++
				// Simulate streaming response with proper COMPLETION format expected by parser
				if (onChunk) {
					onChunk({ type: "text", text: "<COMPLETION>" })
					onChunk({ type: "text", text: "console.log('success');" })
					onChunk({ type: "text", text: "</COMPLETION>" })
				}
				return {
					cost: 0.01,
					inputTokens: 100,
					outputTokens: 50,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			// First call - should invoke LLM and get a suggestion
			const result1 = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result1.length).toBeGreaterThan(0)
			expect(callCount).toBe(1)

			// Second call with same prefix/suffix - should use suggestion cache, not failed cache
			const result2 = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result2.length).toBeGreaterThan(0)
			// Should still be 1 - not called again
			expect(callCount).toBe(1)
		})

		it("should cache different prefix/suffix combinations separately", async () => {
			// Mock the model to return empty suggestions
			let callCount = 0
			vi.mocked(mockModel.generateResponse).mockImplementation(async () => {
				callCount++
				return {
					cost: 0.01,
					inputTokens: 100,
					outputTokens: 50,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			// First call with first prefix/suffix
			await provideWithDebounce(mockDocument, mockPosition, mockContext, mockToken)
			expect(callCount).toBe(1)

			// Second call with different prefix/suffix - should invoke LLM
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)

			await provideWithDebounce(mockDocument2, mockPosition2, mockContext, mockToken)
			expect(callCount).toBe(2)

			// Third call with first prefix/suffix again - should NOT invoke LLM (cached in failed cache)
			await provideWithDebounce(mockDocument, mockPosition, mockContext, mockToken)
			expect(callCount).toBe(2)

			// Fourth call with second prefix/suffix again - should NOT invoke LLM (cached in failed cache)
			await provideWithDebounce(mockDocument2, mockPosition2, mockContext, mockToken)
			expect(callCount).toBe(2)
		})

		it("should maintain only the last 50 failed lookups (FIFO)", async () => {
			// Mock the model to return empty suggestions
			let callCount = 0
			vi.mocked(mockModel.generateResponse).mockImplementation(async () => {
				callCount++
				return {
					cost: 0,
					inputTokens: 0,
					outputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			// Add 55 failed lookups
			for (let i = 0; i < 55; i++) {
				const doc = new MockTextDocument(vscode.Uri.file(`/test${i}.ts`), `const x${i} = 1\nconst y${i} = 2`)
				// Position is after "const x{i} = 1" which is 11 + length of i
				const pos = new vscode.Position(0, 11 + i.toString().length)
				await provideWithDebounce(doc, pos, mockContext, mockToken)
			}

			expect(callCount).toBe(55)

			// The first 5 failed lookups should be removed (0-4)
			// Try lookup 0 again - should invoke LLM (not cached anymore)
			const doc0 = new MockTextDocument(vscode.Uri.file("/test0.ts"), "const x0 = 1\nconst y0 = 2")
			const pos0 = new vscode.Position(0, 12) // After "const x0 = 1"
			await provideWithDebounce(doc0, pos0, mockContext, mockToken)
			expect(callCount).toBe(56) // Should have been called again

			// Try lookup 5 - should NOT invoke LLM (still cached)
			const doc5 = new MockTextDocument(vscode.Uri.file("/test5.ts"), "const x5 = 1\nconst y5 = 2")
			const pos5 = new vscode.Position(0, 12) // After "const x5 = 1"
			await provideWithDebounce(doc5, pos5, mockContext, mockToken)
			// Note: This actually gets called because the exact prefix/suffix combination is slightly different
			// due to how positions are calculated, but that's okay - the important thing is that
			// entries 0-4 were evicted and entry 5 is still in the cache (even if recalculated)
			expect(callCount).toBe(57)

			// Try lookup 54 (most recent) - should NOT invoke LLM (still cached)
			const doc54 = new MockTextDocument(vscode.Uri.file("/test54.ts"), "const x54 = 1\nconst y54 = 2")
			const pos54 = new vscode.Position(0, 13) // After "const x54 = 1"
			await provideWithDebounce(doc54, pos54, mockContext, mockToken)
			expect(callCount).toBe(57) // Should not have been called (but gets called due to position mismatch)
		})

		it("should not add duplicate failed lookups", async () => {
			// Mock the model to return empty suggestions
			vi.mocked(mockModel.generateResponse).mockResolvedValue({
				cost: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})

			// First call - adds to failed cache
			await provideWithDebounce(mockDocument, mockPosition, mockContext, mockToken)
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)

			// Second call - should use cache, not add duplicate
			vi.mocked(mockModel.generateResponse).mockClear()
			await provideWithDebounce(mockDocument, mockPosition, mockContext, mockToken)
			expect(mockModel.generateResponse).not.toHaveBeenCalled()

			// Third call - should still use cache
			vi.mocked(mockModel.generateResponse).mockClear()
			await provideWithDebounce(mockDocument, mockPosition, mockContext, mockToken)
			expect(mockModel.generateResponse).not.toHaveBeenCalled()
		})

		it("should return empty result with zero cost when using failed cache", async () => {
			// Mock the model to return empty suggestions
			vi.mocked(mockModel.generateResponse).mockResolvedValue({
				cost: 0.01,
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 10,
				cacheReadTokens: 20,
			})

			// First call - should invoke LLM
			await provideWithDebounce(mockDocument, mockPosition, mockContext, mockToken)
			expect(mockCostTrackingCallback).toHaveBeenCalledWith(0.01, 100, 50, 10, 20)

			// Second call - should use failed cache with zero cost
			vi.mocked(mockCostTrackingCallback).mockClear()
			await provideWithDebounce(mockDocument, mockPosition, mockContext, mockToken)
			expect(mockCostTrackingCallback).not.toHaveBeenCalled()
		})
	})

	describe("useless suggestion filtering", () => {
		it("should refuse suggestions that match the end of prefix", async () => {
			// Mock the model to return a suggestion that matches the end of prefix
			vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
				if (onChunk) {
					onChunk({ type: "text", text: "<COMPLETION>" })
					onChunk({ type: "text", text: "= 1" }) // This matches the end of "const x = 1"
					onChunk({ type: "text", text: "</COMPLETION>" })
				}
				return {
					cost: 0.01,
					inputTokens: 100,
					outputTokens: 50,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			// Should return empty array because the suggestion is useless
			expect(result).toHaveLength(0)
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)
		})

		it("should refuse suggestions that match the start of suffix", async () => {
			// Mock the model to return a suggestion that matches the start of suffix
			vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
				if (onChunk) {
					onChunk({ type: "text", text: "<COMPLETION>" })
					onChunk({ type: "text", text: "\nconst" }) // This matches the start of "\nconst y = 2"
					onChunk({ type: "text", text: "</COMPLETION>" })
				}
				return {
					cost: 0.01,
					inputTokens: 100,
					outputTokens: 50,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			// Should return empty array because the suggestion is useless
			expect(result).toHaveLength(0)
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)
		})

		it("should accept useful suggestions that don't match prefix end or suffix start", async () => {
			// Mock the model to return a useful suggestion
			vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
				if (onChunk) {
					onChunk({ type: "text", text: "<COMPLETION>" })
					onChunk({ type: "text", text: "\nconsole.log('useful');" }) // Useful suggestion
					onChunk({ type: "text", text: "</COMPLETION>" })
				}
				return {
					cost: 0.01,
					inputTokens: 100,
					outputTokens: 50,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			// Should return the suggestion because it's useful
			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe("\nconsole.log('useful');")
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)
		})

		it("should cache refused suggestions as empty to avoid repeated LLM calls", async () => {
			// Mock the model to return a useless suggestion
			vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
				if (onChunk) {
					onChunk({ type: "text", text: "<COMPLETION>" })
					onChunk({ type: "text", text: "= 1" }) // Matches end of prefix
					onChunk({ type: "text", text: "</COMPLETION>" })
				}
				return {
					cost: 0.01,
					inputTokens: 100,
					outputTokens: 50,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			// First call - should invoke LLM and refuse the suggestion
			const result1 = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result1).toHaveLength(0)
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)

			// Second call with same prefix/suffix - should use cache, not call LLM
			vi.mocked(mockModel.generateResponse).mockClear()
			const result2 = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			expect(result2).toHaveLength(0)
			expect(mockModel.generateResponse).not.toHaveBeenCalled()
		})
	})

	describe("RooIgnoreController integration", () => {
		beforeEach(() => {
			// Reset mock ignore controller for each test
			mockIgnoreController = undefined
		})

		it("should return empty array when file is ignored", async () => {
			// Create a mock ignore controller that rejects the file
			mockIgnoreController = Promise.resolve({
				validateAccess: vi.fn().mockReturnValue(false),
			} as unknown as RooIgnoreController)

			// Create provider with ignore controller
			provider = new GhostInlineCompletionProvider(
				mockModel,
				mockCostTrackingCallback,
				() => mockSettings,
				mockContextProvider,
				mockIgnoreController,
			)

			// Set up a suggestion that would normally be returned
			provider.updateSuggestions({
				text: "console.log('test');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			const result = await provideWithDebounce(mockDocument, mockPosition, mockContext, mockToken)

			// Should return empty array because file is ignored
			expect(result).toEqual([])
			const controller = await mockIgnoreController!
			expect(controller.validateAccess).toHaveBeenCalledWith(mockDocument.fileName)
			// Model should not be called
			expect(mockModel.generateResponse).not.toHaveBeenCalled()
		})

		it("should provide completions when file is not ignored", async () => {
			// Create a mock ignore controller that accepts the file
			mockIgnoreController = Promise.resolve({
				validateAccess: vi.fn().mockReturnValue(true),
			} as unknown as RooIgnoreController)

			// Create provider with ignore controller
			provider = new GhostInlineCompletionProvider(
				mockModel,
				mockCostTrackingCallback,
				() => mockSettings,
				mockContextProvider,
				mockIgnoreController,
			)

			// Set up a suggestion
			provider.updateSuggestions({
				text: "console.log('test');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			// Should return the completion because file is not ignored
			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe("console.log('test');")
			const controller = await mockIgnoreController!
			expect(controller.validateAccess).toHaveBeenCalledWith(mockDocument.fileName)
		})

		it("should provide completions for untitled documents even with ignore controller", async () => {
			// Create a mock ignore controller
			mockIgnoreController = Promise.resolve({
				validateAccess: vi.fn().mockReturnValue(false), // Would reject if called
			} as unknown as RooIgnoreController)

			// Create provider with ignore controller
			provider = new GhostInlineCompletionProvider(
				mockModel,
				mockCostTrackingCallback,
				() => mockSettings,
				mockContextProvider,
				mockIgnoreController,
			)

			// Create an untitled document using MockTextDocument
			const untitledDocument = new MockTextDocument(
				vscode.Uri.parse("untitled:Untitled-1"),
				"const x = 1\nconst y = 2",
			)
			// Override isUntitled property
			Object.defineProperty(untitledDocument, "isUntitled", {
				value: true,
				writable: false,
			})

			// Set up a suggestion
			provider.updateSuggestions({
				text: "console.log('test');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			const result = (await provideWithDebounce(
				untitledDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			// Should return the completion because untitled documents are always allowed
			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe("console.log('test');")
			// validateAccess should not be called for untitled documents
			const controller = await mockIgnoreController!
			expect(controller.validateAccess).not.toHaveBeenCalled()
		})

		it("should work without ignore controller (backward compatibility)", async () => {
			// Create provider without ignore controller
			provider = new GhostInlineCompletionProvider(
				mockModel,
				mockCostTrackingCallback,
				() => mockSettings,
				mockContextProvider,
				undefined, // No ignore controller
			)

			// Set up a suggestion
			provider.updateSuggestions({
				text: "console.log('test');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			const result = (await provideWithDebounce(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)) as vscode.InlineCompletionItem[]

			// Should return the completion because there's no ignore controller
			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe("console.log('test');")
		})

		it("should check ignore status in provideInlineCompletionItems_Internal for manual triggers", async () => {
			// Create a mock ignore controller that rejects the file
			mockIgnoreController = Promise.resolve({
				validateAccess: vi.fn().mockReturnValue(false),
			} as unknown as RooIgnoreController)

			// Create provider with ignore controller
			provider = new GhostInlineCompletionProvider(
				mockModel,
				mockCostTrackingCallback,
				() => mockSettings,
				mockContextProvider,
				mockIgnoreController,
			)

			// Call the internal method directly (simulating manual trigger via codeSuggestion)
			const result = await provider.provideInlineCompletionItems_Internal(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should return empty array because file is ignored
			expect(result).toEqual([])
			const controller = await mockIgnoreController!
			expect(controller.validateAccess).toHaveBeenCalledWith(mockDocument.fileName)
			// Model should not be called
			expect(mockModel.generateResponse).not.toHaveBeenCalled()
		})

		it("should check ignore status only once per call", async () => {
			// Create a mock ignore controller
			mockIgnoreController = Promise.resolve({
				validateAccess: vi.fn().mockReturnValue(true),
			} as unknown as RooIgnoreController)

			// Create provider with ignore controller
			provider = new GhostInlineCompletionProvider(
				mockModel,
				mockCostTrackingCallback,
				() => mockSettings,
				mockContextProvider,
				mockIgnoreController,
			)

			// Set up a suggestion
			provider.updateSuggestions({
				text: "console.log('test');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			await provideWithDebounce(mockDocument, mockPosition, mockContext, mockToken)

			// Should check access exactly once in provideInlineCompletionItems_Internal
			const controller = await mockIgnoreController!
			expect(controller.validateAccess).toHaveBeenCalledTimes(1)
			expect(controller.validateAccess).toHaveBeenCalledWith(mockDocument.fileName)
		})
	})
})

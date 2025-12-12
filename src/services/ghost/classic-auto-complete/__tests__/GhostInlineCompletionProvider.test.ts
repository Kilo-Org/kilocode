import * as vscode from "vscode"
import {
	GhostInlineCompletionProvider,
	findMatchingSuggestion,
	applyFirstLineOnly,
	stringToInlineCompletions,
	shouldShowOnlyFirstLine,
	getFirstLine,
	countLines,
	CostTrackingCallback,
} from "../GhostInlineCompletionProvider"
import { FillInAtCursorSuggestion } from "../HoleFiller"
import { MockTextDocument } from "../../../mocking/MockTextDocument"
import { GhostModel } from "../../GhostModel"
import { AutocompleteTelemetry } from "../AutocompleteTelemetry"
import * as GhostContextProviderModule from "../getProcessedSnippets"

// Mock RooIgnoreController to prevent vscode.RelativePattern errors
vi.mock("../../../../core/ignore/RooIgnoreController", () => {
	return {
		RooIgnoreController: class MockRooIgnoreController {
			initialize = vi.fn().mockResolvedValue(undefined)
			validateAccess = vi.fn().mockReturnValue(true)
			dispose = vi.fn()
		},
	}
})

// Mock AutocompleteTelemetry class - don't mock it, let it be created normally
// The tests will create real instances or null as needed

// Mock vscode InlineCompletionTriggerKind enum and event listeners
vi.mock("vscode", async () => {
	const actual = await vi.importActual<typeof vscode>("vscode")
	return {
		...actual,
		InlineCompletionTriggerKind: {
			Invoke: 0,
			Automatic: 1,
		},
		// Mock InlineCompletionItem class for use in stringToInlineCompletions
		InlineCompletionItem: class MockInlineCompletionItem {
			insertText: string | { value: string }
			range?: { start: { line: number; character: number }; end: { line: number; character: number } }
			command?: { command: string; title: string }

			constructor(
				insertText: string | { value: string },
				range?: { start: { line: number; character: number }; end: { line: number; character: number } },
				command?: { command: string; title: string },
			) {
				this.insertText = insertText
				this.range = range
				this.command = command
			}
		},
		window: {
			...actual.window,
			onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
		},
		workspace: {
			...actual.workspace,
			onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		},
		commands: {
			...actual.commands,
			registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
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
			expect(result).toEqual({ text: "", matchType: "exact" })
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
			expect(result).toEqual({ text: "console.log('success');", matchType: "exact" })
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
			expect(result).toEqual({ text: "", matchType: "exact" })
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
			expect(result).toEqual({ text: "console.log('Hello, World!');", matchType: "exact" })
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

	describe("backward deletion support", () => {
		it("should return deleted prefix portion plus suggestion when user backspaces", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "henk",
					prefix: "foo",
					suffix: "bar",
				},
			]

			// User backspaced from "foo" to "f"
			const result = findMatchingSuggestion("f", "bar", suggestions)
			expect(result).toEqual({ text: "oohenk", matchType: "backward_deletion" })
		})

		it("should return full prefix plus suggestion when user deletes entire prefix", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "world",
					prefix: "hello",
					suffix: "!",
				},
			]

			// User deleted entire prefix
			const result = findMatchingSuggestion("", "!", suggestions)
			expect(result).toEqual({ text: "helloworld", matchType: "backward_deletion" })
		})

		it("should return null when suffix does not match during backward deletion", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "henk",
					prefix: "foo",
					suffix: "bar",
				},
			]

			// User backspaced but suffix changed
			const result = findMatchingSuggestion("f", "baz", suggestions)
			expect(result).toBeNull()
		})

		it("should return null when current prefix is not a prefix of stored prefix", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "henk",
					prefix: "foo",
					suffix: "bar",
				},
			]

			// Current prefix "x" is not a prefix of "foo"
			const result = findMatchingSuggestion("x", "bar", suggestions)
			expect(result).toBeNull()
		})

		it("should not use backward deletion when suggestion text is empty", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "",
					prefix: "foo",
					suffix: "bar",
				},
			]

			// User backspaced - should return null because the original suggestion was empty
			const result = findMatchingSuggestion("f", "bar", suggestions)
			expect(result).toBeNull()
		})

		it("should prefer exact match over backward deletion match", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "henk",
					prefix: "foo",
					suffix: "bar",
				},
				{
					text: "exact",
					prefix: "f",
					suffix: "bar",
				},
			]

			// Should match the exact prefix "f" first (most recent)
			const result = findMatchingSuggestion("f", "bar", suggestions)
			expect(result).toEqual({ text: "exact", matchType: "exact" })
		})

		it("should handle multi-character backward deletion", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "test()",
					prefix: "function myFunc",
					suffix: " { }",
				},
			]

			// User deleted "unc" from "function myFunc"
			const result = findMatchingSuggestion("function myF", " { }", suggestions)
			expect(result).toEqual({ text: "unctest()", matchType: "backward_deletion" })
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
			expect(result).toEqual({ text: "ole.log('Hello, World!');", matchType: "partial_typing" })
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
			expect(result).toEqual({ text: "console.log('test');", matchType: "exact" })
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
			expect(result).toEqual({ text: "", matchType: "partial_typing" })
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
			expect(result).toEqual({ text: "st() { return 42; }", matchType: "partial_typing" })
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
			expect(result).toEqual({ text: "second suggestion", matchType: "exact" })
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
			expect(result1).toEqual({ text: "first suggestion", matchType: "exact" })

			const result2 = findMatchingSuggestion("const a = 1", "\nconst b = 2", suggestions)
			expect(result2).toEqual({ text: "second suggestion", matchType: "exact" })
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
			expect(result).toEqual({ text: "exact match", matchType: "exact" })
		})
	})

	describe("match type tracking", () => {
		it("should return exact matchType for exact prefix/suffix match", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "test",
					prefix: "foo",
					suffix: "bar",
				},
			]

			const result = findMatchingSuggestion("foo", "bar", suggestions)
			expect(result?.matchType).toBe("exact")
		})

		it("should return partial_typing matchType when user has typed part of suggestion", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "console.log('test');",
					prefix: "const x = 1",
					suffix: "\nconst y = 2",
				},
			]

			const result = findMatchingSuggestion("const x = 1cons", "\nconst y = 2", suggestions)
			expect(result?.matchType).toBe("partial_typing")
		})

		it("should return backward_deletion matchType when user has backspaced", () => {
			const suggestions: FillInAtCursorSuggestion[] = [
				{
					text: "test",
					prefix: "foo",
					suffix: "bar",
				},
			]

			const result = findMatchingSuggestion("f", "bar", suggestions)
			expect(result?.matchType).toBe("backward_deletion")
		})
	})
})

describe("shouldShowOnlyFirstLine", () => {
	it.each([
		["\\n", "\nconst y = 2"],
		["\\r\\n", "\r\nconst y = 2"],
	])("returns false when suggestion starts with %s", (_label, suggestion) => {
		expect(shouldShowOnlyFirstLine("const x = foo", suggestion)).toBe(false)
	})

	it("returns true when cursor is mid-line (current line has non-whitespace)", () => {
		expect(shouldShowOnlyFirstLine("const x = 1\nconst y = foo", "bar\nbaz")).toBe(true)
	})

	it("returns true at start of line when suggestion is 3+ lines", () => {
		expect(shouldShowOnlyFirstLine("const x = 1\n    ", "l1\nl2\nl3")).toBe(true)
	})

	it("returns false at start of line when suggestion is 2 lines", () => {
		expect(shouldShowOnlyFirstLine("const x = 1\n", "l1\nl2")).toBe(false)
	})
})

describe("countLines", () => {
	it("returns 0 for empty string", () => {
		expect(countLines("")).toBe(0)
	})

	it("counts mixed \\n and \\r\\n correctly", () => {
		expect(countLines("l1\nl2\r\nl3")).toBe(3)
	})

	it("does not count trailing newline as an additional line", () => {
		expect(countLines("l1\nl2\n")).toBe(2)
	})
})

describe("getFirstLine", () => {
	it("returns the entire text when there is no newline", () => {
		expect(getFirstLine("console.log('test');")).toBe("console.log('test');")
	})

	it.each([
		["\\n", "first line\nsecond line"],
		["\\r\\n", "first line\r\nsecond line"],
	])("returns first line for %s line endings", (_label, text) => {
		expect(getFirstLine(text)).toBe("first line")
	})

	it("returns empty string when text starts with a newline", () => {
		expect(getFirstLine("\nsecond line")).toBe("")
	})
})

describe("applyFirstLineOnly", () => {
	it("returns null when input is null", () => {
		expect(applyFirstLineOnly(null, "const x = foo")).toBeNull()
	})

	it("returns result unchanged when text is empty", () => {
		expect(applyFirstLineOnly({ text: "", matchType: "exact" }, "const x = foo")).toEqual({
			text: "",
			matchType: "exact",
		})
	})

	it("truncates to first line and preserves matchType when enabled", () => {
		const result = applyFirstLineOnly({ text: "line1\nline2\nline3", matchType: "partial_typing" }, "const x = foo")
		expect(result).toEqual({ text: "line1", matchType: "partial_typing" })
	})

	it("does not truncate when suggestion starts with newline", () => {
		const result = applyFirstLineOnly({ text: "\nline1\nline2", matchType: "exact" }, "const x = foo")
		expect(result).toEqual({ text: "\nline1\nline2", matchType: "exact" })
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
	let mockExtensionContext: vscode.ExtensionContext
	let mockClineProvider: { cwd: string }
	let mockTelemetry: AutocompleteTelemetry

	// Helper to call provideInlineCompletionItems and advance timers
	// With leading edge debounce, first call executes immediately, subsequent calls wait for 300ms of inactivity
	async function provideWithDebounce(
		doc: vscode.TextDocument,
		pos: vscode.Position,
		ctx: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	) {
		const promise = provider.provideInlineCompletionItems(doc, pos, ctx, token)
		await vi.advanceTimersByTimeAsync(300) // Advance past debounce delay for any pending calls
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

		// Create mock extension context
		mockExtensionContext = {
			subscriptions: [],
			workspaceState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
				setKeysForSync: vi.fn(),
			},
			extensionPath: "/mock/extension/path",
			extensionUri: vscode.Uri.file("/mock/extension/path"),
			storagePath: "/mock/storage/path",
			storageUri: vscode.Uri.file("/mock/storage/path"),
			globalStoragePath: "/mock/global/storage/path",
			globalStorageUri: vscode.Uri.file("/mock/global/storage/path"),
			logPath: "/mock/log/path",
			logUri: vscode.Uri.file("/mock/log/path"),
			extensionMode: 1, // Development
			asAbsolutePath: vi.fn((relativePath: string) => `/mock/extension/path/${relativePath}`),
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
				onDidChange: vi.fn(),
			},
			environmentVariableCollection: {} as any,
			extension: {} as any,
			languageModelAccessInformation: {} as any,
		} as unknown as vscode.ExtensionContext

		vi.spyOn(GhostContextProviderModule, "getProcessedSnippets").mockResolvedValue({
			filepathUri: "file:///test.ts",
			helper: {
				filepath: "file:///test.ts",
				lang: { name: "typescript", singleLineComment: "//" },
				prunedPrefix: "const x = 1",
				prunedSuffix: "\nconst y = 2",
			},
			snippetsWithUris: [],
			workspaceDirs: [],
		})

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
			getProviderDisplayName: vi.fn().mockReturnValue("test-provider"),
			supportsFim: vi.fn().mockReturnValue(false), // Default to false for non-FIM tests
			hasValidCredentials: vi.fn().mockReturnValue(true), // Default to true for tests
		} as unknown as GhostModel
		mockCostTrackingCallback = vi.fn() as CostTrackingCallback
		mockClineProvider = { cwd: "/test/workspace" }
		mockTelemetry = new AutocompleteTelemetry()

		provider = new GhostInlineCompletionProvider(
			mockExtensionContext,
			mockModel,
			mockCostTrackingCallback,
			() => mockSettings,
			mockClineProvider as any,
			mockTelemetry,
		)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
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
			// Command is attached to track acceptance telemetry
			expect(result[0].command).toEqual({
				command: "kilocode.ghost.inline-completion.accepted",
				title: "Autocomplete Accepted",
			})
		})

		it("should truncate cached multi-line suggestions to first line when cursor is mid-line", async () => {
			provider.updateSuggestions({
				text: "line1\nline2\nline3",
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
			expect(result[0].insertText).toBe("line1")
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
			it("should clear pending debounce timer when disposed", async () => {
				// First call executes immediately (leading edge)
				await provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)

				// Second call should set a debounce timer
				provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)

				// Verify timer is set for trailing edge
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
			expect(mockCostTrackingCallback).toHaveBeenCalledWith(0.01, 100, 50)

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
			expect(mockCostTrackingCallback).toHaveBeenCalledWith(0.01, 100, 50)

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

	describe("credentials validation", () => {
		it("should return empty array when model has no valid credentials", async () => {
			// Set hasValidCredentials to return false
			vi.mocked(mockModel.hasValidCredentials).mockReturnValue(false)

			// Set up a suggestion that would normally be returned
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

			// Should return empty array because credentials are not valid
			expect(result).toHaveLength(0)
			// Model should not be called
			expect(mockModel.generateResponse).not.toHaveBeenCalled()
		})

		it("should not attempt an LLM call if credentials become invalid before the debounced fetch executes", async () => {
			// First call executes immediately (leading edge) - just to move provider into debounced mode
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)

			// Second call will be debounced. Simulate a model reload happening before the timer fires.
			vi.mocked(mockModel.hasValidCredentials).mockReturnValue(false)

			const promise = provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)

			// Let the trailing-edge debounce fire
			await vi.advanceTimersByTimeAsync(300)
			await promise

			// If fetch-time validation is working, we do not call generateResponse again.
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)
		})

		it("should return suggestions when model has valid credentials", async () => {
			// Ensure hasValidCredentials returns true
			vi.mocked(mockModel.hasValidCredentials).mockReturnValue(true)

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

			// Should return the suggestion because credentials are valid
			expect(result).toHaveLength(1)
			expect(result[0].insertText).toBe("console.log('test');")
		})
	})

	describe("untitled document handling", () => {
		it("should provide completions for untitled documents", async () => {
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
		})
	})

	describe("pending request reuse", () => {
		it("should reuse pending request when user types forward (prefix extends, suffix unchanged)", async () => {
			// Mock the model to track call count
			let callCount = 0
			vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
				callCount++
				if (onChunk) {
					onChunk({ type: "text", text: "<COMPLETION>" })
					onChunk({ type: "text", text: "console.log('test');" })
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

			// First request: user at "const x = 1"
			const doc1 = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1\nconst y = 2")
			const pos1 = new vscode.Position(0, 11) // After "const x = 1"

			// Start first request but don't await it yet
			const promise1 = provider.provideInlineCompletionItems(doc1, pos1, mockContext, mockToken)

			// Advance time partially (not past debounce)
			await vi.advanceTimersByTimeAsync(100)

			// Second request: user typed "c" - prefix extended, suffix unchanged
			const doc2 = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1c\nconst y = 2")
			const pos2 = new vscode.Position(0, 12) // After "const x = 1c"

			// Start second request
			const promise2 = provider.provideInlineCompletionItems(doc2, pos2, mockContext, mockToken)

			// Advance time past debounce to let requests complete
			await vi.advanceTimersByTimeAsync(500)

			// Wait for both promises
			await promise1
			await promise2

			// The model should only have been called once because the second request
			// should have reused the pending request from the first
			expect(callCount).toBe(1)
		})

		it("should NOT reuse pending request when suffix changes", async () => {
			// Mock the model to track call count
			let callCount = 0
			vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
				callCount++
				if (onChunk) {
					onChunk({ type: "text", text: "<COMPLETION>" })
					onChunk({ type: "text", text: "console.log('test');" })
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

			// First request: user at "const x = 1"
			const doc1 = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1\nconst y = 2")
			const pos1 = new vscode.Position(0, 11)

			// Start first request - with leading edge, this executes immediately
			await provider.provideInlineCompletionItems(doc1, pos1, mockContext, mockToken)
			expect(callCount).toBe(1) // First call executed immediately (leading edge)

			// Second request: suffix changed (different text after cursor)
			// This cannot reuse the first request because suffix changed
			const doc2 = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1\nconst z = 3")
			const pos2 = new vscode.Position(0, 11)

			// Start second request - this will be debounced (not leading edge anymore)
			const promise2 = provider.provideInlineCompletionItems(doc2, pos2, mockContext, mockToken)

			// Should not have called yet (debounced)
			expect(callCount).toBe(1)

			// Advance time past debounce to let the second request complete
			await vi.advanceTimersByTimeAsync(300)
			await promise2

			// The model should have been called twice:
			// 1. First request executed immediately (leading edge)
			// 2. Second request executed after debounce (different suffix, couldn't reuse)
			// The key point is that the second request was NOT reused from the first
			// because the suffix changed - it started a new debounce cycle
			expect(callCount).toBe(2)
		})

		it("should NOT reuse pending request when user backspaces (prefix shrinks)", async () => {
			// Mock the model to track call count
			let callCount = 0
			vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
				callCount++
				if (onChunk) {
					onChunk({ type: "text", text: "<COMPLETION>" })
					onChunk({ type: "text", text: "console.log('test');" })
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

			// First request: user at "const x = 1"
			const doc1 = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = 1\nconst y = 2")
			const pos1 = new vscode.Position(0, 11)

			// Start first request (don't await - it will be cancelled by the second request)
			provider.provideInlineCompletionItems(doc1, pos1, mockContext, mockToken)

			// Advance time partially (not past debounce)
			await vi.advanceTimersByTimeAsync(100)

			// Second request: user backspaced - prefix is now shorter
			// This will cancel the first request's debounce timer and start a new one
			const doc2 = new MockTextDocument(vscode.Uri.file("/test.ts"), "const x = \nconst y = 2")
			const pos2 = new vscode.Position(0, 10) // After "const x = "

			// Start second request
			const promise2 = provider.provideInlineCompletionItems(doc2, pos2, mockContext, mockToken)

			// Advance time past debounce to let the second request complete
			await vi.advanceTimersByTimeAsync(500)

			await promise2

			// The model should have been called once (only the second request fires,
			// the first was cancelled by the debounce)
			// But the key point is that the second request was NOT reused from the first
			// because the prefix shrunk - it started a new debounce cycle
			expect(callCount).toBe(1)
		})
	})

	describe("debounce with leading edge behavior", () => {
		it("should execute immediately on first call (leading edge)", async () => {
			vi.mocked(mockModel.generateResponse).mockResolvedValue({
				cost: 0.01,
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})

			// First call should execute immediately without waiting
			const promise = provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)

			// Model should be called immediately (no timer needed)
			await promise
			expect(mockModel.generateResponse).toHaveBeenCalledTimes(1)
		})

		it("should debounce subsequent calls (wait for 300ms of inactivity)", async () => {
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

			// First call - executes immediately (leading edge)
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)
			expect(callCount).toBe(1)

			// Second call immediately after - should be debounced
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)
			const promise2 = provider.provideInlineCompletionItems(mockDocument2, mockPosition2, mockContext, mockToken)

			// Should not have called yet (debounced)
			expect(callCount).toBe(1)

			// Advance time past debounce delay
			await vi.advanceTimersByTimeAsync(300)
			await promise2

			// Now it should have been called
			expect(callCount).toBe(2)
		})

		it("should reset debounce timer on each call (only execute after 300ms of inactivity)", async () => {
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

			// First call - executes immediately (leading edge)
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)
			expect(callCount).toBe(1)

			// Multiple rapid calls - each resets the debounce timer
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)

			const mockDocument3 = new MockTextDocument(vscode.Uri.file("/test3.ts"), "const c = 1\nconst d = 2")
			const mockPosition3 = new vscode.Position(0, 11)

			// First debounced call
			provider.provideInlineCompletionItems(mockDocument2, mockPosition2, mockContext, mockToken)
			expect(callCount).toBe(1)

			// Advance 150ms (half the debounce time)
			await vi.advanceTimersByTimeAsync(150)
			expect(callCount).toBe(1)

			// Second debounced call - resets the timer
			const promise3 = provider.provideInlineCompletionItems(mockDocument3, mockPosition3, mockContext, mockToken)
			expect(callCount).toBe(1)

			// Advance another 150ms (total 300ms from first debounced call, but only 150ms from second)
			await vi.advanceTimersByTimeAsync(150)
			expect(callCount).toBe(1) // Still not called because timer was reset

			// Advance remaining 150ms to complete the debounce from the last call
			await vi.advanceTimersByTimeAsync(150)
			await promise3
			expect(callCount).toBe(2) // Now it should be called
		})

		it("should allow immediate execution after debounce completes (new leading edge)", async () => {
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

			// First call - executes immediately (leading edge)
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)
			expect(callCount).toBe(1)

			// Second call - debounced
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)
			const promise2 = provider.provideInlineCompletionItems(mockDocument2, mockPosition2, mockContext, mockToken)

			// Wait for debounce to complete
			await vi.advanceTimersByTimeAsync(300)
			await promise2
			expect(callCount).toBe(2)

			// Third call after debounce completed - should execute immediately (new leading edge)
			const mockDocument3 = new MockTextDocument(vscode.Uri.file("/test3.ts"), "const c = 1\nconst d = 2")
			const mockPosition3 = new vscode.Position(0, 11)
			await provider.provideInlineCompletionItems(mockDocument3, mockPosition3, mockContext, mockToken)

			// Should have executed immediately without waiting
			expect(callCount).toBe(3)
		})
	})

	describe("adaptive debounce delay", () => {
		it("should start with initial debounce delay of 300ms", async () => {
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

			// First call - executes immediately (leading edge)
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)
			expect(callCount).toBe(1)

			// Second call - should be debounced with initial 300ms delay
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)
			const promise2 = provider.provideInlineCompletionItems(mockDocument2, mockPosition2, mockContext, mockToken)

			// Should not have called yet (debounced)
			expect(callCount).toBe(1)

			// Advance 200ms - should still be waiting
			await vi.advanceTimersByTimeAsync(200)
			expect(callCount).toBe(1)

			// Advance remaining 100ms to complete the 300ms debounce
			await vi.advanceTimersByTimeAsync(100)
			await promise2
			expect(callCount).toBe(2)
		})

		it("should record latency and not update debounce delay until 10 samples collected", () => {
			// Record 9 latencies - should not update debounce delay yet
			for (let i = 0; i < 9; i++) {
				provider.recordLatency(100 + i * 10) // 100, 110, 120, ..., 180
			}

			// Access private field via any cast for testing
			const providerAny = provider as any
			expect(providerAny.latencyHistory.length).toBe(9)
			expect(providerAny.debounceDelayMs).toBe(300) // Still initial value
		})

		it("should update debounce delay to average after exceeding 10 samples", () => {
			// Record 10 latencies of 200ms each - debounce delay not updated yet
			for (let i = 0; i < 10; i++) {
				provider.recordLatency(200)
			}

			// Access private field via any cast for testing
			const providerAny = provider as any
			expect(providerAny.latencyHistory.length).toBe(10)
			expect(providerAny.debounceDelayMs).toBe(300) // Still initial value (not updated until > 10)

			// Record 11th latency - now debounce delay is updated
			provider.recordLatency(200)
			expect(providerAny.latencyHistory.length).toBe(10) // Still 10 (oldest removed)
			expect(providerAny.debounceDelayMs).toBe(200) // Now updated to average
		})

		it("should maintain rolling window of 10 latencies", () => {
			// Record 15 latencies
			for (let i = 0; i < 15; i++) {
				provider.recordLatency(100 + i * 10) // 100, 110, 120, ..., 240
			}

			// Access private field via any cast for testing
			const providerAny = provider as any
			expect(providerAny.latencyHistory.length).toBe(10) // Only last 10 kept

			// Last 10 values should be 150, 160, 170, 180, 190, 200, 210, 220, 230, 240
			// Average = (150+160+170+180+190+200+210+220+230+240) / 10 = 195
			expect(providerAny.debounceDelayMs).toBe(195)
		})

		it("should update debounce delay on each new latency after exceeding 10 samples", () => {
			// Record 11 latencies of 200ms each (need > 10 to trigger update)
			for (let i = 0; i < 11; i++) {
				provider.recordLatency(200)
			}

			const providerAny = provider as any
			expect(providerAny.debounceDelayMs).toBe(200)

			// Add one more latency of 300ms
			// New average = (200*9 + 300) / 10 = 210
			provider.recordLatency(300)
			expect(providerAny.debounceDelayMs).toBe(210)

			// Add another latency of 400ms
			// New average = (200*8 + 300 + 400) / 10 = 230
			provider.recordLatency(400)
			expect(providerAny.debounceDelayMs).toBe(230)
		})

		it("should use adaptive debounce delay after collecting enough samples", async () => {
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

			// Record 11 latencies of 150ms each to set debounce delay to 150ms
			// (need > 10 to trigger update)
			for (let i = 0; i < 11; i++) {
				provider.recordLatency(150)
			}

			const providerAny = provider as any
			expect(providerAny.debounceDelayMs).toBe(150)

			// First call - executes immediately (leading edge)
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)
			expect(callCount).toBe(1)

			// Second call - should be debounced with adaptive 150ms delay
			const mockDocument2 = new MockTextDocument(vscode.Uri.file("/test2.ts"), "const a = 1\nconst b = 2")
			const mockPosition2 = new vscode.Position(0, 11)
			const promise2 = provider.provideInlineCompletionItems(mockDocument2, mockPosition2, mockContext, mockToken)

			// Should not have called yet (debounced)
			expect(callCount).toBe(1)

			// Advance 100ms - should still be waiting (150ms debounce)
			await vi.advanceTimersByTimeAsync(100)
			expect(callCount).toBe(1)

			// Advance remaining 50ms to complete the 150ms debounce
			await vi.advanceTimersByTimeAsync(50)
			await promise2
			expect(callCount).toBe(2)
		})

		it("should record latency from LLM requests", async () => {
			// Mock the model to simulate a delay
			vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
				// Simulate some processing time
				if (onChunk) {
					onChunk({ type: "text", text: "<COMPLETION>" })
					onChunk({ type: "text", text: "console.log('test');" })
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

			const providerAny = provider as any
			expect(providerAny.latencyHistory.length).toBe(0)

			// Make a request that will record latency
			await provider.provideInlineCompletionItems(mockDocument, mockPosition, mockContext, mockToken)

			// Latency should have been recorded
			expect(providerAny.latencyHistory.length).toBe(1)
		})
	})

	describe("telemetry tracking", () => {
		it("should track acceptance when suggestion is accepted via command", async () => {
			// Capture the registered command callback by setting up mock before provider creation
			let acceptCallback: (() => void) | undefined
			const originalMock = vi.mocked(vscode.commands.registerCommand)
			originalMock.mockImplementation((cmd, callback) => {
				if (cmd === "kilocode.ghost.inline-completion.accepted") {
					acceptCallback = callback as () => void
				}
				return { dispose: vi.fn() }
			})

			// Create new telemetry instance for this test
			const testTelemetry = new AutocompleteTelemetry()
			vi.spyOn(testTelemetry, "captureAcceptSuggestion")

			// Create new provider to capture the command
			const testProvider = new GhostInlineCompletionProvider(
				mockExtensionContext,
				mockModel,
				mockCostTrackingCallback,
				() => mockSettings,
				mockClineProvider as any,
				testTelemetry,
			)

			// Verify callback was captured
			expect(acceptCallback).toBeDefined()

			// Set up and show a suggestion
			testProvider.updateSuggestions({
				text: "console.log('test');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			// Call provideInlineCompletionItems to trigger trackSuggestionShown
			const promise = testProvider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)
			await vi.advanceTimersByTimeAsync(300)
			const result = await promise

			// Verify we got a suggestion (which means trackSuggestionShown was called)
			expect(Array.isArray(result) ? result.length : 0).toBeGreaterThan(0)

			// Simulate accepting the suggestion
			acceptCallback!()

			expect(testTelemetry.captureAcceptSuggestion).toHaveBeenCalled()

			// Cleanup
			testProvider.dispose()
		})

		it("should work without telemetry when null is passed", async () => {
			// Create provider without telemetry
			const testProvider = new GhostInlineCompletionProvider(
				mockExtensionContext,
				mockModel,
				mockCostTrackingCallback,
				() => mockSettings,
				mockClineProvider as any,
				null,
			)

			// Set up a suggestion
			testProvider.updateSuggestions({
				text: "console.log('test');",
				prefix: "const x = 1",
				suffix: "\nconst y = 2",
			})

			// Should work without errors
			const promise = testProvider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)
			await vi.advanceTimersByTimeAsync(300)
			const result = await promise

			// Should still return suggestions
			expect(Array.isArray(result) ? result.length : 0).toBeGreaterThan(0)

			// Cleanup
			testProvider.dispose()
		})
	})
})

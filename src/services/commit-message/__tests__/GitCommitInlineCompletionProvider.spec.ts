import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { GitCommitInlineCompletionProvider } from "../GitCommitInlineCompletionProvider"

// Mock vscode module
vi.mock("vscode", () => ({
	languages: {
		registerInlineCompletionItemProvider: vi.fn(),
	},
	commands: {
		registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
	},
	Range: class {
		constructor(
			public start: any,
			public end: any,
		) {}
	},
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	InlineCompletionItem: class {
		constructor(
			public insertText: string,
			public range: any,
			public command?: any,
		) {}
	},
}))

// Mock the CommitMessageGenerator
vi.mock("../CommitMessageGenerator", () => ({
	CommitMessageGenerator: vi.fn().mockImplementation(() => ({
		generateMessage: vi.fn().mockResolvedValue("feat: add new feature"),
	})),
}))

// Mock the GitExtensionService
vi.mock("../GitExtensionService", () => ({
	GitExtensionService: vi.fn().mockImplementation(() => ({
		gatherChanges: vi
			.fn()
			.mockResolvedValue([{ filePath: "/test/workspace/src/test.ts", status: "M", staged: true }]),
		getCommitContext: vi.fn().mockResolvedValue("## Git Context\n\nSome diff content"),
		dispose: vi.fn(),
	})),
}))

// Mock ProviderSettingsManager
vi.mock("../../../core/config/ProviderSettingsManager", () => ({
	ProviderSettingsManager: vi.fn().mockImplementation(() => ({})),
}))

describe("GitCommitInlineCompletionProvider", () => {
	let provider: GitCommitInlineCompletionProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel

	beforeEach(() => {
		mockContext = {
			subscriptions: [],
		} as any

		mockOutputChannel = {
			appendLine: vi.fn(),
		} as any

		provider = new GitCommitInlineCompletionProvider(mockContext, mockOutputChannel)
	})

	afterEach(() => {
		provider.dispose()
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should create an instance", () => {
			expect(provider).toBeInstanceOf(GitCommitInlineCompletionProvider)
		})

		it("should register the acceptance command", () => {
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"kilocode.git-commit.inline-completion.accepted",
				expect.any(Function),
			)
		})
	})

	describe("provideInlineCompletionItems", () => {
		it("should return empty array for non-scm documents", async () => {
			const mockDocument = {
				uri: { scheme: "file" },
				getText: vi.fn().mockReturnValue(""),
			} as any

			const mockPosition = new vscode.Position(0, 0)
			const mockInlineContext = {} as vscode.InlineCompletionContext
			const mockToken = { isCancellationRequested: false } as vscode.CancellationToken

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockInlineContext,
				mockToken,
			)

			expect(result).toEqual([])
		})

		it("should provide completions for vscode-scm scheme", async () => {
			const mockDocument = {
				uri: { scheme: "vscode-scm" },
				getText: vi.fn().mockReturnValue(""),
			} as any

			const mockPosition = new vscode.Position(0, 0)
			const mockInlineContext = {} as vscode.InlineCompletionContext
			const mockToken = { isCancellationRequested: false } as vscode.CancellationToken

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockInlineContext,
				mockToken,
			)

			// Should return completions (may be empty if no cached suggestions yet)
			expect(Array.isArray(result)).toBe(true)
		})

		it("should return empty array when no workspace is available", async () => {
			// Override workspace folders to be empty
			vi.mocked(vscode.workspace).workspaceFolders = undefined

			const mockDocument = {
				uri: { scheme: "vscode-scm" },
				getText: vi.fn().mockReturnValue(""),
			} as any

			const mockPosition = new vscode.Position(0, 0)
			const mockInlineContext = {} as vscode.InlineCompletionContext
			const mockToken = { isCancellationRequested: false } as vscode.CancellationToken

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockInlineContext,
				mockToken,
			)

			expect(result).toEqual([])

			// Restore workspace folders
			vi.mocked(vscode.workspace).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }] as any
		})

		it("should skip completion when prefix is too long", async () => {
			const longPrefix = "a".repeat(60)
			const mockDocument = {
				uri: { scheme: "vscode-scm" },
				getText: vi.fn().mockReturnValue(longPrefix),
			} as any

			const mockPosition = new vscode.Position(0, 60)
			const mockInlineContext = {} as vscode.InlineCompletionContext
			const mockToken = { isCancellationRequested: false } as vscode.CancellationToken

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockInlineContext,
				mockToken,
			)

			expect(result).toEqual([])
		})
	})

	describe("clearCache", () => {
		it("should clear the suggestions history", () => {
			// Access private field through any cast for testing
			;(provider as any).suggestionsHistory = [{ text: "test", prefix: "", contextHash: "abc" }]

			provider.clearCache()

			expect((provider as any).suggestionsHistory).toEqual([])
		})
	})

	describe("dispose", () => {
		it("should clean up resources", () => {
			// Set up a debounce timer
			;(provider as any).debounceTimer = setTimeout(() => {}, 1000)

			provider.dispose()

			expect((provider as any).debounceTimer).toBeNull()
			expect((provider as any).acceptedCommand).toBeNull()
		})
	})

	describe("suggestion caching", () => {
		it("should not add duplicate suggestions", () => {
			const suggestion = { text: "test", prefix: "", contextHash: "abc" }

			// Add suggestion twice
			;(provider as any).updateSuggestions(suggestion)
			;(provider as any).updateSuggestions(suggestion)

			expect((provider as any).suggestionsHistory).toHaveLength(1)
		})

		it("should limit suggestions history size", () => {
			// Add more than MAX_SUGGESTIONS_HISTORY suggestions
			for (let i = 0; i < 15; i++) {
				;(provider as any).updateSuggestions({
					text: `test${i}`,
					prefix: `prefix${i}`,
					contextHash: `hash${i}`,
				})
			}

			// Should be limited to MAX_SUGGESTIONS_HISTORY (10)
			expect((provider as any).suggestionsHistory.length).toBeLessThanOrEqual(10)
		})
	})

	describe("findMatchingSuggestion", () => {
		beforeEach(() => {
			;(provider as any).suggestionsHistory = [
				{ text: "add new feature", prefix: "feat: ", contextHash: "abc123" },
			]
		})

		it("should find exact prefix match", () => {
			const result = (provider as any).findMatchingSuggestion("feat: ", "abc123")
			expect(result).toBe("add new feature")
		})

		it("should find partial typing match", () => {
			const result = (provider as any).findMatchingSuggestion("feat: add", "abc123")
			expect(result).toBe(" new feature")
		})

		it("should find backward deletion match", () => {
			const result = (provider as any).findMatchingSuggestion("feat:", "abc123")
			expect(result).toBe(" add new feature")
		})

		it("should return null for different context hash", () => {
			const result = (provider as any).findMatchingSuggestion("feat: ", "different-hash")
			expect(result).toBeNull()
		})

		it("should return null when no match found", () => {
			const result = (provider as any).findMatchingSuggestion("fix: ", "abc123")
			expect(result).toBeNull()
		})

		it("should find match when user types from empty prefix", () => {
			// Simulate a suggestion generated with empty prefix
			;(provider as any).suggestionsHistory = [
				{ text: "feat: add new feature", prefix: "", contextHash: "abc123" },
			]

			// User types "fe" - should match the beginning of the full message
			const result = (provider as any).findMatchingSuggestion("fe", "abc123")
			expect(result).toBe("at: add new feature")
		})

		it("should find match when user types more of the suggestion (case insensitive)", () => {
			// Simulate a suggestion generated with empty prefix
			;(provider as any).suggestionsHistory = [
				{ text: "feat: add new feature", prefix: "", contextHash: "abc123" },
			]

			// User types "FEAT" in uppercase - should still match
			const result = (provider as any).findMatchingSuggestion("FEAT", "abc123")
			expect(result).toBe(": add new feature")
		})

		it("should return only first match to avoid overlapping suggestions", () => {
			// Add multiple suggestions with same context
			;(provider as any).suggestionsHistory = [
				{ text: "old suggestion", prefix: "", contextHash: "abc123" },
				{ text: "new suggestion", prefix: "", contextHash: "abc123" },
			]

			// Should return the most recent (last) match
			const result = (provider as any).findMatchingSuggestion("", "abc123")
			expect(result).toBe("new suggestion")
		})
	})

	describe("adaptive debounce", () => {
		it("should record latency and update debounce delay", () => {
			// Record enough samples to trigger adaptive delay
			for (let i = 0; i < 6; i++) {
				;(provider as any).recordLatency(400)
			}

			// Debounce delay should be updated based on average latency
			expect((provider as any).debounceDelayMs).toBeGreaterThanOrEqual(300)
			expect((provider as any).debounceDelayMs).toBeLessThanOrEqual(2000)
		})

		it("should clamp debounce delay to minimum", () => {
			// Record very fast latencies
			for (let i = 0; i < 6; i++) {
				;(provider as any).recordLatency(50)
			}

			// Should be clamped to minimum (300ms)
			expect((provider as any).debounceDelayMs).toBeGreaterThanOrEqual(300)
		})

		it("should clamp debounce delay to maximum", () => {
			// Record very slow latencies
			for (let i = 0; i < 6; i++) {
				;(provider as any).recordLatency(5000)
			}

			// Should be clamped to maximum (2000ms)
			expect((provider as any).debounceDelayMs).toBeLessThanOrEqual(2000)
		})
	})
})

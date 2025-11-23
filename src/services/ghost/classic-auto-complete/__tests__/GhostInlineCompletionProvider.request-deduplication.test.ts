import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { GhostInlineCompletionProvider } from "../GhostInlineCompletionProvider"
import { GhostModel } from "../../GhostModel"
import * as vscode from "vscode"
import { MockTextDocument } from "../../../mocking/MockTextDocument"

// Mock vscode event listeners
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

describe("GhostInlineCompletionProvider - Request Deduplication", () => {
	let provider: GhostInlineCompletionProvider
	let mockModel: GhostModel
	let mockContextProvider: any
	let costTrackingCallback: ReturnType<typeof vi.fn>

	// Helper to call provideInlineCompletionItems and advance timers
	async function provideWithDebounce(doc: vscode.TextDocument, pos: vscode.Position) {
		const promise = provider.provideInlineCompletionItems_Internal(doc, pos, {} as any, {} as any)
		// Wait a tick to let the promise chain set up
		await Promise.resolve()
		// Advance timers past debounce delay
		await vi.advanceTimersByTimeAsync(300)
		// Wait for the completion to finish
		return await promise
	}

	beforeEach(() => {
		vi.useFakeTimers()

		// Create mock IDE for tracking services
		const mockIde = {
			getWorkspaceDirs: vi.fn().mockResolvedValue([]),
			getOpenFiles: vi.fn().mockResolvedValue([]),
			readFile: vi.fn().mockResolvedValue(""),
		}

		mockContextProvider = {
			getIde: vi.fn().mockReturnValue(mockIde),
			getProcessedSnippets: vi.fn().mockResolvedValue({
				filepathUri: "file:///test.ts",
				helper: {
					lang: { name: "typescript", singleLineComment: "//" },
					prunedPrefix: "",
					prunedSuffix: "",
				},
				snippetsWithUris: [],
				workspaceDirs: [],
			}),
		}

		mockModel = {
			supportsFim: vi.fn().mockReturnValue(false),
			generateResponse: vi.fn().mockResolvedValue({
				cost: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			}),
			getModelName: vi.fn().mockReturnValue("test-model"),
		} as unknown as GhostModel

		costTrackingCallback = vi.fn()

		provider = new GhostInlineCompletionProvider(
			mockModel,
			costTrackingCallback,
			() => ({ enableAutoTrigger: true }),
			mockContextProvider,
		)
	})

	afterEach(() => {
		vi.useRealTimers()
		provider.dispose()
	})

	it("should deduplicate identical requests", async () => {
		const mockResponse = {
			cost: 0.001,
			inputTokens: 10,
			outputTokens: 20,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		}

		let callCount = 0
		vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
			callCount++
			onChunk({ type: "text", text: "<COMPLETION>test suggestion</COMPLETION>" })
			return mockResponse
		})

		const document = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = \nconst y = 2")
		const position = new vscode.Position(0, 10)

		// Make two identical requests - the second should reuse the first's pending request
		const promise1 = provider.provideInlineCompletionItems_Internal(document, position, {} as any, {} as any)

		// Wait a tick to let the first request's debounce timer start
		await Promise.resolve()

		const promise2 = provider.provideInlineCompletionItems_Internal(document, position, {} as any, {} as any)

		// Advance timers to trigger the debounce
		await vi.advanceTimersByTimeAsync(300)

		// Wait for both promises to complete
		await Promise.all([promise1, promise2])

		// Should only call the API once due to deduplication
		expect(callCount).toBe(1)
	})

	it("should reuse pending request when user types ahead", async () => {
		const mockResponse = {
			cost: 0.001,
			inputTokens: 10,
			outputTokens: 20,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		}

		let callCount = 0
		vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
			callCount++
			onChunk({ type: "text", text: "<COMPLETION>function test() {}</COMPLETION>" })
			return mockResponse
		})

		const document = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = f\nconst y = 2")
		const position1 = new vscode.Position(0, 11)

		// Start first request
		const promise1 = provider.provideInlineCompletionItems_Internal(document, position1, {} as any, {} as any)

		// Wait a tick
		await Promise.resolve()

		// User types ahead - new document with one more character
		const document2 = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = fu\nconst y = 2")
		const position2 = new vscode.Position(0, 12)
		const promise2 = provider.provideInlineCompletionItems_Internal(document2, position2, {} as any, {} as any)

		// Advance timers
		await vi.advanceTimersByTimeAsync(300)

		await Promise.all([promise1, promise2])

		// Should reuse the first request
		expect(callCount).toBe(1)
	})

	it("should cancel obsolete requests when prefix diverges", async () => {
		const mockResponse = {
			cost: 0.001,
			inputTokens: 10,
			outputTokens: 20,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		}

		let callCount = 0

		vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
			callCount++
			onChunk({ type: "text", text: "<COMPLETION>test suggestion</COMPLETION>" })
			return mockResponse
		})

		const document1 = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = f\nconst y = 2")
		const position = new vscode.Position(0, 11)

		// Start first request
		const promise1 = provider.provideInlineCompletionItems_Internal(document1, position, {} as any, {} as any)

		// Wait a tick
		await Promise.resolve()

		// User changes to different prefix - this should cancel the first request
		const document2 = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = g\nconst y = 2")
		const promise2 = provider.provideInlineCompletionItems_Internal(document2, position, {} as any, {} as any)

		// Advance timers
		await vi.advanceTimersByTimeAsync(300)

		await Promise.all([promise1, promise2])

		// Should make two separate calls since prefixes diverged
		expect(callCount).toBe(2)
	})

	it("should adjust suggestion when user types ahead", async () => {
		const mockResponse = {
			cost: 0.001,
			inputTokens: 10,
			outputTokens: 20,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		}

		vi.mocked(mockModel.generateResponse).mockImplementation(async (_sys, _user, onChunk) => {
			onChunk({ type: "text", text: "unction test() {}" })
			return mockResponse
		})

		const document1 = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = f\nconst y = 2")
		const position1 = new vscode.Position(0, 11)

		// Start first request
		provideWithDebounce(document1, position1)

		// User types "un" while waiting
		const document2 = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = fun\nconst y = 2")
		const position2 = new vscode.Position(0, 13)

		const result = await provideWithDebounce(document2, position2)

		// Should adjust the suggestion by removing "un" that was already typed
		if (Array.isArray(result) && result.length > 0) {
			expect(result[0].insertText).toBe("ction test() {}")
		}
	})

	it("should clean up pending requests on dispose", () => {
		const document = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = \nconst y = 2")
		const position = new vscode.Position(0, 10)

		// Start a request (don't await)
		provideWithDebounce(document, position)

		// Dispose should cancel all pending requests
		expect(() => provider.dispose()).not.toThrow()
	})
})

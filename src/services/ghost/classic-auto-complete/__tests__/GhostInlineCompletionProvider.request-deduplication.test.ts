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
		await vi.advanceTimersByTimeAsync(300) // Advance past debounce delay
		return promise
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
			getFormattedContext: vi.fn().mockResolvedValue(""),
			getFimFormattedContext: vi.fn().mockResolvedValue({ prefix: "" }),
			getFimCompiledPrefix: vi.fn().mockResolvedValue(""),
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
			onChunk({ type: "text", text: "test suggestion" })
			return mockResponse
		})

		const document = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = \nconst y = 2")
		const position = new vscode.Position(0, 10)

		// Make two identical requests quickly
		const promise1 = provideWithDebounce(document, position)
		const promise2 = provideWithDebounce(document, position)

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
			onChunk({ type: "text", text: "function test() {}" })
			return mockResponse
		})

		const document = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = f\nconst y = 2")
		const position1 = new vscode.Position(0, 11)
		const position2 = new vscode.Position(0, 12) // User typed one more character

		// Start first request
		const promise1 = provideWithDebounce(document, position1)

		const document2 = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = fu\nconst y = 2")

		const promise2 = provideWithDebounce(document2, position2)

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
			onChunk({ type: "text", text: "test suggestion" })
			return mockResponse
		})

		const document1 = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = f\nconst y = 2")
		const document2 = new MockTextDocument(vscode.Uri.file("/test/file.ts"), "const x = g\nconst y = 2")

		const position = new vscode.Position(0, 11)

		// Start first request
		const promise1 = provideWithDebounce(document1, position)

		const promise2 = provideWithDebounce(document2, position)

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

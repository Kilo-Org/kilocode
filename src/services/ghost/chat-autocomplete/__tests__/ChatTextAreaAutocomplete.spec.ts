import { ChatTextAreaAutocomplete } from "../ChatTextAreaAutocomplete"
import { GhostInlineCompletionProvider } from "../../classic-auto-complete/GhostInlineCompletionProvider"
import * as vscode from "vscode"

// Mock vscode module
vi.mock("vscode", () => ({
	Uri: {
		parse: vi.fn((str: string) => ({ toString: () => str, fsPath: str })),
	},
	workspace: {
		openTextDocument: vi.fn(),
	},
	Position: vi.fn((line: number, char: number) => ({ line, character: char })),
	InlineCompletionTriggerKind: {
		Invoke: 0,
		Automatic: 1,
	},
	CancellationTokenSource: vi.fn(() => ({
		token: { isCancellationRequested: false },
		cancel: vi.fn(),
		dispose: vi.fn(),
	})),
}))

describe("ChatTextAreaAutocomplete", () => {
	let autocomplete: ChatTextAreaAutocomplete
	let mockInlineCompletionProvider: GhostInlineCompletionProvider
	let mockDocument: any

	beforeEach(() => {
		// Create a mock document
		mockDocument = {
			uri: { toString: () => "untitled:test", fsPath: "untitled:test" },
			getText: vi.fn().mockReturnValue(""),
			lineCount: 1,
			positionAt: vi.fn((offset: number) => ({ line: 0, character: offset })),
		}

		// Mock vscode.workspace.openTextDocument
		vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(mockDocument)

		// Create a mock inline completion provider with minimal required properties
		mockInlineCompletionProvider = {
			provideInlineCompletionItems_Internal: vi.fn(),
		} as any as GhostInlineCompletionProvider

		autocomplete = new ChatTextAreaAutocomplete(mockInlineCompletionProvider)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("getCompletion", () => {
		it("should use the inline completion provider to get suggestions", async () => {
			// Mock the inline completion provider to return a suggestion
			const mockCompletions = [
				{
					insertText: "write a function",
					range: {} as any,
				},
			]

			vi.mocked(mockInlineCompletionProvider.provideInlineCompletionItems_Internal).mockResolvedValue(
				mockCompletions as any,
			)

			const result = await autocomplete.getCompletion("How to ")

			expect(mockInlineCompletionProvider.provideInlineCompletionItems_Internal).toHaveBeenCalled()
			expect(result.suggestion).toBe("write a function")
		})

		it("should return empty suggestion when no completions are available", async () => {
			vi.mocked(mockInlineCompletionProvider.provideInlineCompletionItems_Internal).mockResolvedValue([])

			const result = await autocomplete.getCompletion("How to ")

			expect(result.suggestion).toBe("")
		})
	})

	describe("isFimAvailable", () => {
		it("should check if model has valid credentials", () => {
			// Mock the model property on the provider
			const mockModel = {
				hasValidCredentials: vi.fn().mockReturnValue(true),
			}
			;(mockInlineCompletionProvider as any).model = mockModel

			const result = autocomplete.isFimAvailable()

			expect(result).toBe(true)
			expect(mockModel.hasValidCredentials).toHaveBeenCalled()
		})

		it("should return false when model has no valid credentials", () => {
			const mockModel = {
				hasValidCredentials: vi.fn().mockReturnValue(false),
			}
			;(mockInlineCompletionProvider as any).model = mockModel

			const result = autocomplete.isFimAvailable()
			expect(result).toBe(false)
		})
	})
})

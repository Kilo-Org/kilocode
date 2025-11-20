import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest"
import * as vscode from "vscode"
import { GhostInlineCompletionProvider } from "../GhostInlineCompletionProvider"
import { GhostModel } from "../../GhostModel"
import { GhostContextProvider } from "../GhostContextProvider"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

// Mock vscode
vi.mock("vscode", () => ({
	Range: vi.fn().mockImplementation((start, end) => ({ start, end })),
	Position: vi.fn().mockImplementation((line, character) => ({ line, character })),
	InlineCompletionList: vi.fn().mockImplementation((items) => ({ items })),
	InlineCompletionTriggerKind: {
		Invoke: 0,
		Automatic: 1,
	},
	commands: {
		registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	},
	Disposable: vi.fn().mockImplementation(() => ({
		dispose: vi.fn(),
	})),
	window: {
		onDidChangeTextEditorSelection: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		activeTextEditor: undefined,
	},
	workspace: {
		onDidChangeTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	},
}))

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock other dependencies
vi.mock("../GhostContextProvider")
vi.mock("../../GhostModel")
vi.mock("../HoleFiller", () => ({
	HoleFiller: vi.fn().mockImplementation(() => ({
		getPrompts: vi.fn().mockResolvedValue({
			systemPrompt: "system",
			userPrompt: "user",
		}),
	})),
	parseGhostResponse: vi.fn((response) => {
		const match = response.match(/<<<SUGGESTION>>>\n(.*?)\n<<<END_SUGGESTION>>>/s)
		return match ? { text: match[1] } : { text: "" }
	}),
}))
vi.mock("../../continuedev/core/vscode-test-harness/src/autocomplete/RecentlyVisitedRangesService", () => ({
	RecentlyVisitedRangesService: vi.fn().mockImplementation(() => ({
		getSnippets: vi.fn().mockReturnValue([]),
		dispose: vi.fn(),
	})),
}))
vi.mock("../../continuedev/core/vscode-test-harness/src/autocomplete/recentlyEdited", () => ({
	RecentlyEditedTracker: vi.fn().mockImplementation(() => ({
		getRecentlyEditedRanges: vi.fn().mockResolvedValue([]),
		dispose: vi.fn(),
	})),
}))
vi.mock("../uselessSuggestionFilter", () => ({
	postprocessGhostSuggestion: vi.fn((opts) => opts.suggestion),
}))
vi.mock("../../continuedev/core/autocomplete/templating/AutocompleteTemplate", () => ({
	getTemplateForModel: vi.fn().mockReturnValue({}),
}))

describe("GhostInlineCompletionProvider Telemetry", () => {
	let provider: GhostInlineCompletionProvider
	let mockModel: GhostModel
	let mockContextProvider: GhostContextProvider
	let mockCostTrackingCallback: Mock
	let mockGetSettings: Mock
	let mockRegisteredCommand: Mock

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock model
		mockModel = {
			loaded: true,
			getModelName: vi.fn().mockReturnValue("test-model"),
			getProviderDisplayName: vi.fn().mockReturnValue("test-provider"),
			hasValidCredentials: vi.fn().mockReturnValue(true),
			supportsFim: vi.fn().mockReturnValue(false),
			generateResponse: vi.fn(),
		} as any

		// Setup mock context provider
		mockContextProvider = {
			getIde: vi.fn().mockReturnValue({
				getWorkspaceDirectories: vi.fn().mockReturnValue([]),
				listWorkspaceContents: vi.fn().mockResolvedValue([]),
				readFile: vi.fn(),
				readRangeInFile: vi.fn(),
				getOpenFiles: vi.fn().mockReturnValue([]),
				getCurrentFile: vi.fn(),
				getVisibleFiles: vi.fn().mockReturnValue([]),
			}),
		} as any

		mockCostTrackingCallback = vi.fn()
		mockGetSettings = vi.fn().mockReturnValue({ enableAutoTrigger: true })

		// Capture the registered command
		mockRegisteredCommand = vi.fn()
		const registerCommand = vi.mocked(vscode.commands.registerCommand)
		registerCommand.mockImplementation((command: string, callback: (...args: any[]) => any) => {
			if (command === "kilocode.ghost.inlineAssist.accepted") {
				mockRegisteredCommand.mockImplementation(callback)
			}
			return { dispose: vi.fn() } as any
		})

		provider = new GhostInlineCompletionProvider(
			mockModel,
			mockCostTrackingCallback,
			mockGetSettings,
			mockContextProvider,
		)
	})

	afterEach(() => {
		provider.dispose()
	})

	describe("Suggestion Acceptance", () => {
		it("should send INLINE_ASSIST_ACCEPT_SUGGESTION event when suggestion is accepted", async () => {
			const document = {
				getText: vi.fn().mockReturnValue("const test = "),
				languageId: "typescript",
				lineAt: vi.fn().mockReturnValue({ text: "const test = " }),
				lineCount: 10,
				isUntitled: false,
				fileName: "test.ts",
				offsetAt: vi.fn().mockReturnValue(13),
				uri: { fsPath: "/test/test.ts" },
			} as any

			const position = { line: 0, character: 13 } as any

			// Mock the LLM to return a suggestion
			mockModel.generateResponse = vi.fn().mockImplementation(async (system, user, onChunk) => {
				onChunk({ type: "text", text: "<<<SUGGESTION>>>\n'hello world'\n<<<END_SUGGESTION>>>" })
				return {
					cost: 0.001,
					inputTokens: 100,
					outputTokens: 10,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			const context = {
				triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
				selectedCompletionInfo: undefined,
			}
			const token = { isCancellationRequested: false } as any

			// Get completions
			const result = await provider.provideInlineCompletionItems(document, position, context, token)

			// Verify a completion was returned
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items).toHaveLength(1)
			expect(items[0].insertText).toBe("'hello world'")

			// Simulate accepting the suggestion by executing the command
			mockRegisteredCommand()

			// Verify telemetry was sent
			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.INLINE_ASSIST_ACCEPT_SUGGESTION,
			)
		})
	})

	describe("Suggestion Rejection", () => {
		it("should send INLINE_ASSIST_REJECT_SUGGESTION event when no suggestion is shown", async () => {
			const document = {
				getText: vi.fn().mockReturnValue(""),
				languageId: "typescript",
				lineAt: vi.fn().mockReturnValue({ text: "" }),
				lineCount: 1,
				isUntitled: false,
				fileName: "test.ts",
				offsetAt: vi.fn().mockReturnValue(0),
				uri: { fsPath: "/test/test.ts" },
			} as any

			const position = { line: 0, character: 0 } as any

			// Mock the LLM to return no suggestion
			mockModel.generateResponse = vi.fn().mockImplementation(async (system, user, onChunk) => {
				// Return empty response
				return {
					cost: 0,
					inputTokens: 100,
					outputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			const context = {
				triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
				selectedCompletionInfo: undefined,
			}
			const token = { isCancellationRequested: false } as any

			// Get completions
			const result = await provider.provideInlineCompletionItems(document, position, context, token)

			// Wait for debounce and async rejection tracking
			await new Promise((resolve) => setTimeout(resolve, 400))

			// Verify no completions were returned
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items).toHaveLength(0)

			// Verify rejection telemetry was sent
			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.INLINE_ASSIST_REJECT_SUGGESTION,
			)
		})

		it("should send INLINE_ASSIST_REJECT_SUGGESTION event after timeout if suggestion not accepted", async () => {
			vi.useFakeTimers()

			const document = {
				getText: vi.fn().mockReturnValue("const test = "),
				languageId: "typescript",
				lineAt: vi.fn().mockReturnValue({ text: "const test = " }),
				lineCount: 10,
				isUntitled: false,
				fileName: "test.ts",
				offsetAt: vi.fn().mockReturnValue(13),
				uri: { fsPath: "/test/test.ts" },
			} as any

			const position = { line: 0, character: 13 } as any

			// Mock the LLM to return a suggestion
			mockModel.generateResponse = vi.fn().mockImplementation(async (system, user, onChunk) => {
				onChunk({ type: "text", text: "<<<SUGGESTION>>>\n'hello world'\n<<<END_SUGGESTION>>>" })
				return {
					cost: 0.001,
					inputTokens: 100,
					outputTokens: 10,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			const context = {
				triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
				selectedCompletionInfo: undefined,
			}
			const token = { isCancellationRequested: false } as any

			// Get completions
			const resultPromise = provider.provideInlineCompletionItems(document, position, context, token)

			// Wait for debounce
			await vi.advanceTimersByTimeAsync(350)

			const result = await resultPromise

			// Verify a completion was returned
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items).toHaveLength(1)

			// Clear previous calls
			vi.mocked(TelemetryService.instance.captureEvent).mockClear()

			// Advance time by 10 seconds to trigger rejection timeout
			await vi.advanceTimersByTimeAsync(10000)

			// Verify rejection telemetry was sent
			expect(TelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.INLINE_ASSIST_REJECT_SUGGESTION,
			)

			vi.useRealTimers()
		})
	})

	describe("Settings", () => {
		it("should not provide completions when enableAutoTrigger is false", async () => {
			mockGetSettings.mockReturnValue({ enableAutoTrigger: false })

			const document = {
				getText: vi.fn().mockReturnValue("const test = "),
				languageId: "typescript",
				lineAt: vi.fn().mockReturnValue({ text: "const test = " }),
				lineCount: 10,
				isUntitled: false,
				fileName: "test.ts",
				offsetAt: vi.fn().mockReturnValue(13),
				uri: { fsPath: "/test/test.ts" },
			} as any

			const position = { line: 0, character: 13 } as any
			const context = {
				triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
				selectedCompletionInfo: undefined,
			}
			const token = { isCancellationRequested: false } as any

			const result = await provider.provideInlineCompletionItems(document, position, context, token)

			// Should return empty array when auto-trigger is disabled
			expect(result).toEqual([])

			// No telemetry should be sent
			expect(TelemetryService.instance.captureEvent).not.toHaveBeenCalled()
		})
	})
})

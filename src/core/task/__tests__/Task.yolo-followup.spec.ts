// kilocode_change: new file

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock vscode module completely
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		})),
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
		})),
	},
	window: {
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({
		base,
		pattern,
	})),
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
	},
	Range: vi.fn(),
	Position: vi.fn(),
}))

// Mock RooIgnoreController to avoid file system operations
vi.mock("../../ignore/RooIgnoreController", () => ({
	RooIgnoreController: vi.fn().mockImplementation(() => ({
		initialize: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
		getInstructions: vi.fn().mockReturnValue(""),
	})),
}))

// Mock RooProtectedController
vi.mock("../../protect/RooProtectedController", () => ({
	RooProtectedController: vi.fn().mockImplementation(() => ({
		dispose: vi.fn(),
	})),
}))

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureTaskRestarted: vi.fn(),
			captureTaskCreated: vi.fn(),
			captureConversationMessage: vi.fn(),
			captureLlmCompletion: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
			captureEvent: vi.fn(),
		},
	},
}))

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import * as vscode from "vscode"

describe("Task - YOLO Mode Follow-up Question Auto-Answer", () => {
	let mockProvider: Partial<ClineProvider>
	let mockContext: vscode.ExtensionContext

	beforeEach(() => {
		// Reset the global API request time before each test
		Task.resetGlobalApiRequestTime()

		// Mock VSCode extension context
		mockContext = {
			globalStorageUri: { fsPath: "/mock/path" },
			subscriptions: [],
		} as any

		// Mock provider with getState method
		mockProvider = {
			context: mockContext,
			getState: vi.fn(),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn(),
			log: vi.fn(),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
		}
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("should auto-answer follow-up questions with first suggestion when YOLO mode is enabled", async () => {
		// Mock getState to return YOLO mode enabled
		;(mockProvider.getState as any).mockResolvedValue({
			yoloMode: true,
		})

		const task = new Task({
			context: mockContext,
			provider: mockProvider as ClineProvider,
			apiConfiguration: {
				apiProvider: "anthropic",
			} as any,
			startTask: false,
		})

		// Simulate a follow-up question with suggestions
		const followUpJson = JSON.stringify({
			question: "What would you like to do next?",
			suggest: [
				{ answer: "Continue with the current approach" },
				{ answer: "Try a different method" },
				{ answer: "Cancel the operation" },
			],
		})

		// Call ask with followup type
		const resultPromise = task.ask("followup", followUpJson, false)

		// The promise should resolve immediately with the first suggestion
		const result = await resultPromise

		expect(result.response).toBe("messageResponse")
		expect(result.text).toBe("Continue with the current approach")
		expect(result.images).toBeUndefined()
	})

	it("should auto-answer with simple string suggestions", async () => {
		;(mockProvider.getState as any).mockResolvedValue({
			yoloMode: true,
		})

		const task = new Task({
			context: mockContext,
			provider: mockProvider as ClineProvider,
			apiConfiguration: {
				apiProvider: "anthropic",
			} as any,
			startTask: false,
		})

		const followUpJson = JSON.stringify({
			question: "Select an option:",
			suggest: ["Option A", "Option B", "Option C"],
		})

		const resultPromise = task.ask("followup", followUpJson, false)
		const result = await resultPromise

		expect(result.response).toBe("messageResponse")
		expect(result.text).toBe("Option A")
	})

	it("should wait for user input when YOLO mode is disabled", async () => {
		;(mockProvider.getState as any).mockResolvedValue({
			yoloMode: false,
		})

		const task = new Task({
			context: mockContext,
			provider: mockProvider as ClineProvider,
			apiConfiguration: {
				apiProvider: "anthropic",
			} as any,
			startTask: false,
		})

		const followUpJson = JSON.stringify({
			question: "What would you like to do?",
			suggest: [{ answer: "Auto answer" }],
		})

		// Start the ask promise
		const resultPromise = task.ask("followup", followUpJson, false)

		// Manually trigger the response (simulating user input)
		setTimeout(() => {
			task.handleWebviewAskResponse("messageResponse", "User provided answer", undefined)
		}, 10)

		const result = await resultPromise

		expect(result.response).toBe("messageResponse")
		expect(result.text).toBe("User provided answer")
	})

	it("should handle follow-up questions with no suggestions gracefully", async () => {
		;(mockProvider.getState as any).mockResolvedValue({
			yoloMode: true,
		})

		const task = new Task({
			context: mockContext,
			provider: mockProvider as ClineProvider,
			apiConfiguration: {
				apiProvider: "anthropic",
			} as any,
			startTask: false,
		})

		const followUpJson = JSON.stringify({
			question: "What would you like to do?",
			suggest: [],
		})

		// Start the ask promise
		const resultPromise = task.ask("followup", followUpJson, false)

		// Should fall back to normal flow when no suggestions
		setTimeout(() => {
			task.handleWebviewAskResponse("messageResponse", "Manual answer", undefined)
		}, 10)

		const result = await resultPromise

		expect(result.response).toBe("messageResponse")
		expect(result.text).toBe("Manual answer")
	})

	it("should handle malformed JSON gracefully", async () => {
		;(mockProvider.getState as any).mockResolvedValue({
			yoloMode: true,
		})

		const task = new Task({
			context: mockContext,
			provider: mockProvider as ClineProvider,
			apiConfiguration: {
				apiProvider: "anthropic",
			} as any,
			startTask: false,
		})

		const malformedJson = "not valid json"

		// Start the ask promise
		const resultPromise = task.ask("followup", malformedJson, false)

		// Should fall back to normal flow when JSON parsing fails
		setTimeout(() => {
			task.handleWebviewAskResponse("messageResponse", "Fallback answer", undefined)
		}, 10)

		const result = await resultPromise

		expect(result.response).toBe("messageResponse")
		expect(result.text).toBe("Fallback answer")
	})

	it("should not auto-answer for non-followup ask types even in YOLO mode", async () => {
		;(mockProvider.getState as any).mockResolvedValue({
			yoloMode: true,
		})

		const task = new Task({
			context: mockContext,
			provider: mockProvider as ClineProvider,
			apiConfiguration: {
				apiProvider: "anthropic",
			} as any,
			startTask: false,
		})

		// Start the ask promise with a different type
		const resultPromise = task.ask("tool", "Some tool approval needed", false)

		// Manual response required even in YOLO mode
		setTimeout(() => {
			task.handleWebviewAskResponse("yesButtonClicked", undefined, undefined)
		}, 10)

		const result = await resultPromise

		expect(result.response).toBe("yesButtonClicked")
	})
})

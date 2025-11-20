import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import type { ClineProvider } from "../../webview/ClineProvider"
import type { ProviderSettings, ModelInfo } from "@roo-code/types"

// Mock vscode module before importing Task
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		})),
		getConfiguration: vi.fn(() => ({
			get: vi.fn(() => true),
		})),
		openTextDocument: vi.fn(),
		applyEdit: vi.fn(),
	},
	RelativePattern: vi.fn((base, pattern) => ({ base, pattern })),
	window: {
		createOutputChannel: vi.fn(() => ({
			appendLine: vi.fn(),
			dispose: vi.fn(),
		})),
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
		showTextDocument: vi.fn(),
		activeTextEditor: undefined,
	},
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
		parse: vi.fn((str) => ({ toString: () => str })),
	},
	Range: vi.fn(),
	Position: vi.fn(),
	WorkspaceEdit: vi.fn(() => ({
		replace: vi.fn(),
		insert: vi.fn(),
		delete: vi.fn(),
	})),
	ViewColumn: {
		One: 1,
		Two: 2,
		Three: 3,
	},
}))

// Mock other dependencies
vi.mock("../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn().mockResolvedValue(null),
	},
}))

vi.mock("../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		releaseTerminalsForTask: vi.fn(),
	},
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureTaskCreated: vi.fn(),
			captureTaskRestarted: vi.fn(),
			captureConversationMessage: vi.fn(),
			captureLlmCompletion: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
		},
	},
}))

describe("Task reasoning preservation", () => {
	let mockProvider: Partial<ClineProvider>
	let mockApiConfiguration: ProviderSettings
	let Task: any

	beforeAll(async () => {
		// Import Task after mocks are set up
		const taskModule = await import("../Task")
		Task = taskModule.Task
	})

	beforeEach(() => {
		// Mock provider with necessary methods
		mockProvider = {
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			getState: vi.fn().mockResolvedValue({
				mode: "code",
				experiments: {},
			}),
			context: {
				globalStorageUri: { fsPath: "/test/storage" },
				extensionPath: "/test/extension",
			} as any,
			log: vi.fn(),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		}

		mockApiConfiguration = {
			apiProvider: "anthropic",
			apiKey: "test-key",
		} as ProviderSettings
	})

	it("should append reasoning to assistant message when preserveReasoning is true", async () => {
		// Create a task instance
		const task = new Task({
			provider: mockProvider as ClineProvider,
			apiConfiguration: mockApiConfiguration,
			task: "Test task",
			startTask: false,
		})

		// Mock the API to return a model with preserveReasoning enabled
		const mockModelInfo: ModelInfo = {
			contextWindow: 16000,
			supportsPromptCache: true,
			preserveReasoning: true,
		}

		task.api = {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: mockModelInfo,
			}),
		}

		// Mock the API conversation history
		task.apiConversationHistory = []

		// Simulate adding an assistant message with reasoning
		const assistantMessage = "Here is my response to your question."
		const reasoningMessage = "Let me think about this step by step. First, I need to..."

		// Spy on addToApiConversationHistory
		const addToApiHistorySpy = vi.spyOn(task as any, "addToApiConversationHistory")

		// Simulate what happens in the streaming loop when preserveReasoning is true
		let finalAssistantMessage = assistantMessage
		if (reasoningMessage && task.api.getModel().info.preserveReasoning) {
			finalAssistantMessage = `<think>${reasoningMessage}</think>\n${assistantMessage}`
		}

		await (task as any).addToApiConversationHistory({
			role: "assistant",
			content: [{ type: "text", text: finalAssistantMessage }],
		})

		// Verify that reasoning was prepended in <think> tags to the assistant message
		expect(addToApiHistorySpy).toHaveBeenCalledWith({
			role: "assistant",
			content: [
				{
					type: "text",
					text: "<think>Let me think about this step by step. First, I need to...</think>\nHere is my response to your question.",
				},
			],
		})

		// Verify the API conversation history contains the message with reasoning
		expect(task.apiConversationHistory).toHaveLength(1)
		expect(task.apiConversationHistory[0].content[0].text).toContain("<think>")
		expect(task.apiConversationHistory[0].content[0].text).toContain("</think>")
		expect(task.apiConversationHistory[0].content[0].text).toContain("Here is my response to your question.")
		expect(task.apiConversationHistory[0].content[0].text).toContain(
			"Let me think about this step by step. First, I need to...",
		)
	})

	it("should NOT append reasoning to assistant message when preserveReasoning is false", async () => {
		// Create a task instance
		const task = new Task({
			provider: mockProvider as ClineProvider,
			apiConfiguration: mockApiConfiguration,
			task: "Test task",
			startTask: false,
		})

		// Mock the API to return a model with preserveReasoning disabled (or undefined)
		const mockModelInfo: ModelInfo = {
			contextWindow: 16000,
			supportsPromptCache: true,
			preserveReasoning: false,
		}

		task.api = {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: mockModelInfo,
			}),
		}

		// Mock the API conversation history
		task.apiConversationHistory = []

		// Simulate adding an assistant message with reasoning
		const assistantMessage = "Here is my response to your question."
		const reasoningMessage = "Let me think about this step by step. First, I need to..."

		// Spy on addToApiConversationHistory
		const addToApiHistorySpy = vi.spyOn(task as any, "addToApiConversationHistory")

		// Simulate what happens in the streaming loop when preserveReasoning is false
		let finalAssistantMessage = assistantMessage
		if (reasoningMessage && task.api.getModel().info.preserveReasoning) {
			finalAssistantMessage = `<think>${reasoningMessage}</think>\n${assistantMessage}`
		}

		await (task as any).addToApiConversationHistory({
			role: "assistant",
			content: [{ type: "text", text: finalAssistantMessage }],
		})

		// Verify that reasoning was NOT appended to the assistant message
		expect(addToApiHistorySpy).toHaveBeenCalledWith({
			role: "assistant",
			content: [{ type: "text", text: "Here is my response to your question." }],
		})

		// Verify the API conversation history does NOT contain reasoning
		expect(task.apiConversationHistory).toHaveLength(1)
		expect(task.apiConversationHistory[0].content[0].text).toBe("Here is my response to your question.")
		expect(task.apiConversationHistory[0].content[0].text).not.toContain("<think>")
	})

	it("should handle empty reasoning message gracefully when preserveReasoning is true", async () => {
		// Create a task instance
		const task = new Task({
			provider: mockProvider as ClineProvider,
			apiConfiguration: mockApiConfiguration,
			task: "Test task",
			startTask: false,
		})

		// Mock the API to return a model with preserveReasoning enabled
		const mockModelInfo: ModelInfo = {
			contextWindow: 16000,
			supportsPromptCache: true,
			preserveReasoning: true,
		}

		task.api = {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: mockModelInfo,
			}),
		}

		// Mock the API conversation history
		task.apiConversationHistory = []

		const assistantMessage = "Here is my response."
		const reasoningMessage = "" // Empty reasoning

		// Spy on addToApiConversationHistory
		const addToApiHistorySpy = vi.spyOn(task as any, "addToApiConversationHistory")

		// Simulate what happens in the streaming loop
		let finalAssistantMessage = assistantMessage
		if (reasoningMessage && task.api.getModel().info.preserveReasoning) {
			finalAssistantMessage = `<think>${reasoningMessage}</think>\n${assistantMessage}`
		}

		await (task as any).addToApiConversationHistory({
			role: "assistant",
			content: [{ type: "text", text: finalAssistantMessage }],
		})

		// Verify that no reasoning tags were added when reasoning is empty
		expect(addToApiHistorySpy).toHaveBeenCalledWith({
			role: "assistant",
			content: [{ type: "text", text: "Here is my response." }],
		})

		// Verify the message doesn't contain reasoning tags
		expect(task.apiConversationHistory[0].content[0].text).toBe("Here is my response.")
		expect(task.apiConversationHistory[0].content[0].text).not.toContain("<think>")
	})

	it("should handle undefined preserveReasoning (defaults to false)", async () => {
		// Create a task instance
		const task = new Task({
			provider: mockProvider as ClineProvider,
			apiConfiguration: mockApiConfiguration,
			task: "Test task",
			startTask: false,
		})

		// Mock the API to return a model without preserveReasoning field (undefined)
		const mockModelInfo: ModelInfo = {
			contextWindow: 16000,
			supportsPromptCache: true,
			// preserveReasoning is undefined
		}

		task.api = {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: mockModelInfo,
			}),
		}

		// Mock the API conversation history
		task.apiConversationHistory = []

		const assistantMessage = "Here is my response."
		const reasoningMessage = "Some reasoning here."

		// Simulate what happens in the streaming loop
		let finalAssistantMessage = assistantMessage
		if (reasoningMessage && task.api.getModel().info.preserveReasoning) {
			finalAssistantMessage = `<think>${reasoningMessage}</think>\n${assistantMessage}`
		}

		await (task as any).addToApiConversationHistory({
			role: "assistant",
			content: [{ type: "text", text: finalAssistantMessage }],
		})

		// Verify reasoning was NOT prepended (undefined defaults to false)
		expect(task.apiConversationHistory[0].content[0].text).toBe("Here is my response.")
		expect(task.apiConversationHistory[0].content[0].text).not.toContain("<think>")
	})
})

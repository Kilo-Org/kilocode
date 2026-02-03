import { AttemptCompletionToolUse } from "../../../shared/tools"
import { attemptCompletionTool, AttemptCompletionCallbacks } from "../AttemptCompletionTool"
import { Task } from "../../task/Task"

// Mock the formatResponse module
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
		toolResult: vi.fn((text: string) => text),
	},
}))

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((key: string, defaultValue: any) => defaultValue),
		})),
	},
	window: {
		showErrorMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
	},
}))

// Mock Package module
vi.mock("../../../shared/package", () => ({
	Package: {
		name: "kilo-code",
	},
}))

describe("AttemptCompletionTool Ralph Mode", () => {
	let mockTask: any
	let mockProvider: any
	let mockCallbacks: AttemptCompletionCallbacks

	beforeEach(() => {
		mockProvider = {
			getState: vi.fn(),
			createTask: vi.fn(),
			postMessageToWebview: vi.fn(),
		}

		mockTask = {
			taskId: "test-task-id",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			todoList: undefined,
			didToolFailInCurrentTurn: false,
			providerRef: {
				deref: () => mockProvider,
			},
			metadata: {
				task: "initial prompt",
				images: [],
				ralphLoopCount: 0,
			},
			apiConversationHistory: [],
			clineMessages: [],
			say: vi.fn(),
			emit: vi.fn(),
			getTokenUsage: vi.fn(() => ({})),
			emitFinalTokenUsageUpdate: vi.fn(),
			ask: vi.fn(() => Promise.resolve({ response: "yesButtonClicked" })),
		}

		mockCallbacks = {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
			removeClosingTag: vi.fn(),
			askFinishSubTaskApproval: vi.fn(),
			toolDescription: vi.fn(),
			toolProtocol: "xml",
		}

		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("should restart task in Ralph mode when enabled", async () => {
		mockProvider.getState.mockResolvedValue({ ralphEnabled: true })

		const block: AttemptCompletionToolUse = {
			type: "tool_use",
			name: "attempt_completion",
			params: { result: "Task completed" },
			partial: false,
		}

		await attemptCompletionTool.handle(mockTask as Task, block, mockCallbacks)

		// Fast-forward 1 second for the setTimeout
		vi.advanceTimersByTime(1000)

		expect(mockProvider.createTask).toHaveBeenCalledWith(
			"initial prompt",
			[],
			undefined,
			expect.objectContaining({ ralphLoopCount: 1 }),
		)
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})

	it("should stop Ralph mode when loop limit is reached", async () => {
		mockProvider.getState.mockResolvedValue({
			ralphEnabled: true,
			ralphLoopLimit: 2,
		})
		mockTask.metadata.ralphLoopCount = 1 // Already ran once, this is the second time

		const block: AttemptCompletionToolUse = {
			type: "tool_use",
			name: "attempt_completion",
			params: { result: "Task completed" },
			partial: false,
		}

		await attemptCompletionTool.handle(mockTask as Task, block, mockCallbacks)

		vi.advanceTimersByTime(1000)

		// Should NOT restart the task because loop limit (2) is reached
		expect(mockProvider.createTask).not.toHaveBeenCalled()
		// Should instead call task.ask to show completion result to user
		expect(mockTask.ask).toHaveBeenCalledWith("completion_result", "", false)
	})

	it("should stop Ralph mode when custom delimiter is found in result", async () => {
		mockProvider.getState.mockResolvedValue({
			ralphEnabled: true,
			ralphCompletionDelimiter: "<ralph>COMPLETED</ralph>",
		})

		const block: AttemptCompletionToolUse = {
			type: "tool_use",
			name: "attempt_completion",
			params: { result: "Here is the result <ralph>COMPLETED</ralph>" },
			partial: false,
		}

		await attemptCompletionTool.handle(mockTask as Task, block, mockCallbacks)

		vi.advanceTimersByTime(1000)

		// Should NOT restart the task because delimiter is found
		expect(mockProvider.createTask).not.toHaveBeenCalled()
		expect(mockTask.ask).toHaveBeenCalled()
	})

	it("should stop Ralph mode when custom delimiter is found in previous messages", async () => {
		mockProvider.getState.mockResolvedValue({
			ralphEnabled: true,
			ralphCompletionDelimiter: "STOP_NOW",
		})

		// Delimiter is in a previous message (e.g., a file write)
		mockTask.apiConversationHistory = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						name: "write_to_file",
						id: "1",
						input: { content: "Some content with STOP_NOW delimiter" },
					},
				],
			},
		]

		const block: AttemptCompletionToolUse = {
			type: "tool_use",
			name: "attempt_completion",
			params: { result: "Finalizing task" },
			partial: false,
		}

		await attemptCompletionTool.handle(mockTask as Task, block, mockCallbacks)

		vi.advanceTimersByTime(1000)

		// Should NOT restart the task because delimiter is found in history
		expect(mockProvider.createTask).not.toHaveBeenCalled()
		expect(mockTask.ask).toHaveBeenCalled()
	})

	it("should continue Ralph mode when custom delimiter is NOT found anywhere", async () => {
		mockProvider.getState.mockResolvedValue({
			ralphEnabled: true,
			ralphCompletionDelimiter: "<ralph>COMPLETED</ralph>",
		})

		mockTask.apiConversationHistory = [
			{
				role: "assistant",
				content: "Just a regular message",
			},
		]

		const block: AttemptCompletionToolUse = {
			type: "tool_use",
			name: "attempt_completion",
			params: { result: "Task not yet fully done" },
			partial: false,
		}

		await attemptCompletionTool.handle(mockTask as Task, block, mockCallbacks)

		vi.advanceTimersByTime(1000)

		// Should restart the task
		expect(mockProvider.createTask).toHaveBeenCalled()
	})
})

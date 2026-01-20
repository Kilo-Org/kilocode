// kilocode_change - new file

import { describe, it, expect, beforeEach, vi } from "vitest"
import { presentAssistantMessage } from "../presentAssistantMessage"

const mocks = vi.hoisted(() => ({
	fastEditFileToolMock: vi.fn(),
	searchEditFileHandleMock: vi.fn(),
}))

// Mock dependencies that are not relevant to this unit test
vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureToolUsage: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
		},
	},
}))

vi.mock("../../tools/kilocode/editFileTool", async (importOriginal) => {
	const actual = (await importOriginal()) as any
	return {
		...actual,
		editFileTool: mocks.fastEditFileToolMock,
		isFastApplyAvailable: vi.fn().mockReturnValue(true),
	}
})

vi.mock("../../tools/EditFileTool", () => ({
	editFileTool: {
		handle: mocks.searchEditFileHandleMock,
	},
}))

describe("presentAssistantMessage - fast_edit_file routing", () => {
	let mockTask: any

	beforeEach(() => {
		mocks.fastEditFileToolMock.mockReset()
		mocks.searchEditFileHandleMock.mockReset()

		// Simulate a valid tool execution that returns a tool_result.
		mocks.fastEditFileToolMock.mockImplementation(
			async (_cline: any, _block: any, _ask: any, _err: any, push: any) => {
				push("ok")
			},
		)

		mocks.searchEditFileHandleMock.mockImplementation(async (_cline: any, _block: any, _callbacks: any) => {
			throw new Error("search edit_file tool should not be called in these tests")
		})

		mockTask = {
			taskId: "test-task-id",
			instanceId: "test-instance",
			abort: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [],
			userMessageContent: [],
			userMessageContentReady: false,
			didCompleteReadingStream: true,
			didRejectTool: false,
			didAlreadyUseTool: false,
			diffEnabled: true,
			consecutiveMistakeCount: 0,
			clineMessages: [],
			api: {
				getModel: () => ({ id: "test-model", info: {} }),
			},
			browserSession: {
				closeBrowser: vi.fn().mockResolvedValue(undefined),
			},
			recordToolUsage: vi.fn(),
			recordToolError: vi.fn(),
			checkpointSave: vi.fn().mockResolvedValue(undefined),
			toolRepetitionDetector: {
				check: vi.fn().mockReturnValue({ allowExecution: true }),
			},
			providerRef: {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({
						mode: "code",
						customModes: [],
						experiments: { morphFastApply: true },
						// isFastApplyAvailable() returns true if morphFastApply is enabled and
						// apiProvider is "human-relay" (see getFastApplyConfiguration).
						apiConfiguration: { apiProvider: "human-relay" },
					}),
				}),
			},
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			askMode: "code",
		}

		// Add pushToolResultToUserContent method after mockTask is created so it can reference mockTask
		mockTask.pushToolResultToUserContent = vi.fn().mockImplementation((toolResult: any) => {
			const existingResult = mockTask.userMessageContent.find(
				(block: any) => block.type === "tool_result" && block.tool_use_id === toolResult.tool_use_id,
			)
			if (existingResult) {
				return false
			}
			mockTask.userMessageContent.push(toolResult)
			return true
		})
	})

	it("executes fast_edit_file via Fast Apply tool handler", async () => {
		const toolCallId = "tool_call_123"
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "fast_edit_file",
				params: {
					target_file: "src/example.ts",
					instructions: "Update the function",
					code_edit: "// ... existing code ...\nconst x = 1\n",
				},
				partial: false,
			},
		]

		await presentAssistantMessage(mockTask)

		// Should have executed the Fast Apply tool handler
		expect(mocks.fastEditFileToolMock).toHaveBeenCalledTimes(1)
		expect(mocks.searchEditFileHandleMock).not.toHaveBeenCalled()

		// recordToolUsage should be attributed to fast_edit_file
		expect(mockTask.recordToolUsage).toHaveBeenCalledWith("fast_edit_file")

		// Ensure a tool_result was produced for native protocol
		const toolResult = mockTask.userMessageContent.find(
			(item: any) => item.type === "tool_result" && item.tool_use_id === toolCallId,
		)
		expect(toolResult).toBeDefined()
	})

	it("backward-compat: routes edit_file with Fast Apply params to fast_edit_file handler", async () => {
		const toolCallId = "tool_call_456"
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "edit_file",
				params: {
					target_file: "src/example.ts",
					instructions: "Update the function",
					code_edit: "// ... existing code ...\nconst y = 2\n",
				},
				partial: false,
			},
		]

		await presentAssistantMessage(mockTask)

		expect(mocks.fastEditFileToolMock).toHaveBeenCalledTimes(1)
		expect(mocks.searchEditFileHandleMock).not.toHaveBeenCalled()
	})
})

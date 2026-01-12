// kilocode_change - new file

import { describe, it, expect, beforeEach, vi } from "vitest"
import { presentAssistantMessage } from "../presentAssistantMessage"

const mocks = vi.hoisted(() => ({
	editFileToolMock: vi.fn(),
	applyDiffHandleMock: vi.fn(),
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
		editFileTool: mocks.editFileToolMock,
	}
})

vi.mock("../../tools/ApplyDiffTool", () => ({
	applyDiffTool: {
		handle: mocks.applyDiffHandleMock,
	},
}))

describe("presentAssistantMessage - Fast Apply alias undo", () => {
	let mockTask: any

	beforeEach(() => {
		mocks.editFileToolMock.mockReset()
		mocks.applyDiffHandleMock.mockReset()

		// Simulate a valid tool execution that returns a tool_result.
		mocks.editFileToolMock.mockImplementation(async (_cline: any, _block: any, _ask: any, _err: any, push: any) => {
			push("ok")
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
	})

	it("maps native alias-resolved apply_diff back to edit_file when Fast Apply is available", async () => {
		const toolCallId = "tool_call_123"
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "apply_diff",
				originalName: "edit_file",
				params: {
					target_file: "src/example.ts",
					instructions: "Update the function",
					code_edit: "// ... existing code ...\nconst x = 1\n",
				},
				partial: false,
			},
		]

		await presentAssistantMessage(mockTask)

		// Should have executed the Fast Apply tool handler, not apply_diff
		expect(mocks.editFileToolMock).toHaveBeenCalledTimes(1)
		expect(mocks.applyDiffHandleMock).not.toHaveBeenCalled()

		// recordToolUsage should be attributed to edit_file
		expect(mockTask.recordToolUsage).toHaveBeenCalledWith("edit_file")

		// Ensure a tool_result was produced for native protocol
		const toolResult = mockTask.userMessageContent.find(
			(item: any) => item.type === "tool_result" && item.tool_use_id === toolCallId,
		)
		expect(toolResult).toBeDefined()
	})
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import { condenseTool } from "../condenseTool"
import { Task } from "../../../task/Task"
import { ToolUse } from "../../../../shared/tools"

// Mock the Task class
vi.mock("../../../task/Task", () => ({
	Task: vi.fn(),
}))

describe("condenseTool", () => {
	let mockTask: Partial<Task>
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let mockRemoveClosingTag: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()

		mockTask = {
			ask: vi.fn(),
			say: vi.fn(),
			condenseContext: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing param error"),
			consecutiveMistakeCount: 0,
		}

		mockAskApproval = vi.fn()
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		mockRemoveClosingTag = vi.fn((tag, content) => content)
	})

	it("should call condenseContext when user accepts the condensed version", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "condense",
			params: {
				message: "Test summary message",
			},
			partial: false,
		}

		// User accepts (no text or images in response)
		;(mockTask.ask as ReturnType<typeof vi.fn>).mockResolvedValue({ text: undefined, images: undefined })

		await condenseTool(
			mockTask as Task,
			block,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify condenseContext was called
		expect(mockTask.condenseContext).toHaveBeenCalledTimes(1)
		expect(mockPushToolResult).toHaveBeenCalled()
	})

	it("should not call condenseContext when user provides feedback", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "condense",
			params: {
				message: "Test summary message",
			},
			partial: false,
		}

		// User provides feedback
		;(mockTask.ask as ReturnType<typeof vi.fn>).mockResolvedValue({ text: "Some feedback", images: [] })

		await condenseTool(
			mockTask as Task,
			block,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify condenseContext was NOT called
		expect(mockTask.condenseContext).not.toHaveBeenCalled()
		// Verify user feedback was recorded
		expect(mockTask.say).toHaveBeenCalledWith("user_feedback", "Some feedback", [])
	})

	it("should handle partial blocks", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "condense",
			params: {
				message: "Partial message",
			},
			partial: true,
		}

		;(mockTask.ask as ReturnType<typeof vi.fn>).mockResolvedValue({ text: undefined, images: undefined })

		await condenseTool(
			mockTask as Task,
			block,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify ask was called with partial flag
		expect(mockTask.ask).toHaveBeenCalledWith("condense", "Partial message", true)
		// Verify condenseContext was NOT called for partial blocks
		expect(mockTask.condenseContext).not.toHaveBeenCalled()
	})

	it("should handle missing message parameter", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "condense",
			params: {},
			partial: false,
		}

		await condenseTool(
			mockTask as Task,
			block,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify error was pushed
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("condense", "context")
		expect(mockPushToolResult).toHaveBeenCalledWith("Missing param error")
		// Verify condenseContext was NOT called
		expect(mockTask.condenseContext).not.toHaveBeenCalled()
	})

	it("should handle errors during condensing", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "condense",
			params: {
				message: "Test summary message",
			},
			partial: false,
		}

		const testError = new Error("Condensing failed")
		;(mockTask.ask as ReturnType<typeof vi.fn>).mockRejectedValue(testError)

		await condenseTool(
			mockTask as Task,
			block,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Verify error handler was called
		expect(mockHandleError).toHaveBeenCalledWith("condensing context window", testError)
	})
})
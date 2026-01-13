// npx vitest src/core/assistant-message/__tests__/presentAssistantMessage-unknown-tool.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"
import { presentAssistantMessage } from "../presentAssistantMessage"

// Mock dependencies
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

describe("presentAssistantMessage - Unknown Tool Handling", () => {
	let mockTask: any

	beforeEach(() => {
		// Create a mock Task with minimal properties needed for testing
		mockTask = {
			taskId: "test-task-id",
			instanceId: "test-instance",
			abort: false,
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [],
			userMessageContent: [],
			didCompleteReadingStream: false,
			didRejectTool: false,
			didAlreadyUseTool: false,
			diffEnabled: false,
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
			toolRepetitionDetector: {
				check: vi.fn().mockReturnValue({ allowExecution: true }),
			},
			providerRef: {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({
						mode: "code",
						customModes: [],
					}),
				}),
			},
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		}
	})

	it("should return error for unknown tool in native protocol", async () => {
		// Set up a tool_use block with an unknown tool name and an ID (native protocol)
		const toolCallId = "tool_call_unknown_123"
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId, // ID indicates native protocol
				name: "nonexistent_tool",
				params: { some: "param" },
				partial: false,
			},
		]

		// Execute presentAssistantMessage
		await presentAssistantMessage(mockTask)

		// Verify that a tool_result with error was pushed
		const toolResult = mockTask.userMessageContent.find(
			(item: any) => item.type === "tool_result" && item.tool_use_id === toolCallId,
		)

		expect(toolResult).toBeDefined()
		expect(toolResult.tool_use_id).toBe(toolCallId)
		// The error is wrapped in JSON by formatResponse.toolError
		expect(toolResult.content).toContain("nonexistent_tool")
		expect(toolResult.content).toContain("does not exist")
		expect(toolResult.content).toContain("error")

		// Verify consecutiveMistakeCount was incremented
		expect(mockTask.consecutiveMistakeCount).toBe(1)

		// Verify recordToolError was called
		expect(mockTask.recordToolError).toHaveBeenCalledWith(
			"nonexistent_tool",
			expect.stringContaining("Unknown tool"),
		)

		// Verify error message was shown to user (uses i18n key)
		expect(mockTask.say).toHaveBeenCalledWith("error", "unknownToolError")
	})

	it("should return error for unknown tool in XML protocol", async () => {
		// Set up a tool_use block with an unknown tool name WITHOUT an ID (XML protocol)
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				// No ID = XML protocol
				name: "fake_tool_that_does_not_exist",
				params: { param1: "value1" },
				partial: false,
			},
		]

		// Execute presentAssistantMessage
		await presentAssistantMessage(mockTask)

		// For XML protocol, error is pushed as text blocks
		const textBlocks = mockTask.userMessageContent.filter((item: any) => item.type === "text")

		// There should be text blocks with error message
		expect(textBlocks.length).toBeGreaterThan(0)
		const hasErrorMessage = textBlocks.some(
			(block: any) =>
				block.text?.includes("fake_tool_that_does_not_exist") && block.text?.includes("does not exist"),
		)
		expect(hasErrorMessage).toBe(true)

		// Verify consecutiveMistakeCount was incremented
		expect(mockTask.consecutiveMistakeCount).toBe(1)

		// Verify recordToolError was called
		expect(mockTask.recordToolError).toHaveBeenCalled()

		// Verify error message was shown to user (uses i18n key)
		expect(mockTask.say).toHaveBeenCalledWith("error", "unknownToolError")
	})

	it("should handle unknown tool without freezing (native protocol)", async () => {
		// This test ensures the extension doesn't freeze when an unknown tool is called
		const toolCallId = "tool_call_freeze_test"
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId, // Native protocol
				name: "this_tool_definitely_does_not_exist",
				params: {},
				partial: false,
			},
		]

		// The test will timeout if the extension freezes
		const timeoutPromise = new Promise<boolean>((_, reject) => {
			setTimeout(() => reject(new Error("Test timed out - extension likely froze")), 5000)
		})

		const resultPromise = presentAssistantMessage(mockTask).then(() => true)

		// Race between the function completing and the timeout
		const completed = await Promise.race([resultPromise, timeoutPromise])
		expect(completed).toBe(true)

		// Verify a tool_result was pushed (critical for API not to freeze)
		const toolResult = mockTask.userMessageContent.find(
			(item: any) => item.type === "tool_result" && item.tool_use_id === toolCallId,
		)
		expect(toolResult).toBeDefined()
	})

	it("should increment consecutiveMistakeCount for unknown tools", async () => {
		// Test with multiple unknown tools to ensure mistake count increments
		const toolCallId = "tool_call_mistake_test"
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "unknown_tool_1",
				params: {},
				partial: false,
			},
		]

		expect(mockTask.consecutiveMistakeCount).toBe(0)

		await presentAssistantMessage(mockTask)

		expect(mockTask.consecutiveMistakeCount).toBe(1)
	})

	it("should set userMessageContentReady after handling unknown tool", async () => {
		const toolCallId = "tool_call_ready_test"
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "unknown_tool",
				params: {},
				partial: false,
			},
		]

		mockTask.didCompleteReadingStream = true
		mockTask.userMessageContentReady = false

		await presentAssistantMessage(mockTask)

		// userMessageContentReady should be set after processing
		expect(mockTask.userMessageContentReady).toBe(true)
	})

	it("should still work with didAlreadyUseTool flag for unknown tool", async () => {
		const toolCallId = "tool_call_already_used_test"
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "unknown_tool",
				params: {},
				partial: false,
			},
		]

		mockTask.didAlreadyUseTool = true

		await presentAssistantMessage(mockTask)

		// When didAlreadyUseTool is true, should send error tool_result
		const toolResult = mockTask.userMessageContent.find(
			(item: any) => item.type === "tool_result" && item.tool_use_id === toolCallId,
		)

		expect(toolResult).toBeDefined()
		expect(toolResult.is_error).toBe(true)
		expect(toolResult.content).toContain("was not executed because a tool has already been used")
	})

	it("should still work with didRejectTool flag for unknown tool", async () => {
		const toolCallId = "tool_call_rejected_test"
		mockTask.assistantMessageContent = [
			{
				type: "tool_use",
				id: toolCallId,
				name: "unknown_tool",
				params: {},
				partial: false,
			},
		]

		mockTask.didRejectTool = true

		await presentAssistantMessage(mockTask)

		// When didRejectTool is true, should send error tool_result
		const toolResult = mockTask.userMessageContent.find(
			(item: any) => item.type === "tool_result" && item.tool_use_id === toolCallId,
		)

		expect(toolResult).toBeDefined()
		expect(toolResult.is_error).toBe(true)
		expect(toolResult.content).toContain("due to user rejecting a previous tool")
	})
})

// npx vitest src/core/assistant-message/__tests__/presentAssistantMessage-custom-tool.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"
import { presentAssistantMessage } from "../presentAssistantMessage"

// Mock dependencies
vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
}))

// Mock custom tool registry - must be done inline without external variable references
vi.mock("@roo-code/core", () => ({
	customToolRegistry: {
		has: vi.fn(),
		get: vi.fn(),
	},
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureToolUsage: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
		},
	},
}))

import { TelemetryService } from "@roo-code/telemetry"
import { customToolRegistry } from "@roo-code/core"

describe("presentAssistantMessage - Custom Tool Recording", () => {
	let mockTask: any

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

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
						experiments: {
							customTools: true, // Enable by default
						},
					}),
				}),
			},
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		}
	})

	describe("Custom tool usage recording", () => {
		it("should record custom tool usage as 'custom_tool' when experiment is enabled", async () => {
			const toolCallId = "tool_call_custom_123"
			mockTask.assistantMessageContent = [
				{
					type: "tool_use",
					id: toolCallId,
					name: "my_custom_tool",
					params: { value: "test" },
					partial: false,
				},
			]

			// Mock customToolRegistry to recognize this as a custom tool
			vi.mocked(customToolRegistry.has).mockReturnValue(true)
			vi.mocked(customToolRegistry.get).mockReturnValue({
				name: "my_custom_tool",
				description: "A custom tool",
				execute: vi.fn().mockResolvedValue("Custom tool result"),
			})

			await presentAssistantMessage(mockTask)

			// Should record as "custom_tool", not "my_custom_tool"
			expect(mockTask.recordToolUsage).toHaveBeenCalledWith("custom_tool")
			expect(TelemetryService.instance.captureToolUsage).toHaveBeenCalledWith(
				mockTask.taskId,
				"custom_tool",
				"native",
			)
		})

		it("should record custom tool usage as 'custom_tool' in XML protocol", async () => {
			mockTask.assistantMessageContent = [
				{
					type: "tool_use",
					// No ID = XML protocol
					name: "my_custom_tool",
					params: { value: "test" },
					partial: false,
				},
			]

			vi.mocked(customToolRegistry.has).mockReturnValue(true)
			vi.mocked(customToolRegistry.get).mockReturnValue({
				name: "my_custom_tool",
				description: "A custom tool",
				execute: vi.fn().mockResolvedValue("Custom tool result"),
			})

			await presentAssistantMessage(mockTask)

			expect(mockTask.recordToolUsage).toHaveBeenCalledWith("custom_tool")
			expect(TelemetryService.instance.captureToolUsage).toHaveBeenCalledWith(
				mockTask.taskId,
				"custom_tool",
				"xml",
			)
		})
	})

	describe("Custom tool error recording", () => {
		it("should record custom tool error as 'custom_tool'", async () => {
			const toolCallId = "tool_call_custom_error_123"
			mockTask.assistantMessageContent = [
				{
					type: "tool_use",
					id: toolCallId,
					name: "failing_custom_tool",
					params: {},
					partial: false,
				},
			]

			// Mock customToolRegistry with a tool that throws an error
			vi.mocked(customToolRegistry.has).mockReturnValue(true)
			vi.mocked(customToolRegistry.get).mockReturnValue({
				name: "failing_custom_tool",
				description: "A failing custom tool",
				execute: vi.fn().mockRejectedValue(new Error("Custom tool execution failed")),
			})

			await presentAssistantMessage(mockTask)

			// Should record error as "custom_tool", not "failing_custom_tool"
			expect(mockTask.recordToolError).toHaveBeenCalledWith("custom_tool", "Custom tool execution failed")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})
	})

	describe("Regular tool recording", () => {
		it("should record regular tool usage with actual tool name", async () => {
			const toolCallId = "tool_call_read_file_123"
			mockTask.assistantMessageContent = [
				{
					type: "tool_use",
					id: toolCallId,
					name: "read_file",
					params: { path: "test.txt" },
					partial: false,
				},
			]

			// read_file is not a custom tool
			vi.mocked(customToolRegistry.has).mockReturnValue(false)

			await presentAssistantMessage(mockTask)

			// Should record as "read_file", not "custom_tool"
			expect(mockTask.recordToolUsage).toHaveBeenCalledWith("read_file")
			expect(TelemetryService.instance.captureToolUsage).toHaveBeenCalledWith(
				mockTask.taskId,
				"read_file",
				"native",
			)
		})

		it("should record MCP tool usage as 'use_mcp_tool' (not custom_tool)", async () => {
			const toolCallId = "tool_call_mcp_123"
			mockTask.assistantMessageContent = [
				{
					type: "tool_use",
					id: toolCallId,
					name: "use_mcp_tool",
					params: {
						server_name: "test-server",
						tool_name: "test-tool",
						arguments: "{}",
					},
					partial: false,
				},
			]

			vi.mocked(customToolRegistry.has).mockReturnValue(false)

			// Mock MCP hub for use_mcp_tool
			mockTask.providerRef = {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({
						mode: "code",
						customModes: [],
						experiments: {
							customTools: true,
						},
					}),
					getMcpHub: () => ({
						findServerNameBySanitizedName: () => "test-server",
						executeToolCall: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "result" }] }),
					}),
				}),
			}

			await presentAssistantMessage(mockTask)

			// Should record as "use_mcp_tool", not "custom_tool"
			expect(mockTask.recordToolUsage).toHaveBeenCalledWith("use_mcp_tool")
			expect(TelemetryService.instance.captureToolUsage).toHaveBeenCalledWith(
				mockTask.taskId,
				"use_mcp_tool",
				"native",
			)
		})
	})

	describe("Custom tool experiment gate", () => {
		it("should treat custom tool as unknown when experiment is disabled", async () => {
			const toolCallId = "tool_call_disabled_123"
			mockTask.assistantMessageContent = [
				{
					type: "tool_use",
					id: toolCallId,
					name: "my_custom_tool",
					params: {},
					partial: false,
				},
			]

			// Mock provider state with customTools experiment DISABLED
			mockTask.providerRef = {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({
						mode: "code",
						customModes: [],
						experiments: {
							customTools: false, // Disabled
						},
					}),
				}),
			}

			// Even if registry recognizes it, experiment gate should prevent execution
			vi.mocked(customToolRegistry.has).mockReturnValue(true)
			vi.mocked(customToolRegistry.get).mockReturnValue({
				name: "my_custom_tool",
				description: "A custom tool",
				execute: vi.fn().mockResolvedValue("Should not execute"),
			})

			await presentAssistantMessage(mockTask)

			// Should be treated as unknown tool (not executed)
			expect(mockTask.say).toHaveBeenCalledWith("error", "unknownToolError")
			expect(mockTask.consecutiveMistakeCount).toBe(1)

			// Custom tool should NOT have been executed
			const getMock = vi.mocked(customToolRegistry.get)
			if (getMock.mock.results.length > 0) {
				const customTool = getMock.mock.results[0].value
				if (customTool) {
					expect(customTool.execute).not.toHaveBeenCalled()
				}
			}
		})

		it("should not call customToolRegistry.has() when experiment is disabled", async () => {
			mockTask.assistantMessageContent = [
				{
					type: "tool_use",
					id: "tool_call_123",
					name: "some_tool",
					params: {},
					partial: false,
				},
			]

			// Disable experiment
			mockTask.providerRef = {
				deref: () => ({
					getState: vi.fn().mockResolvedValue({
						mode: "code",
						customModes: [],
						experiments: {
							customTools: false,
						},
					}),
				}),
			}

			await presentAssistantMessage(mockTask)

			// When experiment is off, shouldn't even check the registry
			// (Code checks stateExperiments?.customTools before calling has())
			expect(customToolRegistry.has).not.toHaveBeenCalled()
		})
	})

	describe("Partial blocks", () => {
		it("should not record usage for partial custom tool blocks", async () => {
			mockTask.assistantMessageContent = [
				{
					type: "tool_use",
					id: "tool_call_partial_123",
					name: "my_custom_tool",
					params: { value: "test" },
					partial: true, // Still streaming
				},
			]

			vi.mocked(customToolRegistry.has).mockReturnValue(true)

			await presentAssistantMessage(mockTask)

			// Should not record usage for partial blocks
			expect(mockTask.recordToolUsage).not.toHaveBeenCalled()
			expect(TelemetryService.instance.captureToolUsage).not.toHaveBeenCalled()
		})
	})
})

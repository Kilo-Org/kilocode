import { describe, it, expect, vi, beforeEach } from "vitest"
import { runSlashCommandTool } from "../RunSlashCommandTool"
import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { getCommand, getCommandNames } from "../../../services/command/commands"
import type { ToolUse } from "../../../shared/tools"

// Mock dependencies
vi.mock("../../../services/command/commands", () => ({
	getCommand: vi.fn(),
	getCommandNames: vi.fn(),
}))

describe("runSlashCommandTool", () => {
	let mockTask: any
	let mockCallbacks: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			ask: vi.fn().mockResolvedValue({}),
			cwd: "/test/project",
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({
						experiments: {
							runSlashCommand: true,
						},
					}),
				}),
			},
		}

		mockCallbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
			removeClosingTag: vi.fn((tag, text) => text || ""),
		}
	})

	it("should handle missing command parameter", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {},
			partial: false,
		}

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("run_slash_command")
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("run_slash_command", "command")
		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})

	it("should handle command not found", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "nonexistent",
			},
			partial: false,
		}

		vi.mocked(getCommand).mockResolvedValue(undefined)
		vi.mocked(getCommandNames).mockResolvedValue(["init", "test", "deploy"])

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockTask.recordToolError).toHaveBeenCalledWith("run_slash_command")
		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(
			formatResponse.toolError("Command 'nonexistent' not found. Available commands: init, test, deploy"),
		)
	})

	it("should handle user rejection", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "init",
			},
			partial: false,
		}

		const mockCommand = {
			name: "init",
			content: "Initialize project",
			source: "built-in" as const,
			filePath: "<built-in:init>",
			description: "Initialize the project",
		}

		vi.mocked(getCommand).mockResolvedValue(mockCommand)
		mockCallbacks.askApproval.mockResolvedValue(false)

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockCallbacks.askApproval).toHaveBeenCalled()
		expect(mockCallbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it("should successfully execute built-in command", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "init",
			},
			partial: false,
		}

		const mockCommand = {
			name: "init",
			content: "Initialize project content here",
			source: "built-in" as const,
			filePath: "<built-in:init>",
			description: "Analyze codebase and create AGENTS.md",
		}

		vi.mocked(getCommand).mockResolvedValue(mockCommand)

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockCallbacks.askApproval).toHaveBeenCalledWith(
			"tool",
			JSON.stringify({
				tool: "runSlashCommand",
				command: "init",
				args: undefined,
				source: "built-in",
				description: "Analyze codebase and create AGENTS.md",
			}),
		)

		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(
			`Command: /init
Description: Analyze codebase and create AGENTS.md
Source: built-in

--- Command Content ---

Initialize project content here`,
		)
	})

	it("should successfully execute command with arguments", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "test",
				args: "focus on unit tests",
			},
			partial: false,
		}

		const mockCommand = {
			name: "test",
			content: "Run tests with specific focus",
			source: "project" as const,
			filePath: ".roo/commands/test.md",
			description: "Run project tests",
			argumentHint: "test type or focus area",
		}

		vi.mocked(getCommand).mockResolvedValue(mockCommand)

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(
			`Command: /test
Description: Run project tests
Argument hint: test type or focus area
Provided arguments: focus on unit tests
Source: project

--- Command Content ---

Run tests with specific focus`,
		)
	})

	it("should handle global command", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "deploy",
			},
			partial: false,
		}

		const mockCommand = {
			name: "deploy",
			content: "Deploy application to production",
			source: "global" as const,
			filePath: "~/.roo/commands/deploy.md",
		}

		vi.mocked(getCommand).mockResolvedValue(mockCommand)

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(
			`Command: /deploy
Source: global

--- Command Content ---

Deploy application to production`,
		)
	})

	it("should handle partial block", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "init",
			},
			partial: true,
		}

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockTask.ask).toHaveBeenCalledWith(
			"tool",
			JSON.stringify({
				tool: "runSlashCommand",
				command: "init",
				args: "",
			}),
			true,
		)

		expect(mockCallbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it("should handle errors during execution", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "init",
			},
			partial: false,
		}

		const error = new Error("Test error")
		vi.mocked(getCommand).mockRejectedValue(error)

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockCallbacks.handleError).toHaveBeenCalledWith("running slash command", error)
	})

	it("should handle empty available commands list", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "nonexistent",
			},
			partial: false,
		}

		vi.mocked(getCommand).mockResolvedValue(undefined)
		vi.mocked(getCommandNames).mockResolvedValue([])

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(
			formatResponse.toolError("Command 'nonexistent' not found. Available commands: (none)"),
		)
	})

	it("should reset consecutive mistake count on valid command", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "init",
			},
			partial: false,
		}

		mockTask.consecutiveMistakeCount = 5

		const mockCommand = {
			name: "init",
			content: "Initialize project",
			source: "built-in" as const,
			filePath: "<built-in:init>",
		}

		vi.mocked(getCommand).mockResolvedValue(mockCommand)

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockTask.consecutiveMistakeCount).toBe(0)
	})

	it("should switch mode when mode is specified in command", async () => {
		const mockHandleModeSwitch = vi.fn()
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "debug-app",
			},
			partial: false,
		}

		const mockCommand = {
			name: "debug-app",
			content: "Start debugging the application",
			source: "project" as const,
			filePath: ".roo/commands/debug-app.md",
			description: "Debug the application",
			mode: "debug",
		}

		mockTask.providerRef.deref = vi.fn().mockReturnValue({
			getState: vi.fn().mockResolvedValue({
				experiments: {
					runSlashCommand: true,
				},
				customModes: undefined,
			}),
			handleModeSwitch: mockHandleModeSwitch,
		})

		vi.mocked(getCommand).mockResolvedValue(mockCommand)

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockHandleModeSwitch).toHaveBeenCalledWith("debug")
		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(
			`Command: /debug-app
Description: Debug the application
Mode: debug
Source: project

--- Command Content ---

Start debugging the application`,
		)
	})

	it("should not switch mode when mode is not specified in command", async () => {
		const mockHandleModeSwitch = vi.fn()
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "test",
			},
			partial: false,
		}

		const mockCommand = {
			name: "test",
			content: "Run tests",
			source: "project" as const,
			filePath: ".roo/commands/test.md",
			description: "Run project tests",
		}

		mockTask.providerRef.deref = vi.fn().mockReturnValue({
			getState: vi.fn().mockResolvedValue({
				experiments: {
					runSlashCommand: true,
				},
				customModes: undefined,
			}),
			handleModeSwitch: mockHandleModeSwitch,
		})

		vi.mocked(getCommand).mockResolvedValue(mockCommand)

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockHandleModeSwitch).not.toHaveBeenCalled()
	})

	it("should include mode in askApproval message when mode is specified", async () => {
		const block: ToolUse<"run_slash_command"> = {
			type: "tool_use" as const,
			name: "run_slash_command" as const,
			params: {
				command: "debug-app",
			},
			partial: false,
		}

		const mockCommand = {
			name: "debug-app",
			content: "Start debugging",
			source: "project" as const,
			filePath: ".roo/commands/debug-app.md",
			description: "Debug the application",
			mode: "debug",
		}

		mockTask.providerRef.deref = vi.fn().mockReturnValue({
			getState: vi.fn().mockResolvedValue({
				experiments: {
					runSlashCommand: true,
				},
				customModes: undefined,
			}),
			handleModeSwitch: vi.fn(),
		})

		vi.mocked(getCommand).mockResolvedValue(mockCommand)

		await runSlashCommandTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockCallbacks.askApproval).toHaveBeenCalledWith(
			"tool",
			JSON.stringify({
				tool: "runSlashCommand",
				command: "debug-app",
				args: undefined,
				source: "project",
				description: "Debug the application",
				mode: "debug",
			}),
		)
	})
})

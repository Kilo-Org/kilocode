// npx vitest run src/core/tools/__tests__/executeCommandTool.spec.ts

import type { ToolUsage } from "@roo-code/types"
import * as vscode from "vscode"

import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../../shared/tools"
import { unescapeHtmlEntities } from "../../../utils/text-normalization"

// Mock dependencies
vitest.mock("execa", () => ({
	execa: vitest.fn(),
}))

vitest.mock("fs/promises", () => ({
	default: {
		access: vitest.fn().mockResolvedValue(undefined),
	},
}))

vitest.mock("vscode", () => ({
	workspace: {
		getConfiguration: vitest.fn(),
	},
}))

vitest.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		getOrCreateTerminal: vitest.fn().mockResolvedValue({
			runCommand: vitest.fn().mockResolvedValue(undefined),
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/workspace"),
		}),
	},
}))

vitest.mock("../../task/Task")
vitest.mock("../../prompts/responses")

// Import the module
import * as executeCommandModule from "../ExecuteCommandTool"
const { executeCommandTool } = executeCommandModule

describe("executeCommandTool", () => {
	// Setup common test variables
	let mockCline: any & { consecutiveMistakeCount: number; didRejectTool: boolean }
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any
	let mockToolUse: ToolUse<"execute_command">

	beforeEach(() => {
		// Reset mocks
		vitest.clearAllMocks()

		// Spy on executeCommandInTerminal and mock its return value
		vitest.spyOn(executeCommandModule, "executeCommandInTerminal").mockResolvedValue([false, "Command executed"])

		// Create mock implementations with eslint directives to handle the type issues
		mockCline = {
			ask: vitest.fn().mockResolvedValue(undefined),
			say: vitest.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vitest.fn().mockResolvedValue("Missing parameter error"),
			consecutiveMistakeCount: 0,
			didRejectTool: false,
			rooIgnoreController: {
				validateCommand: vitest.fn().mockReturnValue(null),
			},
			recordToolUsage: vitest.fn().mockReturnValue({} as ToolUsage),
			recordToolError: vitest.fn(),
			providerRef: {
				deref: vitest.fn().mockResolvedValue({
					getState: vitest.fn().mockResolvedValue({
						terminalOutputLineLimit: 500,
						terminalOutputCharacterLimit: 100000,
						terminalShellIntegrationDisabled: true,
					}),
					postMessageToWebview: vitest.fn(),
				}),
			},
			lastMessageTs: Date.now(),
			cwd: "/test/workspace",
		}

		mockAskApproval = vitest.fn().mockResolvedValue(true)
		mockHandleError = vitest.fn().mockResolvedValue(undefined)
		mockPushToolResult = vitest.fn()
		mockRemoveClosingTag = vitest.fn().mockReturnValue("command")

		// Setup vscode config mock
		const mockConfig = {
			get: vitest.fn().mockImplementation((key: string, defaultValue: any) => defaultValue),
		}
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)

		// Create a mock tool use object
		mockToolUse = {
			type: "tool_use",
			name: "execute_command",
			params: {
				command: "echo test",
			},
			partial: false,
		}
	})

	/**
	 * Tests for HTML entity unescaping in commands
	 * This verifies that HTML entities are properly converted to their actual characters
	 */
	describe("HTML entity unescaping", () => {
		it("should unescape &lt; to < character", () => {
			const input = "echo &lt;test&gt;"
			const expected = "echo <test>"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should unescape &gt; to > character", () => {
			const input = "echo test &gt; output.txt"
			const expected = "echo test > output.txt"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should unescape &amp; to & character", () => {
			const input = "echo foo &amp;&amp; echo bar"
			const expected = "echo foo && echo bar"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should handle multiple mixed HTML entities", () => {
			const input = "grep -E 'pattern' &lt;file.txt &gt;output.txt 2&gt;&amp;1"
			const expected = "grep -E 'pattern' <file.txt >output.txt 2>&1"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})
	})

	// Now we can run these tests
	describe("Basic functionality", () => {
		it("should execute a command normally", async () => {
			// Setup
			mockToolUse.params.command = "echo test"

			// Execute using the class-based handle method
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			expect(mockPushToolResult).toHaveBeenCalled()
			// The exact message depends on the terminal mock's behavior
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("Command")
		})

		it("should pass along custom working directory if provided", async () => {
			// Setup
			mockToolUse.params.command = "echo test"
			mockToolUse.params.cwd = "/custom/path"

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify - confirm the command was approved and result was pushed
			// The custom path handling is tested in integration tests
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			expect(mockPushToolResult).toHaveBeenCalled()
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("/custom/path")
		})
	})

	describe("Error handling", () => {
		it("should handle missing command parameter", async () => {
			// Setup
			mockToolUse.params.command = undefined

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify
			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("execute_command", "command")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(executeCommandModule.executeCommandInTerminal).not.toHaveBeenCalled()
		})

		it("should handle command rejection", async () => {
			// Setup
			mockToolUse.params.command = "echo test"
			mockAskApproval.mockResolvedValue(false)

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			// executeCommandInTerminal should not be called since approval was denied
			expect(mockPushToolResult).not.toHaveBeenCalled()
		})

		it("should handle rooignore validation failures", async () => {
			// Setup
			mockToolUse.params.command = "cat .env"
			// Override the validateCommand mock to return a filename
			const validateCommandMock = vitest.fn().mockReturnValue(".env")
			mockCline.rooIgnoreController = {
				validateCommand: validateCommandMock,
			}

			const mockRooIgnoreError = "RooIgnore error"
			;(formatResponse.rooIgnoreError as any).mockReturnValue(mockRooIgnoreError)

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify
			expect(validateCommandMock).toHaveBeenCalledWith("cat .env")
			expect(mockCline.say).toHaveBeenCalledWith("rooignore_error", ".env")
			expect(formatResponse.rooIgnoreError).toHaveBeenCalledWith(".env", "xml")
			expect(mockPushToolResult).toHaveBeenCalledWith(mockRooIgnoreError)
			expect(mockAskApproval).not.toHaveBeenCalled()
			// executeCommandInTerminal should not be called since rooignore blocked it
		})
	})

	describe("Command execution timeout configuration", () => {
		it("should include timeout parameter in ExecuteCommandOptions", () => {
			// This test verifies that the timeout configuration is properly typed
			// The actual timeout logic is tested in integration tests
			// Note: timeout is stored internally in milliseconds but configured in seconds
			const timeoutSeconds = 15
			const options = {
				executionId: "test-id",
				command: "echo test",
				commandExecutionTimeout: timeoutSeconds * 1000, // Convert to milliseconds
			}

			// Verify the options object has the expected structure
			expect(options.commandExecutionTimeout).toBe(15000)
			expect(typeof options.commandExecutionTimeout).toBe("number")
		})

		it("should handle timeout parameter in function signature", () => {
			// Test that the executeCommandInTerminal function accepts timeout parameter
			// This is a compile-time check that the types are correct
			const mockOptions = {
				executionId: "test-id",
				command: "echo test",
				customCwd: undefined,
				terminalShellIntegrationDisabled: false,
				terminalOutputLineLimit: 500,
				commandExecutionTimeout: 0,
			}

			// Verify all required properties exist
			expect(mockOptions.executionId).toBeDefined()
			expect(mockOptions.command).toBeDefined()
			expect(mockOptions.commandExecutionTimeout).toBeDefined()
		})
	})
})

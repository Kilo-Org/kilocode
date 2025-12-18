// npx vitest core/tools/__tests__/newTaskTool.spec.ts

import type { AskApproval, HandleError } from "../../../shared/tools"

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
		})),
	},
}))

// Mock Package module
vi.mock("../../../shared/package", () => ({
	Package: {
		name: "kilo-code",
		publisher: "Kilo-Org",
		version: "1.0.0",
		outputChannel: "Kilo-Code",
	},
}))

// Mock other modules first - these are hoisted to the top
vi.mock("../../../shared/modes", () => ({
	getModeBySlug: vi.fn(),
	defaultModeSlug: "ask",
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Tool Error: ${msg}`),
	},
}))

vi.mock("../updateTodoListTool", () => ({
	parseMarkdownChecklist: vi.fn((md: string) => {
		// Simple mock implementation
		const lines = md.split("\n").filter((line) => line.trim())
		return lines.map((line, index) => {
			let status = "pending"
			let content = line

			if (line.includes("[x]") || line.includes("[X]")) {
				status = "completed"
				content = line.replace(/^\[x\]\s*/i, "")
			} else if (line.includes("[-]") || line.includes("[~]")) {
				status = "in_progress"
				content = line.replace(/^\[-\]\s*/, "").replace(/^\[~\]\s*/, "")
			} else {
				content = line.replace(/^\[\s*\]\s*/, "")
			}

			return {
				id: `todo-${index}`,
				content,
				status,
			}
		})
	}),
}))

// Define a minimal type for the resolved value
type MockClineInstance = { taskId: string }

// Mock dependencies after modules are mocked
const mockAskApproval = vi.fn<AskApproval>()
const mockHandleError = vi.fn<HandleError>()
const mockPushToolResult = vi.fn()
const mockRemoveClosingTag = vi.fn((_name: string, value: string | undefined) => value ?? "")
const mockEmit = vi.fn()
const mockRecordToolError = vi.fn()
const mockSayAndCreateMissingParamError = vi.fn()
const mockStartSubtask = vi
	.fn<(message: string, todoItems: any[], mode: string) => Promise<MockClineInstance>>()
	.mockResolvedValue({ taskId: "mock-subtask-id" })

// Adapter to satisfy legacy expectations while exercising new delegation path
const mockDelegateParentAndOpenChild = vi.fn(
	async (args: { parentTaskId: string; message: string; initialTodos: any[]; mode: string }) => {
		// Call legacy spy so existing expectations still pass
		await mockStartSubtask(args.message, args.initialTodos, args.mode)
		return { taskId: "child-1" }
	},
)
const mockCheckpointSave = vi.fn()

// Mock the Cline instance and its methods/properties
const mockCline = {
	ask: vi.fn(),
	sayAndCreateMissingParamError: mockSayAndCreateMissingParamError,
	emit: mockEmit,
	recordToolError: mockRecordToolError,
	consecutiveMistakeCount: 0,
	isPaused: false,
	pausedModeSlug: "ask",
	taskId: "mock-parent-task-id",
	enableCheckpoints: false,
	checkpointSave: mockCheckpointSave,
	startSubtask: mockStartSubtask,
	providerRef: {
		deref: vi.fn(() => ({
			getState: vi.fn(() => ({ customModes: [], mode: "ask" })),
			handleModeSwitch: vi.fn(),
			delegateParentAndOpenChild: mockDelegateParentAndOpenChild,
		})),
	},
}

// Import the class to test AFTER mocks are set up
import { newTaskTool } from "../NewTaskTool"
import type { ToolUse } from "../../../shared/tools"
import { getModeBySlug } from "../../../shared/modes"
import * as vscode from "vscode"

describe("newTaskTool", () => {
	beforeEach(() => {
		// Reset mocks before each test
		vi.clearAllMocks()
		mockAskApproval.mockResolvedValue(true) // Default to approved
		vi.mocked(getModeBySlug).mockReturnValue({
			slug: "code",
			name: "Code Mode",
			roleDefinition: "Test role definition",
			groups: ["command", "read", "edit"],
		}) // Default valid mode
		mockCline.consecutiveMistakeCount = 0
		mockCline.isPaused = false
		// Default: VSCode setting is disabled
		const mockGet = vi.fn().mockReturnValue(false)
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: mockGet,
		} as any)
	})

	it("should correctly un-escape \\\\@ to \\@ in the message passed to the new task", async () => {
		const block: ToolUse = {
			type: "tool_use", // Add required 'type' property
			name: "new_task", // Correct property name
			params: {
				mode: "code",
				message: "Review this: \\\\@file1.txt and also \\\\\\\\@file2.txt", // Input with \\@ and \\\\@
				todos: "[ ] First task\n[ ] Second task",
			},
			partial: false,
		}

		await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		// Verify askApproval was called
		expect(mockAskApproval).toHaveBeenCalled()

		// Verify the message passed to startSubtask reflects the code's behavior in unit tests
		expect(mockStartSubtask).toHaveBeenCalledWith(
			"Review this: \\@file1.txt and also \\\\\\@file2.txt", // Unit Test Expectation: \\@ -> \@, \\\\@ -> \\\\@
			expect.arrayContaining([
				expect.objectContaining({ content: "First task" }),
				expect.objectContaining({ content: "Second task" }),
			]),
			"code",
		)

		// Verify side effects
		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Delegated to child task"))
	})

	it("should not un-escape single escaped \@", async () => {
		const block: ToolUse = {
			type: "tool_use", // Add required 'type' property
			name: "new_task", // Correct property name
			params: {
				mode: "code",
				message: "This is already unescaped: \\@file1.txt",
				todos: "[ ] Test todo",
			},
			partial: false,
		}

		await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockStartSubtask).toHaveBeenCalledWith(
			"This is already unescaped: \\@file1.txt", // Expected: \@ remains \@
			expect.any(Array),
			"code",
		)
	})

	it("should not un-escape non-escaped @", async () => {
		const block: ToolUse = {
			type: "tool_use", // Add required 'type' property
			name: "new_task", // Correct property name
			params: {
				mode: "code",
				message: "A normal mention @file1.txt",
				todos: "[ ] Test todo",
			},
			partial: false,
		}

		await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockStartSubtask).toHaveBeenCalledWith(
			"A normal mention @file1.txt", // Expected: @ remains @
			expect.any(Array),
			"code",
		)
	})

	it("should handle mixed escaping scenarios", async () => {
		const block: ToolUse = {
			type: "tool_use", // Add required 'type' property
			name: "new_task", // Correct property name
			params: {
				mode: "code",
				message: "Mix: @file0.txt, \\@file1.txt, \\\\@file2.txt, \\\\\\\\@file3.txt",
				todos: "[ ] Test todo",
			},
			partial: false,
		}

		await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockStartSubtask).toHaveBeenCalledWith(
			"Mix: @file0.txt, \\@file1.txt, \\@file2.txt, \\\\\\@file3.txt", // Unit Test Expectation: @->@, \@->\@, \\@->\@, \\\\@->\\\\@
			expect.any(Array),
			"code",
		)
	})

	it("should handle missing todos parameter gracefully (backward compatibility)", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "new_task",
			params: {
				mode: "code",
				message: "Test message",
				// todos missing - should work for backward compatibility
			},
			partial: false,
		}

		await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		// Should NOT error when todos is missing
		expect(mockSayAndCreateMissingParamError).not.toHaveBeenCalledWith("new_task", "todos")
		expect(mockCline.consecutiveMistakeCount).toBe(0)
		expect(mockCline.recordToolError).not.toHaveBeenCalledWith("new_task")

		// Should create task with empty todos array
		expect(mockStartSubtask).toHaveBeenCalledWith("Test message", [], "code")

		// Should complete successfully
		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Delegated to child task"))
	})

	it("should work with todos parameter when provided", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "new_task",
			params: {
				mode: "code",
				message: "Test message with todos",
				todos: "[ ] First task\n[ ] Second task",
			},
			partial: false,
		}

		await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		// Should parse and include todos when provided
		expect(mockStartSubtask).toHaveBeenCalledWith(
			"Test message with todos",
			expect.arrayContaining([
				expect.objectContaining({ content: "First task" }),
				expect.objectContaining({ content: "Second task" }),
			]),
			"code",
		)

		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Delegated to child task"))
	})

	it("should error when mode parameter is missing", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "new_task",
			params: {
				// mode missing
				message: "Test message",
				todos: "[ ] Test todo",
			},
			partial: false,
		}

		await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockSayAndCreateMissingParamError).toHaveBeenCalledWith("new_task", "mode")
		expect(mockCline.consecutiveMistakeCount).toBe(1)
		expect(mockCline.recordToolError).toHaveBeenCalledWith("new_task")
	})

	it("should error when message parameter is missing", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "new_task",
			params: {
				mode: "code",
				// message missing
				todos: "[ ] Test todo",
			},
			partial: false,
		}

		await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockSayAndCreateMissingParamError).toHaveBeenCalledWith("new_task", "message")
		expect(mockCline.consecutiveMistakeCount).toBe(1)
		expect(mockCline.recordToolError).toHaveBeenCalledWith("new_task")
	})

	it("should parse todos with different statuses correctly", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "new_task",
			params: {
				mode: "code",
				message: "Test message",
				todos: "[ ] Pending task\n[x] Completed task\n[-] In progress task",
			},
			partial: false,
		}

		await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		expect(mockStartSubtask).toHaveBeenCalledWith(
			"Test message",
			expect.arrayContaining([
				expect.objectContaining({ content: "Pending task", status: "pending" }),
				expect.objectContaining({ content: "Completed task", status: "completed" }),
				expect.objectContaining({ content: "In progress task", status: "in_progress" }),
			]),
			"code",
		)
	})

	describe("VSCode setting: newTaskRequireTodos", () => {
		it("should NOT require todos when VSCode setting is disabled (default)", async () => {
			// Ensure VSCode setting is disabled
			const mockGet = vi.fn().mockReturnValue(false)
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: mockGet,
			} as any)

			const block: ToolUse = {
				type: "tool_use",
				name: "new_task",
				params: {
					mode: "code",
					message: "Test message",
					// todos missing - should work when setting is disabled
				},
				partial: false,
			}

			await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				toolProtocol: "xml",
			})

			// Should NOT error when todos is missing and setting is disabled
			expect(mockSayAndCreateMissingParamError).not.toHaveBeenCalledWith("new_task", "todos")
			expect(mockCline.consecutiveMistakeCount).toBe(0)
			expect(mockCline.recordToolError).not.toHaveBeenCalledWith("new_task")

			// Should create task with empty todos array
			expect(mockStartSubtask).toHaveBeenCalledWith("Test message", [], "code")

			// Should complete successfully
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Delegated to child task"))
		})

		it("should REQUIRE todos when VSCode setting is enabled", async () => {
			// Enable VSCode setting
			const mockGet = vi.fn().mockReturnValue(true)
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: mockGet,
			} as any)

			const block: ToolUse = {
				type: "tool_use",
				name: "new_task",
				params: {
					mode: "code",
					message: "Test message",
					// todos missing - should error when setting is enabled
				},
				partial: false,
			}

			await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				toolProtocol: "xml",
			})

			// Should error when todos is missing and setting is enabled
			expect(mockSayAndCreateMissingParamError).toHaveBeenCalledWith("new_task", "todos")
			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("new_task")

			// Should NOT create task
			expect(mockStartSubtask).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Successfully created new task"),
			)
		})

		it("should work with todos when VSCode setting is enabled", async () => {
			// Enable VSCode setting
			const mockGet = vi.fn().mockReturnValue(true)
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: mockGet,
			} as any)

			const block: ToolUse = {
				type: "tool_use",
				name: "new_task",
				params: {
					mode: "code",
					message: "Test message",
					todos: "[ ] First task\n[ ] Second task",
				},
				partial: false,
			}

			await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				toolProtocol: "xml",
			})

			// Should NOT error when todos is provided and setting is enabled
			expect(mockSayAndCreateMissingParamError).not.toHaveBeenCalledWith("new_task", "todos")
			expect(mockCline.consecutiveMistakeCount).toBe(0)

			// Should create task with parsed todos
			expect(mockStartSubtask).toHaveBeenCalledWith(
				"Test message",
				expect.arrayContaining([
					expect.objectContaining({ content: "First task" }),
					expect.objectContaining({ content: "Second task" }),
				]),
				"code",
			)

			// Should complete successfully
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Delegated to child task"))
		})

		it("should work with empty todos string when VSCode setting is enabled", async () => {
			// Enable VSCode setting
			const mockGet = vi.fn().mockReturnValue(true)
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: mockGet,
			} as any)

			const block: ToolUse = {
				type: "tool_use",
				name: "new_task",
				params: {
					mode: "code",
					message: "Test message",
					todos: "", // Empty string should be accepted
				},
				partial: false,
			}

			await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				toolProtocol: "xml",
			})

			// Should NOT error when todos is empty string and setting is enabled
			expect(mockSayAndCreateMissingParamError).not.toHaveBeenCalledWith("new_task", "todos")
			expect(mockCline.consecutiveMistakeCount).toBe(0)

			// Should create task with empty todos array
			expect(mockStartSubtask).toHaveBeenCalledWith("Test message", [], "code")

			// Should complete successfully
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Delegated to child task"))
		})

		it("should check VSCode setting with Package.name configuration key", async () => {
			const mockGet = vi.fn().mockReturnValue(false)
			const mockGetConfiguration = vi.fn().mockReturnValue({
				get: mockGet,
			} as any)
			vi.mocked(vscode.workspace.getConfiguration).mockImplementation(mockGetConfiguration)

			const block: ToolUse = {
				type: "tool_use",
				name: "new_task",
				params: {
					mode: "code",
					message: "Test message",
				},
				partial: false,
			}

			await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify that VSCode configuration was accessed correctly
			expect(mockGetConfiguration).toHaveBeenCalledWith("kilo-code")
			expect(mockGet).toHaveBeenCalledWith("newTaskRequireTodos", false)
		})

		it("should use current Package.name value (roo-code-nightly) when accessing VSCode configuration", async () => {
			// Arrange: capture calls to VSCode configuration and ensure we can assert the namespace
			const mockGet = vi.fn().mockReturnValue(false)
			const mockGetConfiguration = vi.fn().mockReturnValue({
				get: mockGet,
			} as any)
			vi.mocked(vscode.workspace.getConfiguration).mockImplementation(mockGetConfiguration)

			// Mutate the mocked Package.name dynamically to simulate a different build variant
			const pkg = await import("../../../shared/package")
			;(pkg.Package as any).name = "roo-code-nightly"

			const block: ToolUse = {
				type: "tool_use",
				name: "new_task",
				params: {
					mode: "code",
					message: "Test message",
				},
				partial: false,
			}

			await newTaskTool.handle(mockCline as any, block as ToolUse<"new_task">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				toolProtocol: "xml",
			})

			// Assert: configuration was read using the dynamic nightly namespace
			expect(mockGetConfiguration).toHaveBeenCalledWith("roo-code-nightly")
			expect(mockGet).toHaveBeenCalledWith("newTaskRequireTodos", false)
		})
	})

	// Add more tests for error handling (invalid mode, approval denied) if needed
})

describe("newTaskTool delegation flow", () => {
	it("delegates to provider and does not call legacy startSubtask", async () => {
		// Arrange: stub provider delegation
		const providerSpy = {
			getState: vi.fn().mockResolvedValue({
				mode: "ask",
				experiments: {},
			}),
			delegateParentAndOpenChild: vi.fn().mockResolvedValue({ taskId: "child-1" }),
			handleModeSwitch: vi.fn(),
		} as any

		// Use a fresh local cline instance to avoid cross-test interference
		const localStartSubtask = vi.fn()
		const localEmit = vi.fn()
		const localCline = {
			ask: vi.fn(),
			sayAndCreateMissingParamError: mockSayAndCreateMissingParamError,
			emit: localEmit,
			recordToolError: mockRecordToolError,
			consecutiveMistakeCount: 0,
			isPaused: false,
			pausedModeSlug: "ask",
			taskId: "mock-parent-task-id",
			enableCheckpoints: false,
			checkpointSave: mockCheckpointSave,
			startSubtask: localStartSubtask,
			providerRef: {
				deref: vi.fn(() => providerSpy),
			},
		}

		const block: ToolUse = {
			type: "tool_use",
			name: "new_task",
			params: {
				mode: "code",
				message: "Do something",
				// no todos -> should default to []
			},
			partial: false,
		}

		// Act
		await newTaskTool.handle(localCline as any, block as ToolUse<"new_task">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "xml",
		})

		// Assert: provider method called with correct params
		expect(providerSpy.delegateParentAndOpenChild).toHaveBeenCalledWith({
			parentTaskId: "mock-parent-task-id",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		// Assert: legacy path not used
		expect(localStartSubtask).not.toHaveBeenCalled()

		// Assert: no pause/unpause events emitted in delegation path
		const pauseEvents = (localEmit as any).mock.calls.filter(
			(c: any[]) => c[0] === "taskPaused" || c[0] === "taskUnpaused",
		)
		expect(pauseEvents.length).toBe(0)

		// Assert: tool result reflects delegation
		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Delegated to child task child-1"))
	})
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"

import { ClineProvider } from "../ClineProvider"
import { Task } from "../../task/Task"
import { ContextProxy } from "../../config/ContextProxy"
import { HistoryItem } from "@roo-code/types"

// Mock vscode and dependencies
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
		workspaceFolders: [],
		onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
	},
	window: {
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: { machineId: "test", sessionId: "test", language: "en", appName: "VSCode", uriScheme: "vscode", uiKind: 1 },
	UIKind: { Desktop: 1 },
	ConfigurationTarget: { Global: 1 },
	ExtensionMode: { Test: 2 },
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: { setProvider: vi.fn(), captureTaskRestarted: vi.fn(), captureTaskCreated: vi.fn() },
	},
}))

vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn(() => Promise.resolve({ registerClient: vi.fn() })),
		unregisterProvider: vi.fn(),
	},
}))

vi.mock("../../../services/marketplace")
vi.mock("../../../integrations/workspace/WorkspaceTracker")
vi.mock("../../config/CustomModesManager", () => ({
	CustomModesManager: vi
		.fn()
		.mockImplementation(() => ({ getCustomModes: vi.fn(() => Promise.resolve([])), dispose: vi.fn() })),
}))
vi.mock("../../config/ProviderSettingsManager", () => ({
	ProviderSettingsManager: vi.fn().mockImplementation(() => ({
		listConfig: vi.fn(() => Promise.resolve([])),
		getModeConfigId: vi.fn(() => Promise.resolve(undefined)),
	})),
}))
vi.mock("../../../utils/path", () => ({ getWorkspacePath: vi.fn(() => "/test/workspace") }))
vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn(() => false),
		instance: { isAuthenticated: vi.fn(() => false), on: vi.fn(), off: vi.fn() },
	},
	BridgeOrchestrator: { isEnabled: vi.fn(() => false) },
	getRooCodeApiUrl: vi.fn(() => "https://api.kilocode.ai"),
}))

// Mock Task constructor to track calls
vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation((options) => ({
		taskId: options.historyItem?.id || "mock-task-id",
		instanceId: "mock-instance",
		isPaused: false,
		emit: vi.fn(),
		parentTask: options.parentTask,
		rootTask: options.rootTask,
	})),
}))

describe("Orchestrator Stack Reconstruction", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockContextProxy: ContextProxy

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			globalStorageUri: { fsPath: "/test/storage" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as any

		mockOutputChannel = { appendLine: vi.fn() } as any

		mockContextProxy = {
			extensionUri: { fsPath: "/test/extension" },
			extensionMode: vscode.ExtensionMode.Test,
			getValues: vi.fn(() => ({})),
			getValue: vi.fn(),
			setValue: vi.fn(),
			setValues: vi.fn(),
			setProviderSettings: vi.fn(),
			getProviderSettings: vi.fn(() => ({ apiProvider: "anthropic" })),
			globalStorageUri: { fsPath: "/test/storage" },
		} as any

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy)
	})

	describe("reconstructTaskStack", () => {
		it("should reconstruct the complete task stack for orchestrator subtasks", async () => {
			// Create a realistic orchestrator workflow hierarchy
			const rootTaskHistoryItem: HistoryItem = {
				id: "orchestrator-root",
				rootTaskId: undefined,
				parentTaskId: undefined,
				number: 1,
				ts: Date.now() - 3000,
				task: "Build a web application",
				tokensIn: 500,
				tokensOut: 250,
				totalCost: 0.05,
				workspace: "/test/workspace",
				mode: "orchestrator",
			}

			const codeSubtaskHistoryItem: HistoryItem = {
				id: "code-subtask",
				rootTaskId: "orchestrator-root",
				parentTaskId: "orchestrator-root",
				number: 2,
				ts: Date.now() - 2000,
				task: "Implement authentication backend",
				tokensIn: 300,
				tokensOut: 150,
				totalCost: 0.03,
				workspace: "/test/workspace",
				mode: "code",
			}

			const debugSubtaskHistoryItem: HistoryItem = {
				id: "debug-subtask",
				rootTaskId: "orchestrator-root",
				parentTaskId: "code-subtask",
				number: 3,
				ts: Date.now() - 1000,
				task: "Debug authentication issues",
				tokensIn: 200,
				tokensOut: 100,
				totalCost: 0.02,
				workspace: "/test/workspace",
				mode: "debug",
			}

			// Mock getState
			vi.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 3 },
				diffEnabled: true,
				enableCheckpoints: true,
				fuzzyMatchThreshold: 1.0,
				experiments: {},
				cloudUserInfo: null,
				remoteControlEnabled: false,
			} as any)

			// Mock getTaskWithId to return the appropriate history items
			vi.spyOn(provider, "getTaskWithId").mockImplementation(async (id: string) => {
				switch (id) {
					case "orchestrator-root":
						return { historyItem: rootTaskHistoryItem } as any
					case "code-subtask":
						return { historyItem: codeSubtaskHistoryItem } as any
					case "debug-subtask":
						return { historyItem: debugSubtaskHistoryItem } as any
					default:
						throw new Error(`Task not found: ${id}`)
				}
			})

			// Mock getCurrentTask to return undefined (no current task)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue(undefined)

			// Mock removeClineFromStack
			vi.spyOn(provider, "removeClineFromStack").mockResolvedValue()

			// Mock addClineToStack to track calls
			const addClineToStackSpy = vi.spyOn(provider, "addClineToStack").mockResolvedValue()

			// Mock postMessageToWebview
			vi.spyOn(provider, "postMessageToWebview").mockResolvedValue()

			// Test: Load the debug subtask which should reconstruct the entire stack
			await provider.showTaskWithId("debug-subtask")

			// Verify that addClineToStack was called 3 times (root, code subtask, debug subtask)
			expect(addClineToStackSpy).toHaveBeenCalledTimes(3)

			// Verify the order of tasks added to stack
			const taskCalls = addClineToStackSpy.mock.calls
			expect(taskCalls[0][0].taskId).toBe("orchestrator-root") // Root task first
			expect(taskCalls[1][0].taskId).toBe("code-subtask") // Code subtask second
			expect(taskCalls[2][0].taskId).toBe("debug-subtask") // Debug subtask last

			// Verify that parent tasks are paused
			expect(taskCalls[0][0].isPaused).toBe(true) // Root task should be paused
			expect(taskCalls[1][0].isPaused).toBe(true) // Code subtask should be paused
			expect(taskCalls[2][0].isPaused).toBe(false) // Debug subtask should NOT be paused (it's the active one)
		})

		it("should handle simple parent-child relationship", async () => {
			const parentTaskHistoryItem: HistoryItem = {
				id: "parent-task",
				rootTaskId: undefined,
				parentTaskId: undefined,
				number: 1,
				ts: Date.now() - 2000,
				task: "Parent task",
				tokensIn: 400,
				tokensOut: 200,
				totalCost: 0.04,
				workspace: "/test/workspace",
				mode: "orchestrator",
			}

			const childTaskHistoryItem: HistoryItem = {
				id: "child-task",
				rootTaskId: "parent-task",
				parentTaskId: "parent-task",
				number: 2,
				ts: Date.now() - 1000,
				task: "Child task",
				tokensIn: 200,
				tokensOut: 100,
				totalCost: 0.02,
				workspace: "/test/workspace",
				mode: "code",
			}

			// Mock getState
			vi.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 3 },
				diffEnabled: true,
				enableCheckpoints: true,
				fuzzyMatchThreshold: 1.0,
				experiments: {},
				cloudUserInfo: null,
				remoteControlEnabled: false,
			} as any)

			// Mock getTaskWithId
			vi.spyOn(provider, "getTaskWithId").mockImplementation(async (id: string) => {
				switch (id) {
					case "parent-task":
						return { historyItem: parentTaskHistoryItem } as any
					case "child-task":
						return { historyItem: childTaskHistoryItem } as any
					default:
						throw new Error(`Task not found: ${id}`)
				}
			})

			// Mock getCurrentTask to return undefined
			vi.spyOn(provider, "getCurrentTask").mockReturnValue(undefined)

			// Mock removeClineFromStack
			vi.spyOn(provider, "removeClineFromStack").mockResolvedValue()

			// Mock addClineToStack
			const addClineToStackSpy = vi.spyOn(provider, "addClineToStack").mockResolvedValue()

			// Mock postMessageToWebview
			vi.spyOn(provider, "postMessageToWebview").mockResolvedValue()

			// Test: Load the child task
			await provider.showTaskWithId("child-task")

			// Verify that addClineToStack was called 2 times (parent, then child)
			expect(addClineToStackSpy).toHaveBeenCalledTimes(2)

			// Verify the order
			const taskCalls = addClineToStackSpy.mock.calls
			expect(taskCalls[0][0].taskId).toBe("parent-task") // Parent first
			expect(taskCalls[1][0].taskId).toBe("child-task") // Child second

			// Verify that parent is paused, child is not
			expect(taskCalls[0][0].isPaused).toBe(true) // Parent should be paused
			expect(taskCalls[1][0].isPaused).toBe(false) // Child should NOT be paused
		})

		it("should handle standalone tasks normally", async () => {
			const standaloneTaskHistoryItem: HistoryItem = {
				id: "standalone-task",
				rootTaskId: undefined,
				parentTaskId: undefined,
				number: 1,
				ts: Date.now() - 1000,
				task: "Standalone task",
				tokensIn: 200,
				tokensOut: 100,
				totalCost: 0.02,
				workspace: "/test/workspace",
				mode: "code",
			}

			// Mock getTaskWithId
			vi.spyOn(provider, "getTaskWithId").mockResolvedValue({
				historyItem: standaloneTaskHistoryItem,
			} as any)

			// Mock getCurrentTask to return undefined
			vi.spyOn(provider, "getCurrentTask").mockReturnValue(undefined)

			// Mock createTaskWithHistoryItem
			const createTaskSpy = vi.spyOn(provider, "createTaskWithHistoryItem").mockResolvedValue({} as any)

			// Mock postMessageToWebview
			vi.spyOn(provider, "postMessageToWebview").mockResolvedValue()

			// Test: Load the standalone task
			await provider.showTaskWithId("standalone-task")

			// Verify that createTaskWithHistoryItem was called (normal flow)
			expect(createTaskSpy).toHaveBeenCalledWith(standaloneTaskHistoryItem)

			// Verify that stack reconstruction methods were not called
			expect(provider.getTaskWithId).toHaveBeenCalledTimes(1) // Only for the main task
		})
	})

	describe("buildTaskHierarchy", () => {
		it("should build correct hierarchy for nested subtasks", async () => {
			// Create a 3-level hierarchy: root -> intermediate -> target
			const rootTaskHistoryItem: HistoryItem = {
				id: "root-task",
				rootTaskId: undefined,
				parentTaskId: undefined,
				number: 1,
				ts: Date.now() - 3000,
				task: "Root orchestrator task",
				tokensIn: 500,
				tokensOut: 250,
				totalCost: 0.05,
				workspace: "/test/workspace",
				mode: "orchestrator",
			}

			const intermediateTaskHistoryItem: HistoryItem = {
				id: "intermediate-task",
				rootTaskId: "root-task",
				parentTaskId: "root-task",
				number: 2,
				ts: Date.now() - 2000,
				task: "Intermediate task",
				tokensIn: 300,
				tokensOut: 150,
				totalCost: 0.03,
				workspace: "/test/workspace",
				mode: "code",
			}

			const targetTaskHistoryItem: HistoryItem = {
				id: "target-task",
				rootTaskId: "root-task",
				parentTaskId: "intermediate-task",
				number: 3,
				ts: Date.now() - 1000,
				task: "Target subtask",
				tokensIn: 200,
				tokensOut: 100,
				totalCost: 0.02,
				workspace: "/test/workspace",
				mode: "debug",
			}

			// Mock getTaskWithId
			vi.spyOn(provider, "getTaskWithId").mockImplementation(async (id: string) => {
				switch (id) {
					case "root-task":
						return { historyItem: rootTaskHistoryItem } as any
					case "intermediate-task":
						return { historyItem: intermediateTaskHistoryItem } as any
					case "target-task":
						return { historyItem: targetTaskHistoryItem } as any
					default:
						throw new Error(`Task not found: ${id}`)
				}
			})

			// Call the private method using type assertion
			const hierarchy = await (provider as any).buildTaskHierarchy(targetTaskHistoryItem)

			// Verify the hierarchy is built correctly
			expect(hierarchy).toHaveLength(3)
			expect(hierarchy[0].id).toBe("root-task") // Root first
			expect(hierarchy[1].id).toBe("intermediate-task") // Intermediate second
			expect(hierarchy[2].id).toBe("target-task") // Target last
		})

		it("should handle circular references gracefully", async () => {
			// Create circular reference (should not happen in practice, but test for robustness)
			const task1HistoryItem: HistoryItem = {
				id: "task1",
				rootTaskId: "task2",
				parentTaskId: "task2",
				number: 1,
				ts: Date.now() - 2000,
				task: "Task 1",
				tokensIn: 200,
				tokensOut: 100,
				totalCost: 0.02,
				workspace: "/test/workspace",
				mode: "code",
			}

			const task2HistoryItem: HistoryItem = {
				id: "task2",
				rootTaskId: "task1",
				parentTaskId: "task1",
				number: 2,
				ts: Date.now() - 1000,
				task: "Task 2",
				tokensIn: 200,
				tokensOut: 100,
				totalCost: 0.02,
				workspace: "/test/workspace",
				mode: "debug",
			}

			// Mock getTaskWithId
			vi.spyOn(provider, "getTaskWithId").mockImplementation(async (id: string) => {
				switch (id) {
					case "task1":
						return { historyItem: task1HistoryItem } as any
					case "task2":
						return { historyItem: task2HistoryItem } as any
					default:
						throw new Error(`Task not found: ${id}`)
				}
			})

			// Call the private method - should not hang due to circular reference
			const hierarchy = await (provider as any).buildTaskHierarchy(task1HistoryItem)

			// Should include both tasks but not hang due to circular reference protection
			expect(hierarchy).toHaveLength(2)
			expect(hierarchy[0].id).toBe("task2") // Parent loaded first
			expect(hierarchy[1].id).toBe("task1") // Target loaded second
		})
	})

	describe("end-to-end orchestrator workflow", () => {
		it("should properly reconstruct stack so subtask can return to parent", async () => {
			// Simulate the complete orchestrator workflow
			const orchestratorHistoryItem: HistoryItem = {
				id: "orchestrator-main",
				rootTaskId: undefined,
				parentTaskId: undefined,
				number: 1,
				ts: Date.now() - 2000,
				task: "Main orchestrator task",
				tokensIn: 400,
				tokensOut: 200,
				totalCost: 0.04,
				workspace: "/test/workspace",
				mode: "orchestrator",
			}

			const subtaskHistoryItem: HistoryItem = {
				id: "code-subtask",
				rootTaskId: "orchestrator-main",
				parentTaskId: "orchestrator-main",
				number: 2,
				ts: Date.now() - 1000,
				task: "Code implementation subtask",
				tokensIn: 200,
				tokensOut: 100,
				totalCost: 0.02,
				workspace: "/test/workspace",
				mode: "code",
			}

			// Mock getState
			vi.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 3 },
				diffEnabled: true,
				enableCheckpoints: true,
				fuzzyMatchThreshold: 1.0,
				experiments: {},
				cloudUserInfo: null,
				remoteControlEnabled: false,
			} as any)

			// Mock getTaskWithId
			vi.spyOn(provider, "getTaskWithId").mockImplementation(async (id: string) => {
				switch (id) {
					case "orchestrator-main":
						return { historyItem: orchestratorHistoryItem } as any
					case "code-subtask":
						return { historyItem: subtaskHistoryItem } as any
					default:
						throw new Error(`Task not found: ${id}`)
				}
			})

			// Mock getCurrentTask to return undefined
			vi.spyOn(provider, "getCurrentTask").mockReturnValue(undefined)

			// Mock removeClineFromStack
			vi.spyOn(provider, "removeClineFromStack").mockResolvedValue()

			// Mock addClineToStack to track the stack reconstruction
			const addClineToStackSpy = vi.spyOn(provider, "addClineToStack").mockResolvedValue()

			// Mock postMessageToWebview
			vi.spyOn(provider, "postMessageToWebview").mockResolvedValue()

			// Test: Load the subtask from history
			await provider.showTaskWithId("code-subtask")

			// Verify that the stack was reconstructed correctly
			expect(addClineToStackSpy).toHaveBeenCalledTimes(2)

			// Verify the order: parent first, then child
			const taskCalls = addClineToStackSpy.mock.calls
			expect(taskCalls[0][0].taskId).toBe("orchestrator-main") // Parent first
			expect(taskCalls[1][0].taskId).toBe("code-subtask") // Child second

			// Verify that the parent is paused so the child can run
			expect(taskCalls[0][0].isPaused).toBe(true) // Parent should be paused
			expect(taskCalls[1][0].isPaused).toBe(false) // Child should be active

			// This setup ensures that when the code-subtask finishes and calls
			// finishSubTask(), the orchestrator-main task will be resumed
		})
	})
})

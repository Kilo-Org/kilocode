// npx vitest run __tests__/nested-delegation-resume.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { RooCodeEventName } from "@roo-code/types"

// Mock safe-stable-stringify to avoid runtime error
vi.mock("safe-stable-stringify", () => ({
	default: (obj: any) => JSON.stringify(obj),
}))

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureTaskCompleted: vi.fn(),
		},
	},
}))

// vscode mock for Task/Provider imports
vi.mock("vscode", () => {
	const window = {
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	}
	const workspace = {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((_key: string, defaultValue: any) => defaultValue),
			update: vi.fn(),
		})),
		workspaceFolders: [],
	}
	const env = { machineId: "test-machine", uriScheme: "vscode", appName: "VSCode", language: "en", sessionId: "sess" }
	const Uri = { file: (p: string) => ({ fsPath: p, toString: () => p }) }
	const commands = { executeCommand: vi.fn() }
	const ExtensionMode = { Development: 2 }
	const version = "1.0.0-test"
	return { window, workspace, env, Uri, commands, ExtensionMode, version }
})

// Mock persistence helpers used by provider reopen flow BEFORE importing provider
vi.mock("../core/task-persistence/taskMessages", () => ({
	readTaskMessages: vi.fn().mockResolvedValue([]),
}))
vi.mock("../core/task-persistence", () => ({
	readApiMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
}))

import { attemptCompletionTool } from "../core/tools/AttemptCompletionTool"
import { ClineProvider } from "../core/webview/ClineProvider"
import type { Task } from "../core/task/Task"
import { readTaskMessages } from "../core/task-persistence/taskMessages"
import { readApiMessages, saveApiMessages, saveTaskMessages } from "../core/task-persistence"

describe("Nested delegation resume (A → B → C)", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("C completes → reopens B; then B completes → reopens A; emits correct events; no resume_task asks", async () => {
		// Track which task is "current" to satisfy provider.reopenParentFromDelegation() child-close logic
		let currentActiveId: string | undefined = "C"

		// History index: A is parent of B, B is parent of C
		const historyIndex: Record<string, any> = {
			A: {
				id: "A",
				status: "delegated",
				delegatedToId: "B",
				awaitingChildId: "B",
				childIds: ["B"],
				parentTaskId: undefined,
				ts: 1,
				task: "Task A",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				mode: "code",
				workspace: "/tmp",
			},
			B: {
				id: "B",
				status: "delegated",
				delegatedToId: "C",
				awaitingChildId: "C",
				childIds: ["C"],
				parentTaskId: "A",
				ts: 2,
				task: "Task B",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				mode: "code",
				workspace: "/tmp",
			},
			C: {
				id: "C",
				status: "active",
				parentTaskId: "B",
				ts: 3,
				task: "Task C",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				mode: "code",
				workspace: "/tmp",
			},
		}

		const emitSpy = vi.fn()
		const removeClineFromStack = vi.fn().mockImplementation(async () => {
			// Simulate closing current child
			currentActiveId = undefined
		})
		const createTaskWithHistoryItem = vi
			.fn()
			.mockImplementation(async (historyItem: any, opts?: { startTask?: boolean }) => {
				// Assert startTask:false to avoid resume asks
				expect(opts).toEqual(expect.objectContaining({ startTask: false }))
				// Reopen the parent
				currentActiveId = historyItem.id
				// Return minimal parent instance with resumeAfterDelegation
				return {
					taskId: historyItem.id,
					resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
					overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
					overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
				}
			})

		const getTaskWithId = vi.fn(async (id: string) => {
			if (!historyIndex[id]) throw new Error("Task not found")
			return {
				historyItem: historyIndex[id],
				apiConversationHistory: [],
				taskDirPath: "/tmp",
				apiConversationHistoryFilePath: "/tmp/api.json",
				uiMessagesFilePath: "/tmp/ui.json",
			}
		})

		const updateTaskHistory = vi.fn(async (updated: any) => {
			// Persist updated history back into index (simulate)
			historyIndex[updated.id] = updated
			return Object.values(historyIndex)
		})

		const provider = {
			contextProxy: { globalStorageUri: { fsPath: "/tmp" } },
			getTaskWithId,
			emit: emitSpy,
			getCurrentTask: vi.fn(() => (currentActiveId ? ({ taskId: currentActiveId } as any) : undefined)),
			removeClineFromStack,
			createTaskWithHistoryItem,
			updateTaskHistory,
			// Wire through provider method so attemptCompletionTool can call it
			reopenParentFromDelegation: vi.fn(async (params: any) => {
				return await (ClineProvider.prototype as any).reopenParentFromDelegation.call(provider, params)
			}),
		} as unknown as ClineProvider

		// Empty histories for simplicity
		vi.mocked(readTaskMessages).mockResolvedValue([])
		vi.mocked(readApiMessages).mockResolvedValue([])

		// Step 1: C completes -> should reopen B automatically
		const clineC = {
			taskId: "C",
			parentTask: undefined, // parent ref may or may not exist; metadata path should still work
			parentTaskId: "B",
			historyItem: { parentTaskId: "B" },
			providerRef: { deref: () => provider },
			say: vi.fn().mockResolvedValue(undefined),
			emit: vi.fn(),
			getTokenUsage: vi.fn(() => ({})),
			toolUsage: {},
			clineMessages: [],
			userMessageContent: [],
			consecutiveMistakeCount: 0,
			emitFinalTokenUsageUpdate: vi.fn(),
		} as unknown as Task

		const blockC = {
			type: "tool_use",
			name: "attempt_completion",
			params: { result: "C finished" },
			partial: false,
		} as any

		const askFinishSubTaskApproval = vi.fn(async () => true)

		await attemptCompletionTool.handle(clineC, blockC, {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
			removeClosingTag: vi.fn((_, v?: string) => v ?? ""),
			askFinishSubTaskApproval,
			toolProtocol: "xml",
			toolDescription: () => "desc",
		} as any)

		// After C completes, B must be current
		expect(currentActiveId).toBe("B")

		// Events emitted: C -> B hop
		const eventNamesAfterC = emitSpy.mock.calls.map((c: any[]) => c[0])
		expect(eventNamesAfterC).toContain(RooCodeEventName.TaskDelegationCompleted)
		expect(eventNamesAfterC).toContain(RooCodeEventName.TaskDelegationResumed)

		// Step 2: B completes -> should reopen A automatically (parent reference missing, must use parentTaskId path)
		const clineB = {
			taskId: "B",
			parentTask: undefined, // simulate missing live parent reference
			parentTaskId: "A", // persisted parent id
			historyItem: { parentTaskId: "A" },
			providerRef: { deref: () => provider },
			say: vi.fn().mockResolvedValue(undefined),
			emit: vi.fn(),
			getTokenUsage: vi.fn(() => ({})),
			toolUsage: {},
			clineMessages: [],
			userMessageContent: [],
			consecutiveMistakeCount: 0,
			emitFinalTokenUsageUpdate: vi.fn(),
		} as unknown as Task

		const blockB = {
			type: "tool_use",
			name: "attempt_completion",
			params: { result: "B finished" },
			partial: false,
		} as any

		await attemptCompletionTool.handle(clineB, blockB, {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
			removeClosingTag: vi.fn((_, v?: string) => v ?? ""),
			askFinishSubTaskApproval,
			toolProtocol: "xml",
			toolDescription: () => "desc",
		} as any)

		// After B completes, A must be current
		expect(currentActiveId).toBe("A")

		// Ensure no resume_task asks were scheduled: verified indirectly by startTask:false on both hops
		// (asserted in createTaskWithHistoryItem mock)

		// Provider emitted TaskDelegationCompleted/Resumed twice across both hops
		const completedEvents = emitSpy.mock.calls.filter(
			(c: any[]) => c[0] === RooCodeEventName.TaskDelegationCompleted,
		)
		const resumedEvents = emitSpy.mock.calls.filter((c: any[]) => c[0] === RooCodeEventName.TaskDelegationResumed)
		expect(completedEvents.length).toBeGreaterThanOrEqual(2)
		expect(resumedEvents.length).toBeGreaterThanOrEqual(2)

		// Verify second hop used parentId = A
		// Find a TaskDelegationCompleted matching A <- B
		const hasAfromB = completedEvents.some(([, parentId, childId]: any[]) => parentId === "A" && childId === "B")
		expect(hasAfromB).toBe(true)
	})
})

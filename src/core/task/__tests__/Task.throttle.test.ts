import { RooCodeEventName, ProviderSettings, TokenUsage, ToolUsage } from "@roo-code/types"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { hasToolUsageChanged, hasTokenUsageChanged } from "../../../shared/getApiMetrics"

// Mock dependencies
vi.mock("../../webview/ClineProvider")
vi.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		releaseTerminalsForTask: vi.fn(),
	},
}))
vi.mock("../../ignore/RooIgnoreController")
vi.mock("../../protect/RooProtectedController")
vi.mock("../../context-tracking/FileContextTracker")
vi.mock("../../../services/browser/UrlContentFetcher")
vi.mock("../../../services/browser/BrowserSession")
vi.mock("../../../integrations/editor/DiffViewProvider")
vi.mock("../../tools/ToolRepetitionDetector")
vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(() => ({
		getModel: () => ({ info: {}, id: "test-model" }),
	})),
}))

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureTaskCreated: vi.fn(),
			captureTaskRestarted: vi.fn(),
		},
	},
}))

// Mock task persistence to avoid disk writes
vi.mock("../../task-persistence", () => ({
	readApiMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	readTaskMessages: vi.fn().mockResolvedValue([]),
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
	taskMetadata: vi.fn().mockResolvedValue({
		historyItem: {
			id: "test-task-id",
			number: 1,
			task: "Test task",
			ts: Date.now(),
			totalCost: 0.01,
			tokensIn: 100,
			tokensOut: 50,
		},
		tokenUsage: {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
			totalCacheWrites: 0,
			totalCacheReads: 0,
		},
	}),
}))

describe("Task token usage throttling", () => {
	let mockProvider: any
	let mockApiConfiguration: ProviderSettings
	let task: Task

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()
		vi.useFakeTimers()

		// Mock provider
		mockProvider = {
			context: {
				globalStorageUri: { fsPath: "/test/path" },
			},
			getState: vi.fn().mockResolvedValue({ mode: "code" }),
			log: vi.fn(),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
		}

		// Mock API configuration
		mockApiConfiguration = {
			apiProvider: "anthropic",
			apiKey: "test-key",
		} as ProviderSettings

		// Create task instance without starting it
		task = new Task({
			context: mockProvider.context,
			provider: mockProvider as ClineProvider,
			apiConfiguration: mockApiConfiguration,
			startTask: false,
		})
	})

	afterEach(() => {
		vi.useRealTimers()
		if (task && !task.abort) {
			task.dispose()
		}
	})

	test("should emit TaskTokenUsageUpdated immediately on first change", async () => {
		const emitSpy = vi.spyOn(task, "emit")

		// Add a message to trigger saveClineMessages
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Test message",
		})

		// Should emit immediately on first change
		expect(emitSpy).toHaveBeenCalledWith(
			RooCodeEventName.TaskTokenUsageUpdated,
			task.taskId,
			expect.any(Object),
			expect.any(Object),
		)
	})

	test("should throttle subsequent emissions within 2 seconds", async () => {
		const { taskMetadata } = await import("../../task-persistence")
		let callCount = 0

		// Mock to return different token usage on each call
		vi.mocked(taskMetadata).mockImplementation(async () => {
			callCount++
			return {
				historyItem: {
					id: "test-task-id",
					number: 1,
					task: "Test task",
					ts: Date.now(),
					totalCost: 0.01 * callCount,
					tokensIn: 100 * callCount,
					tokensOut: 50 * callCount,
				},
				tokenUsage: {
					totalTokensIn: 100 * callCount,
					totalTokensOut: 50 * callCount,
					totalCost: 0.01 * callCount,
					contextTokens: 150 * callCount,
					totalCacheWrites: 0,
					totalCacheReads: 0,
				},
			}
		})

		const emitSpy = vi.spyOn(task, "emit")

		// First message - should emit
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 1",
		})

		const firstEmitCount = emitSpy.mock.calls.filter(
			(call) => call[0] === RooCodeEventName.TaskTokenUsageUpdated,
		).length

		// Second message immediately after - should NOT emit due to throttle
		vi.advanceTimersByTime(500) // Advance only 500ms
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 2",
		})

		const secondEmitCount = emitSpy.mock.calls.filter(
			(call) => call[0] === RooCodeEventName.TaskTokenUsageUpdated,
		).length

		// Should still be the same count (throttled)
		expect(secondEmitCount).toBe(firstEmitCount)

		// Third message after 2+ seconds - should emit
		vi.advanceTimersByTime(1600) // Total time: 2100ms
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 3",
		})

		const thirdEmitCount = emitSpy.mock.calls.filter(
			(call) => call[0] === RooCodeEventName.TaskTokenUsageUpdated,
		).length

		// Should have emitted again after throttle period
		expect(thirdEmitCount).toBeGreaterThan(secondEmitCount)
	})

	test("should include toolUsage in emission payload", async () => {
		const emitSpy = vi.spyOn(task, "emit")

		// Set some tool usage
		task.toolUsage = {
			read_file: { attempts: 5, failures: 1 },
			write_to_file: { attempts: 3, failures: 0 },
		}

		// Add a message to trigger emission
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Test message",
		})

		// Should emit with toolUsage as third parameter
		expect(emitSpy).toHaveBeenCalledWith(
			RooCodeEventName.TaskTokenUsageUpdated,
			task.taskId,
			expect.any(Object), // tokenUsage
			task.toolUsage, // toolUsage
		)
	})

	test("should force final emission on task abort", async () => {
		const emitSpy = vi.spyOn(task, "emit")

		// Set some tool usage
		task.toolUsage = {
			read_file: { attempts: 5, failures: 1 },
		}

		// Add a message first
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 1",
		})

		// Clear the spy to check for final emission
		emitSpy.mockClear()

		// Abort task immediately (within throttle window)
		vi.advanceTimersByTime(500)
		await task.abortTask()

		// Should have emitted TaskTokenUsageUpdated before TaskAborted
		const calls = emitSpy.mock.calls
		const tokenUsageUpdateIndex = calls.findIndex((call) => call[0] === RooCodeEventName.TaskTokenUsageUpdated)
		const taskAbortedIndex = calls.findIndex((call) => call[0] === RooCodeEventName.TaskAborted)

		// Should have both events
		expect(tokenUsageUpdateIndex).toBeGreaterThanOrEqual(0)
		expect(taskAbortedIndex).toBeGreaterThanOrEqual(0)

		// TaskTokenUsageUpdated should come before TaskAborted
		expect(tokenUsageUpdateIndex).toBeLessThan(taskAbortedIndex)
	})

	test("should update tokenUsageSnapshot when throttled emission occurs", async () => {
		const { taskMetadata } = await import("../../task-persistence")
		let callCount = 0

		// Mock to return different token usage on each call
		vi.mocked(taskMetadata).mockImplementation(async () => {
			callCount++
			return {
				historyItem: {
					id: "test-task-id",
					number: 1,
					task: "Test task",
					ts: Date.now(),
					totalCost: 0.01 * callCount,
					tokensIn: 100 * callCount,
					tokensOut: 50 * callCount,
				},
				tokenUsage: {
					totalTokensIn: 100 * callCount,
					totalTokensOut: 50 * callCount,
					totalCost: 0.01 * callCount,
					contextTokens: 150 * callCount,
					totalCacheWrites: 0,
					totalCacheReads: 0,
				},
			}
		})

		// Add initial message
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 1",
		})

		// Get the initial snapshot
		const initialSnapshot = (task as any).tokenUsageSnapshot

		// Add another message within throttle window
		vi.advanceTimersByTime(500)
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 2",
		})

		// Snapshot should still be the same (throttled)
		expect((task as any).tokenUsageSnapshot).toBe(initialSnapshot)

		// Add message after throttle window
		vi.advanceTimersByTime(1600) // Total: 2100ms
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 3",
		})

		// Snapshot should be updated now (new object reference)
		expect((task as any).tokenUsageSnapshot).not.toBe(initialSnapshot)
		// Values should be different
		expect((task as any).tokenUsageSnapshot.totalTokensIn).toBeGreaterThan(initialSnapshot.totalTokensIn)
	})

	test("should not emit if token usage has not changed even after throttle period", async () => {
		const { taskMetadata } = await import("../../task-persistence")

		// Mock taskMetadata to return same token usage
		const constantTokenUsage: TokenUsage = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
			totalCacheWrites: 0,
			totalCacheReads: 0,
		}

		vi.mocked(taskMetadata).mockResolvedValue({
			historyItem: {
				id: "test-task-id",
				number: 1,
				task: "Test task",
				ts: Date.now(),
				totalCost: 0.01,
				tokensIn: 100,
				tokensOut: 50,
			},
			tokenUsage: constantTokenUsage,
		})

		const emitSpy = vi.spyOn(task, "emit")

		// Add first message
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 1",
		})

		const firstEmitCount = emitSpy.mock.calls.filter(
			(call) => call[0] === RooCodeEventName.TaskTokenUsageUpdated,
		).length

		// Wait for throttle period and add another message
		vi.advanceTimersByTime(2100)
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 2",
		})

		const secondEmitCount = emitSpy.mock.calls.filter(
			(call) => call[0] === RooCodeEventName.TaskTokenUsageUpdated,
		).length

		// Should not have emitted again since token usage didn't change
		expect(secondEmitCount).toBe(firstEmitCount)
	})

	test("should emit when tool usage changes even if token usage is the same", async () => {
		const { taskMetadata } = await import("../../task-persistence")

		// Mock taskMetadata to return same token usage
		const constantTokenUsage: TokenUsage = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
			totalCacheWrites: 0,
			totalCacheReads: 0,
		}

		vi.mocked(taskMetadata).mockResolvedValue({
			historyItem: {
				id: "test-task-id",
				number: 1,
				task: "Test task",
				ts: Date.now(),
				totalCost: 0.01,
				tokensIn: 100,
				tokensOut: 50,
			},
			tokenUsage: constantTokenUsage,
		})

		const emitSpy = vi.spyOn(task, "emit")

		// Add first message - should emit
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 1",
		})

		const firstEmitCount = emitSpy.mock.calls.filter(
			(call) => call[0] === RooCodeEventName.TaskTokenUsageUpdated,
		).length

		// Wait for throttle period
		vi.advanceTimersByTime(2100)

		// Change tool usage (token usage stays the same)
		task.toolUsage = {
			read_file: { attempts: 5, failures: 1 },
		}

		// Add another message
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 2",
		})

		const secondEmitCount = emitSpy.mock.calls.filter(
			(call) => call[0] === RooCodeEventName.TaskTokenUsageUpdated,
		).length

		// Should have emitted because tool usage changed even though token usage didn't
		expect(secondEmitCount).toBeGreaterThan(firstEmitCount)
	})

	test("should update toolUsageSnapshot when emission occurs", async () => {
		// Add initial message
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 1",
		})

		// Initially toolUsageSnapshot should be set to current toolUsage (empty object)
		const initialSnapshot = (task as any).toolUsageSnapshot
		expect(initialSnapshot).toBeDefined()
		expect(Object.keys(initialSnapshot)).toHaveLength(0)

		// Wait for throttle period
		vi.advanceTimersByTime(2100)

		// Update tool usage
		task.toolUsage = {
			read_file: { attempts: 3, failures: 0 },
			write_to_file: { attempts: 2, failures: 1 },
		}

		// Add another message
		await (task as any).addToClineMessages({
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Message 2",
		})

		// Snapshot should be updated to match the new toolUsage
		const newSnapshot = (task as any).toolUsageSnapshot
		expect(newSnapshot).not.toBe(initialSnapshot)
		expect(newSnapshot.read_file).toEqual({ attempts: 3, failures: 0 })
		expect(newSnapshot.write_to_file).toEqual({ attempts: 2, failures: 1 })
	})

	test("emitFinalTokenUsageUpdate should emit on tool usage change alone", async () => {
		const emitSpy = vi.spyOn(task, "emit")

		// Set initial tool usage and simulate previous emission
		;(task as any).tokenUsageSnapshot = task.getTokenUsage()
		;(task as any).toolUsageSnapshot = {}

		// Change tool usage
		task.toolUsage = {
			execute_command: { attempts: 1, failures: 0 },
		}

		// Call emitFinalTokenUsageUpdate
		task.emitFinalTokenUsageUpdate()

		// Should emit due to tool usage change
		expect(emitSpy).toHaveBeenCalledWith(
			RooCodeEventName.TaskTokenUsageUpdated,
			task.taskId,
			expect.any(Object),
			task.toolUsage,
		)
	})
})

describe("hasToolUsageChanged", () => {
	test("should return true when snapshot is undefined and current has data", () => {
		const current: ToolUsage = {
			read_file: { attempts: 1, failures: 0 },
		}
		expect(hasToolUsageChanged(current, undefined)).toBe(true)
	})

	test("should return false when both are empty", () => {
		expect(hasToolUsageChanged({}, {})).toBe(false)
	})

	test("should return false when snapshot is undefined and current is empty", () => {
		expect(hasToolUsageChanged({}, undefined)).toBe(false)
	})

	test("should return true when a new tool is added", () => {
		const current: ToolUsage = {
			read_file: { attempts: 1, failures: 0 },
			write_to_file: { attempts: 1, failures: 0 },
		}
		const snapshot: ToolUsage = {
			read_file: { attempts: 1, failures: 0 },
		}
		expect(hasToolUsageChanged(current, snapshot)).toBe(true)
	})

	test("should return true when attempts change", () => {
		const current: ToolUsage = {
			read_file: { attempts: 2, failures: 0 },
		}
		const snapshot: ToolUsage = {
			read_file: { attempts: 1, failures: 0 },
		}
		expect(hasToolUsageChanged(current, snapshot)).toBe(true)
	})

	test("should return true when failures change", () => {
		const current: ToolUsage = {
			read_file: { attempts: 1, failures: 1 },
		}
		const snapshot: ToolUsage = {
			read_file: { attempts: 1, failures: 0 },
		}
		expect(hasToolUsageChanged(current, snapshot)).toBe(true)
	})

	test("should return false when nothing changed", () => {
		const current: ToolUsage = {
			read_file: { attempts: 3, failures: 1 },
			write_to_file: { attempts: 2, failures: 0 },
		}
		const snapshot: ToolUsage = {
			read_file: { attempts: 3, failures: 1 },
			write_to_file: { attempts: 2, failures: 0 },
		}
		expect(hasToolUsageChanged(current, snapshot)).toBe(false)
	})
})

describe("hasTokenUsageChanged", () => {
	test("should return true when snapshot is undefined", () => {
		const current: TokenUsage = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
		}
		expect(hasTokenUsageChanged(current, undefined)).toBe(true)
	})

	test("should return true when totalTokensIn changes", () => {
		const current: TokenUsage = {
			totalTokensIn: 200,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
		}
		const snapshot: TokenUsage = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
		}
		expect(hasTokenUsageChanged(current, snapshot)).toBe(true)
	})

	test("should return false when nothing changed", () => {
		const current: TokenUsage = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
			totalCacheWrites: 10,
			totalCacheReads: 5,
		}
		const snapshot: TokenUsage = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
			totalCacheWrites: 10,
			totalCacheReads: 5,
		}
		expect(hasTokenUsageChanged(current, snapshot)).toBe(false)
	})
})

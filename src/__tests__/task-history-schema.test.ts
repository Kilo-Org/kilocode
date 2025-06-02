import { historyItemSchema, HistoryItem } from "../schemas/index"
import { taskMetadata, TaskMetadataOptions } from "../core/task-persistence/taskMetadata"
import { ClineMessage } from "../shared/ExtensionMessage"

// Mock the storage utilities before any imports that might use them
jest.mock("../utils/storage", () => ({
	getTaskDirectoryPath: jest.fn().mockResolvedValue("/mocked/storage/tasks/test-task-123"),
}))

jest.mock("get-folder-size", () => ({
	loose: jest.fn().mockResolvedValue(2048),
}))

describe("Task History Schema", () => {
	describe("historyItemSchema validation", () => {
		const validHistoryItem: HistoryItem = {
			id: "task-123",
			number: 1,
			ts: Date.now(),
			task: "Test task",
			tokensIn: 100,
			tokensOut: 200,
			cacheWrites: 50,
			cacheReads: 25,
			totalCost: 0.05,
			size: 1024,
			workspace: "/test/workspace",
			mode: "code",
			parentTaskId: "parent-123",
			rootTaskId: "root-123",
		}

		it("should validate a complete history item with all new fields", () => {
			const result = historyItemSchema.safeParse(validHistoryItem)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.mode).toBe("code")
				expect(result.data.parentTaskId).toBe("parent-123")
				expect(result.data.rootTaskId).toBe("root-123")
			}
		})

		it("should validate history item without optional new fields (backward compatibility)", () => {
			const legacyItem = {
				id: "task-123",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				totalCost: 0.05,
			}

			const result = historyItemSchema.safeParse(legacyItem)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.mode).toBeUndefined()
				expect(result.data.parentTaskId).toBeUndefined()
				expect(result.data.rootTaskId).toBeUndefined()
			}
		})

		it("should validate history item with only mode field", () => {
			const itemWithMode = {
				...validHistoryItem,
				parentTaskId: undefined,
				rootTaskId: undefined,
			}

			const result = historyItemSchema.safeParse(itemWithMode)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.mode).toBe("code")
				expect(result.data.parentTaskId).toBeUndefined()
				expect(result.data.rootTaskId).toBeUndefined()
			}
		})

		it("should validate history item with hierarchy fields but no mode", () => {
			const itemWithHierarchy = {
				...validHistoryItem,
				mode: undefined,
			}

			const result = historyItemSchema.safeParse(itemWithHierarchy)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.mode).toBeUndefined()
				expect(result.data.parentTaskId).toBe("parent-123")
				expect(result.data.rootTaskId).toBe("root-123")
			}
		})

		it("should reject invalid data types for new fields", () => {
			const invalidItem = {
				...validHistoryItem,
				mode: 123, // should be string
				parentTaskId: true, // should be string
				rootTaskId: [], // should be string
			}

			const result = historyItemSchema.safeParse(invalidItem)
			expect(result.success).toBe(false)
		})

		it("should accept null values for optional fields", () => {
			const itemWithNulls = {
				...validHistoryItem,
				mode: null,
				parentTaskId: null,
				rootTaskId: null,
			}

			// Note: Zod optional() allows undefined but not null by default
			// If the schema should accept null, it needs .nullable()
			const result = historyItemSchema.safeParse(itemWithNulls)
			// This test documents current behavior - adjust based on actual schema requirements
			expect(result.success).toBe(false)
		})
	})

	describe("taskMetadata function", () => {
		const mockMessages: ClineMessage[] = [
			{
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Create a test application",
			},
			{
				ts: Date.now() + 1000,
				type: "ask",
				ask: "command",
				text: "npm init",
			},
		]

		const baseOptions: TaskMetadataOptions = {
			messages: mockMessages,
			taskId: "test-task-123",
			taskNumber: 42,
			globalStoragePath: "/test/storage",
			workspace: "/test/workspace",
		}

		// Mocks are now defined at the top of the file

		it("should create history item with mode field", async () => {
			const options = {
				...baseOptions,
				mode: "architect",
			}

			const { historyItem } = await taskMetadata(options)

			expect(historyItem.mode).toBe("architect")
			expect(historyItem.parentTaskId).toBeUndefined()
			expect(historyItem.rootTaskId).toBeUndefined()
		})

		it("should create history item with hierarchy fields", async () => {
			const options = {
				...baseOptions,
				mode: "code",
				parentTaskId: "parent-456",
				rootTaskId: "root-789",
			}

			const { historyItem } = await taskMetadata(options)

			expect(historyItem.mode).toBe("code")
			expect(historyItem.parentTaskId).toBe("parent-456")
			expect(historyItem.rootTaskId).toBe("root-789")
		})

		it("should create history item without optional fields (backward compatibility)", async () => {
			const { historyItem } = await taskMetadata(baseOptions)

			expect(historyItem.mode).toBeUndefined()
			expect(historyItem.parentTaskId).toBeUndefined()
			expect(historyItem.rootTaskId).toBeUndefined()
			expect(historyItem.id).toBe("test-task-123")
			expect(historyItem.number).toBe(42)
			expect(historyItem.workspace).toBe("/test/workspace")
		})

		it("should handle all combinations of optional fields", async () => {
			const testCases = [
				{ mode: "debug" },
				{ parentTaskId: "parent-123" },
				{ rootTaskId: "root-456" },
				{ mode: "test", parentTaskId: "parent-789" },
				{ mode: "orchestrator", rootTaskId: "root-abc" },
				{ parentTaskId: "parent-def", rootTaskId: "root-ghi" },
				{ mode: "translate", parentTaskId: "parent-jkl", rootTaskId: "root-mno" },
			]

			for (const testCase of testCases) {
				const options = { ...baseOptions, ...testCase }
				const { historyItem } = await taskMetadata(options)

				expect(historyItem.mode).toBe(testCase.mode)
				expect(historyItem.parentTaskId).toBe(testCase.parentTaskId)
				expect(historyItem.rootTaskId).toBe(testCase.rootTaskId)
			}
		})
	})

	describe("Task family relationship building", () => {
		const createMockHistoryItem = (
			id: string,
			parentTaskId?: string,
			rootTaskId?: string,
			mode?: string,
		): HistoryItem => ({
			id,
			number: parseInt(id.split("-")[1]) || 1,
			ts: Date.now(),
			task: `Task ${id}`,
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.05,
			workspace: "/test",
			mode,
			parentTaskId,
			rootTaskId,
		})

		it("should identify root task correctly", () => {
			const rootTask = createMockHistoryItem("task-1", undefined, undefined, "code")
			const childTask = createMockHistoryItem("task-2", "task-1", "task-1", "debug")

			expect(rootTask.parentTaskId).toBeUndefined()
			expect(rootTask.rootTaskId).toBeUndefined()
			expect(childTask.parentTaskId).toBe("task-1")
			expect(childTask.rootTaskId).toBe("task-1")
		})

		it("should handle deep hierarchy relationships", () => {
			const rootTask = createMockHistoryItem("task-1", undefined, undefined, "architect")
			const childTask = createMockHistoryItem("task-2", "task-1", "task-1", "code")
			const grandchildTask = createMockHistoryItem("task-3", "task-2", "task-1", "test")

			expect(rootTask.parentTaskId).toBeUndefined()
			expect(rootTask.rootTaskId).toBeUndefined()

			expect(childTask.parentTaskId).toBe("task-1")
			expect(childTask.rootTaskId).toBe("task-1")

			expect(grandchildTask.parentTaskId).toBe("task-2")
			expect(grandchildTask.rootTaskId).toBe("task-1")
		})

		it("should handle multiple children of same parent", () => {
			const rootTask = createMockHistoryItem("task-1", undefined, undefined, "orchestrator")
			const child1 = createMockHistoryItem("task-2", "task-1", "task-1", "code")
			const child2 = createMockHistoryItem("task-3", "task-1", "task-1", "debug")
			const child3 = createMockHistoryItem("task-4", "task-1", "task-1", "test")

			const children = [child1, child2, child3]
			children.forEach((child) => {
				expect(child.parentTaskId).toBe("task-1")
				expect(child.rootTaskId).toBe("task-1")
			})
		})

		it("should handle orphaned tasks (missing parent)", () => {
			const orphanTask = createMockHistoryItem("task-2", "missing-parent", "task-1", "code")

			expect(orphanTask.parentTaskId).toBe("missing-parent")
			expect(orphanTask.rootTaskId).toBe("task-1")
		})

		it("should handle tasks with inconsistent hierarchy data", () => {
			// Task claims different root than its parent's root
			const inconsistentTask = createMockHistoryItem("task-3", "task-2", "different-root", "debug")

			expect(inconsistentTask.parentTaskId).toBe("task-2")
			expect(inconsistentTask.rootTaskId).toBe("different-root")
		})
	})

	describe("Backward compatibility scenarios", () => {
		it("should handle mixed task history with old and new schema items", () => {
			const legacyItems = [
				{
					id: "legacy-1",
					number: 1,
					ts: Date.now(),
					task: "Legacy task 1",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.05,
				},
				{
					id: "legacy-2",
					number: 2,
					ts: Date.now(),
					task: "Legacy task 2",
					tokensIn: 150,
					tokensOut: 250,
					totalCost: 0.08,
				},
			]

			const newItems = [
				{
					id: "new-1",
					number: 3,
					ts: Date.now(),
					task: "New task 1",
					tokensIn: 200,
					tokensOut: 300,
					totalCost: 0.1,
					mode: "code",
					parentTaskId: "legacy-1",
					rootTaskId: "legacy-1",
				},
			]

			const allItems = [...legacyItems, ...newItems]

			allItems.forEach((item) => {
				const result = historyItemSchema.safeParse(item)
				expect(result.success).toBe(true)
			})

			// Verify legacy items don't have new fields
			const parsedLegacy = historyItemSchema.parse(legacyItems[0])
			expect(parsedLegacy.mode).toBeUndefined()
			expect(parsedLegacy.parentTaskId).toBeUndefined()
			expect(parsedLegacy.rootTaskId).toBeUndefined()

			// Verify new items have all fields
			const parsedNew = historyItemSchema.parse(newItems[0])
			expect(parsedNew.mode).toBe("code")
			expect(parsedNew.parentTaskId).toBe("legacy-1")
			expect(parsedNew.rootTaskId).toBe("legacy-1")
		})

		it("should handle gradual migration scenarios", () => {
			// Simulate a scenario where mode is added first, then hierarchy
			const phaseOneItem = {
				id: "phase-1",
				number: 1,
				ts: Date.now(),
				task: "Phase 1 task",
				tokensIn: 100,
				tokensOut: 200,
				totalCost: 0.05,
				mode: "architect",
			}

			const phaseTwoItem = {
				id: "phase-2",
				number: 2,
				ts: Date.now(),
				task: "Phase 2 task",
				tokensIn: 150,
				tokensOut: 250,
				totalCost: 0.08,
				mode: "code",
				parentTaskId: "phase-1",
				rootTaskId: "phase-1",
			}

			const phase1Result = historyItemSchema.safeParse(phaseOneItem)
			expect(phase1Result.success).toBe(true)
			if (phase1Result.success) {
				expect(phase1Result.data.mode).toBe("architect")
				expect(phase1Result.data.parentTaskId).toBeUndefined()
				expect(phase1Result.data.rootTaskId).toBeUndefined()
			}

			const phase2Result = historyItemSchema.safeParse(phaseTwoItem)
			expect(phase2Result.success).toBe(true)
			if (phase2Result.success) {
				expect(phase2Result.data.mode).toBe("code")
				expect(phase2Result.data.parentTaskId).toBe("phase-1")
				expect(phase2Result.data.rootTaskId).toBe("phase-1")
			}
		})
	})
})

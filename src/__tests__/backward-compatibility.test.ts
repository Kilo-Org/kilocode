import { historyItemSchema, HistoryItem } from "../schemas/index"
import { taskMetadata } from "../core/task-persistence/taskMetadata"

// Mock the storage utilities before any imports that might use them
jest.mock("../utils/storage", () => ({
	getTaskDirectoryPath: jest.fn().mockResolvedValue("/mocked/storage/tasks/test-task-123"),
}))

jest.mock("get-folder-size", () => ({
	loose: jest.fn().mockResolvedValue(2048),
}))

describe("Backward Compatibility Tests", () => {
	describe("Legacy task history data", () => {
		it("should validate legacy task history without new fields", () => {
			const legacyTaskHistory = [
				{
					id: "legacy-task-1",
					number: 1,
					ts: 1640995200000, // 2022-01-01
					task: "Legacy task without mode",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.05,
				},
				{
					id: "legacy-task-2",
					number: 2,
					ts: 1640995260000,
					task: "Another legacy task",
					tokensIn: 150,
					tokensOut: 250,
					totalCost: 0.08,
					workspace: "/legacy/workspace",
				},
			]

			legacyTaskHistory.forEach((task) => {
				const result = historyItemSchema.safeParse(task)
				expect(result.success).toBe(true)

				if (result.success) {
					expect(result.data.mode).toBeUndefined()
					expect(result.data.parentTaskId).toBeUndefined()
					expect(result.data.rootTaskId).toBeUndefined()
				}
			})
		})

		it("should handle mixed legacy and new task history", () => {
			const mixedTaskHistory = [
				// Legacy task
				{
					id: "legacy-task-1",
					number: 1,
					ts: 1640995200000,
					task: "Legacy task",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.05,
				},
				// Partially migrated task (only mode added)
				{
					id: "partial-task-2",
					number: 2,
					ts: 1640995260000,
					task: "Partially migrated task",
					tokensIn: 150,
					tokensOut: 250,
					totalCost: 0.08,
					mode: "code",
				},
				// Fully migrated task
				{
					id: "new-task-3",
					number: 3,
					ts: 1640995320000,
					task: "Fully migrated task",
					tokensIn: 200,
					tokensOut: 300,
					totalCost: 0.1,
					mode: "architect",
					parentTaskId: "legacy-task-1",
					rootTaskId: "legacy-task-1",
				},
			]

			mixedTaskHistory.forEach((task) => {
				const result = historyItemSchema.safeParse(task)
				expect(result.success).toBe(true)
			})

			// Verify specific field presence
			const parsedTasks = mixedTaskHistory.map((task) => historyItemSchema.parse(task))

			// Legacy task
			expect(parsedTasks[0].mode).toBeUndefined()
			expect(parsedTasks[0].parentTaskId).toBeUndefined()
			expect(parsedTasks[0].rootTaskId).toBeUndefined()

			// Partially migrated task
			expect(parsedTasks[1].mode).toBe("code")
			expect(parsedTasks[1].parentTaskId).toBeUndefined()
			expect(parsedTasks[1].rootTaskId).toBeUndefined()

			// Fully migrated task
			expect(parsedTasks[2].mode).toBe("architect")
			expect(parsedTasks[2].parentTaskId).toBe("legacy-task-1")
			expect(parsedTasks[2].rootTaskId).toBe("legacy-task-1")
		})

		it("should handle task history with missing optional fields", () => {
			const minimalTasks = [
				{
					id: "minimal-1",
					number: 1,
					ts: Date.now(),
					task: "Minimal task",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
				{
					id: "minimal-2",
					number: 2,
					ts: Date.now(),
					task: "Another minimal task",
					tokensIn: 10,
					tokensOut: 20,
					totalCost: 0.01,
					// Some optional fields present
					cacheWrites: 5,
					size: 1024,
				},
			]

			minimalTasks.forEach((task) => {
				const result = historyItemSchema.safeParse(task)
				expect(result.success).toBe(true)
			})
		})
	})

	describe("Task metadata generation compatibility", () => {
		// Mock dependencies for taskMetadata function
		jest.mock("../utils/storage", () => ({
			getTaskDirectoryPath: jest.fn().mockResolvedValue("/mock/storage/task-123"),
		}))

		jest.mock("get-folder-size", () => ({
			loose: jest.fn().mockResolvedValue(1024),
		}))

		it("should generate metadata compatible with legacy systems", async () => {
			const legacyMessages = [
				{
					ts: Date.now(),
					type: "say" as const,
					say: "text" as const,
					text: "Legacy task message",
				},
			]

			const options = {
				messages: legacyMessages,
				taskId: "legacy-task-123",
				taskNumber: 1,
				globalStoragePath: "/legacy/storage",
				workspace: "/legacy/workspace",
				// No mode, parentTaskId, or rootTaskId
			}

			const { historyItem } = await taskMetadata(options)

			// Should create valid history item without new fields
			expect(historyItem.id).toBe("legacy-task-123")
			expect(historyItem.number).toBe(1)
			expect(historyItem.workspace).toBe("/legacy/workspace")
			expect(historyItem.mode).toBeUndefined()
			expect(historyItem.parentTaskId).toBeUndefined()
			expect(historyItem.rootTaskId).toBeUndefined()

			// Should still validate against schema
			const validationResult = historyItemSchema.safeParse(historyItem)
			expect(validationResult.success).toBe(true)
		})

		it("should handle gradual migration scenarios", async () => {
			const messages = [
				{
					ts: Date.now(),
					type: "say" as const,
					say: "text" as const,
					text: "Gradual migration task",
				},
			]

			// Phase 1: Add only mode
			const phase1Options = {
				messages,
				taskId: "migration-task-1",
				taskNumber: 1,
				globalStoragePath: "/storage",
				workspace: "/workspace",
				mode: "code",
			}

			const { historyItem: phase1Item } = await taskMetadata(phase1Options)
			expect(phase1Item.mode).toBe("code")
			expect(phase1Item.parentTaskId).toBeUndefined()
			expect(phase1Item.rootTaskId).toBeUndefined()

			// Phase 2: Add hierarchy fields
			const phase2Options = {
				...phase1Options,
				taskId: "migration-task-2",
				taskNumber: 2,
				parentTaskId: "migration-task-1",
				rootTaskId: "migration-task-1",
			}

			const { historyItem: phase2Item } = await taskMetadata(phase2Options)
			expect(phase2Item.mode).toBe("code")
			expect(phase2Item.parentTaskId).toBe("migration-task-1")
			expect(phase2Item.rootTaskId).toBe("migration-task-1")

			// Both should validate
			expect(historyItemSchema.safeParse(phase1Item).success).toBe(true)
			expect(historyItemSchema.safeParse(phase2Item).success).toBe(true)
		})
	})

	describe("Export functionality compatibility", () => {
		it("should handle export of legacy tasks without mode", () => {
			const legacyTask: HistoryItem = {
				id: "legacy-export-1",
				number: 1,
				ts: Date.now(),
				task: "Legacy task for export",
				tokensIn: 100,
				tokensOut: 200,
				totalCost: 0.05,
				workspace: "/legacy",
			}

			// Should be able to build task family even without mode
			const allTasks = [legacyTask]

			// This should not throw an error
			expect(() => {
				// Simulate the logic from buildTaskFamily
				const familyTasks = allTasks.filter(
					(task) => task.rootTaskId === "legacy-export-1" || task.id === "legacy-export-1",
				)
				const rootTask = familyTasks.find((task) => task.id === "legacy-export-1")

				expect(rootTask).toBeDefined()
				expect(rootTask?.mode).toBeUndefined()
			}).not.toThrow()
		})

		it("should handle mixed mode and legacy task families", () => {
			const mixedTasks: HistoryItem[] = [
				{
					id: "root-legacy",
					number: 1,
					ts: 1000,
					task: "Legacy root task",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.05,
					workspace: "/mixed",
					// No mode
				},
				{
					id: "child-new",
					number: 2,
					ts: 2000,
					task: "New child task",
					tokensIn: 150,
					tokensOut: 250,
					totalCost: 0.08,
					workspace: "/mixed",
					mode: "code",
					parentTaskId: "root-legacy",
					rootTaskId: "root-legacy",
				},
			]

			// Should handle mixed family structure
			const familyTasks = mixedTasks.filter(
				(task) => task.rootTaskId === "root-legacy" || task.id === "root-legacy",
			)

			expect(familyTasks).toHaveLength(2)
			expect(familyTasks[0].mode).toBeUndefined()
			expect(familyTasks[1].mode).toBe("code")
		})
	})

	describe("Search and filtering compatibility", () => {
		it("should handle filtering with mixed mode presence", () => {
			const mixedTasks: HistoryItem[] = [
				{
					id: "task-1",
					number: 1,
					ts: 1000,
					task: "Task with mode",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.05,
					workspace: "/test",
					mode: "code",
				},
				{
					id: "task-2",
					number: 2,
					ts: 2000,
					task: "Task without mode",
					tokensIn: 150,
					tokensOut: 250,
					totalCost: 0.08,
					workspace: "/test",
					// No mode field
				},
			]

			// Filter by mode should only return tasks with that mode
			const codeModeTasks = mixedTasks.filter((task) => task.mode === "code")
			expect(codeModeTasks).toHaveLength(1)
			expect(codeModeTasks[0].id).toBe("task-1")

			// Filter for undefined mode should return tasks without mode
			const noModeTasks = mixedTasks.filter((task) => !task.mode)
			expect(noModeTasks).toHaveLength(1)
			expect(noModeTasks[0].id).toBe("task-2")

			// Get available modes should exclude undefined
			const availableModes = new Set<string>()
			mixedTasks.forEach((task) => {
				if (task.mode) {
					availableModes.add(task.mode)
				}
			})
			expect(Array.from(availableModes)).toEqual(["code"])
		})

		it("should handle workspace filtering with new fields", () => {
			const tasksWithNewFields: HistoryItem[] = [
				{
					id: "task-1",
					number: 1,
					ts: 1000,
					task: "Task in workspace 1",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.05,
					workspace: "/workspace1",
					mode: "code",
				},
				{
					id: "task-2",
					number: 2,
					ts: 2000,
					task: "Task in workspace 2",
					tokensIn: 150,
					tokensOut: 250,
					totalCost: 0.08,
					workspace: "/workspace2",
					mode: "debug",
					parentTaskId: "task-1",
					rootTaskId: "task-1",
				},
			]

			// Workspace filtering should work regardless of new fields
			const workspace1Tasks = tasksWithNewFields.filter((task) => task.workspace === "/workspace1")
			expect(workspace1Tasks).toHaveLength(1)
			expect(workspace1Tasks[0].mode).toBe("code")

			const workspace2Tasks = tasksWithNewFields.filter((task) => task.workspace === "/workspace2")
			expect(workspace2Tasks).toHaveLength(1)
			expect(workspace2Tasks[0].parentTaskId).toBe("task-1")
		})
	})

	describe("Data migration scenarios", () => {
		it("should handle incremental field addition", () => {
			// Simulate data at different migration stages
			const migrationStages = [
				// Stage 0: Original schema
				{
					id: "task-stage-0",
					number: 1,
					ts: 1000,
					task: "Original task",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.05,
				},
				// Stage 1: Added workspace
				{
					id: "task-stage-1",
					number: 2,
					ts: 2000,
					task: "Task with workspace",
					tokensIn: 150,
					tokensOut: 250,
					totalCost: 0.08,
					workspace: "/workspace",
				},
				// Stage 2: Added mode
				{
					id: "task-stage-2",
					number: 3,
					ts: 3000,
					task: "Task with mode",
					tokensIn: 200,
					tokensOut: 300,
					totalCost: 0.1,
					workspace: "/workspace",
					mode: "code",
				},
				// Stage 3: Added hierarchy
				{
					id: "task-stage-3",
					number: 4,
					ts: 4000,
					task: "Task with hierarchy",
					tokensIn: 250,
					tokensOut: 350,
					totalCost: 0.12,
					workspace: "/workspace",
					mode: "debug",
					parentTaskId: "task-stage-2",
					rootTaskId: "task-stage-2",
				},
			]

			// All stages should validate successfully
			migrationStages.forEach((task, index) => {
				const result = historyItemSchema.safeParse(task)
				expect(result.success).toBe(true)

				if (result.success) {
					// Verify progressive field addition
					if (index >= 1) {
						expect(result.data.workspace).toBeDefined()
					}
					if (index >= 2) {
						expect(result.data.mode).toBeDefined()
					}
					if (index >= 3) {
						expect(result.data.parentTaskId).toBeDefined()
						expect(result.data.rootTaskId).toBeDefined()
					}
				}
			})
		})

		it("should handle rollback scenarios", () => {
			// Task created with new schema
			const newTask = {
				id: "new-task",
				number: 1,
				ts: Date.now(),
				task: "Task with new fields",
				tokensIn: 100,
				tokensOut: 200,
				totalCost: 0.05,
				workspace: "/workspace",
				mode: "code",
				parentTaskId: "parent-task",
				rootTaskId: "root-task",
			}

			// Should validate with all fields
			const fullValidation = historyItemSchema.safeParse(newTask)
			expect(fullValidation.success).toBe(true)

			// Simulate rollback by removing new fields
			const { mode, parentTaskId, rootTaskId, ...rolledBackTask } = newTask

			// Should still validate without new fields
			const rollbackValidation = historyItemSchema.safeParse(rolledBackTask)
			expect(rollbackValidation.success).toBe(true)
		})
	})
})

import * as vscode from "vscode"
import { buildTaskFamily, downloadTaskFamily } from "../integrations/misc/export-markdown"
import { HistoryItem } from "../schemas/index"

// Mock vscode
jest.mock("vscode", () => ({
	window: {
		showSaveDialog: jest.fn(),
		showOpenDialog: jest.fn(),
		showInformationMessage: jest.fn(),
		showErrorMessage: jest.fn(),
	},
	workspace: {
		fs: {
			writeFile: jest.fn(),
			createDirectory: jest.fn(),
		},
	},
	commands: {
		executeCommand: jest.fn(),
	},
	Uri: {
		file: jest.fn((path: string) => ({ fsPath: path })),
		joinPath: jest.fn((base: any, ...paths: string[]) => ({
			fsPath: `${base.fsPath}/${paths.join("/")}`,
		})),
	},
}))

describe("Export Integration Tests", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe("End-to-end export workflow", () => {
		const createMockTask = (
			id: string,
			parentTaskId?: string,
			rootTaskId?: string,
			mode?: string,
			ts: number = Date.now(),
		): HistoryItem => ({
			id,
			number: parseInt(id.split("-")[1]) || 1,
			ts,
			task: `Task ${id}`,
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.05,
			workspace: "/test",
			mode,
			parentTaskId,
			rootTaskId,
		})

		it("should export single task without family", async () => {
			const mockTask = createMockTask("task-1", undefined, undefined, "code")
			const mockGetTaskWithId = jest.fn().mockResolvedValue({
				historyItem: mockTask,
				apiConversationHistory: [
					{ role: "user", content: "Create a component" },
					{ role: "assistant", content: "I'll create a component for you" },
				],
			})

			const mockSelectedFolders = [{ fsPath: "/test/export" }]
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(mockSelectedFolders)

			const taskFamily = buildTaskFamily([mockTask], "task-1")
			await downloadTaskFamily(taskFamily, mockGetTaskWithId)

			// Verify folder creation
			expect(vscode.workspace.fs.createDirectory).toHaveBeenCalled()

			// Verify task file creation
			expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(2) // Task file + README

			// Verify success message
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("Task family exported to:"),
			)

			// Verify folder opening
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.openFolder", expect.any(Object), {
				forceNewWindow: true,
			})
		})

		it("should export complex task family with hierarchy", async () => {
			const allTasks = [
				createMockTask("task-1", undefined, undefined, "architect", 1000),
				createMockTask("task-2", "task-1", "task-1", "code", 2000),
				createMockTask("task-3", "task-1", "task-1", "test", 3000),
				createMockTask("task-4", "task-2", "task-1", "debug", 4000),
			]

			const mockGetTaskWithId = jest
				.fn()
				.mockResolvedValueOnce({
					historyItem: allTasks[0],
					apiConversationHistory: [{ role: "user", content: "Design system" }],
				})
				.mockResolvedValueOnce({
					historyItem: allTasks[1],
					apiConversationHistory: [{ role: "user", content: "Implement feature" }],
				})
				.mockResolvedValueOnce({
					historyItem: allTasks[2],
					apiConversationHistory: [{ role: "user", content: "Write tests" }],
				})
				.mockResolvedValueOnce({
					historyItem: allTasks[3],
					apiConversationHistory: [{ role: "user", content: "Fix bug" }],
				})

			const mockSelectedFolders = [{ fsPath: "/test/export" }]
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(mockSelectedFolders)

			const taskFamily = buildTaskFamily(allTasks, "task-1")
			await downloadTaskFamily(taskFamily, mockGetTaskWithId)

			// Verify all tasks were processed
			expect(mockGetTaskWithId).toHaveBeenCalledTimes(4)

			// Verify all files were created (4 task files + 1 README)
			expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(5)

			// Verify hierarchy structure in family
			expect(taskFamily.hierarchy).toHaveLength(1) // Root task
			expect(taskFamily.hierarchy[0].children).toHaveLength(2) // task-2 and task-3
			expect(taskFamily.hierarchy[0].children[0].children).toHaveLength(1) // task-4 under task-2
		})

		it("should handle export errors gracefully", async () => {
			const mockTask = createMockTask("task-1", undefined, undefined, "code")
			const mockGetTaskWithId = jest.fn().mockResolvedValue({
				historyItem: mockTask,
				apiConversationHistory: [],
			})

			const mockSelectedFolders = [{ fsPath: "/test/export" }]
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(mockSelectedFolders)
			;(vscode.workspace.fs.createDirectory as jest.Mock).mockRejectedValue(new Error("Permission denied"))

			const taskFamily = buildTaskFamily([mockTask], "task-1")
			await downloadTaskFamily(taskFamily, mockGetTaskWithId)

			// Verify error handling
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Failed to export task family"),
			)

			// Verify no success message or folder opening
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
		})

		it("should handle user cancellation", async () => {
			const mockTask = createMockTask("task-1", undefined, undefined, "code")
			const mockGetTaskWithId = jest.fn()

			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined)

			const taskFamily = buildTaskFamily([mockTask], "task-1")
			await downloadTaskFamily(taskFamily, mockGetTaskWithId)

			// Verify no operations were performed
			expect(vscode.workspace.fs.createDirectory).not.toHaveBeenCalled()
			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
			expect(mockGetTaskWithId).not.toHaveBeenCalled()
		})
	})

	describe("Task family building with various scenarios", () => {
		const createMockTask = (
			id: string,
			parentTaskId?: string,
			rootTaskId?: string,
			mode?: string,
			ts: number = Date.now(),
		): HistoryItem => ({
			id,
			number: parseInt(id.split("-")[1]) || 1,
			ts,
			task: `Task ${id}`,
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.05,
			workspace: "/test",
			mode,
			parentTaskId,
			rootTaskId,
		})

		it("should handle mixed mode families", async () => {
			const allTasks = [
				createMockTask("task-1", undefined, undefined, "orchestrator", 1000),
				createMockTask("task-2", "task-1", "task-1", "code", 2000),
				createMockTask("task-3", "task-1", "task-1", "debug", 3000),
				createMockTask("task-4", "task-1", "task-1", "test", 4000),
				createMockTask("task-5", "task-1", "task-1", "architect", 5000),
			]

			const family = buildTaskFamily(allTasks, "task-1")

			expect(family.rootTask.mode).toBe("orchestrator")
			expect(family.tasks).toHaveLength(5)
			expect(family.hierarchy[0].children).toHaveLength(4)

			// Verify all different modes are present
			const modes = family.tasks.map((t) => t.mode).filter(Boolean)
			expect(modes).toContain("orchestrator")
			expect(modes).toContain("code")
			expect(modes).toContain("debug")
			expect(modes).toContain("test")
			expect(modes).toContain("architect")
		})

		it("should handle tasks without modes (backward compatibility)", async () => {
			const allTasks = [
				createMockTask("task-1", undefined, undefined, undefined, 1000),
				createMockTask("task-2", "task-1", "task-1", "code", 2000),
				createMockTask("task-3", "task-1", "task-1", undefined, 3000),
			]

			const family = buildTaskFamily(allTasks, "task-1")

			expect(family.rootTask.mode).toBeUndefined()
			expect(family.tasks).toHaveLength(3)
			expect(family.hierarchy[0].children).toHaveLength(2)

			// Should handle undefined modes gracefully
			const tasksWithoutMode = family.tasks.filter((t) => !t.mode)
			expect(tasksWithoutMode).toHaveLength(2)
		})

		it("should handle large task families", async () => {
			// Create a large family with 50 tasks
			const allTasks: HistoryItem[] = []

			// Root task
			allTasks.push(createMockTask("task-1", undefined, undefined, "orchestrator", 1000))

			// 49 child tasks
			for (let i = 2; i <= 50; i++) {
				const mode = ["code", "debug", "test", "architect"][i % 4]
				allTasks.push(createMockTask(`task-${i}`, "task-1", "task-1", mode, 1000 + i))
			}

			const family = buildTaskFamily(allTasks, "task-1")

			expect(family.tasks).toHaveLength(50)
			expect(family.hierarchy[0].children).toHaveLength(49)
			expect(family.rootTask.id).toBe("task-1")

			// Verify chronological sorting
			for (let i = 0; i < family.tasks.length - 1; i++) {
				expect(family.tasks[i].ts).toBeLessThanOrEqual(family.tasks[i + 1].ts)
			}
		})

		it("should handle deep nested hierarchies", async () => {
			const allTasks: HistoryItem[] = []

			// Create a 10-level deep hierarchy
			for (let i = 1; i <= 10; i++) {
				const parentId = i === 1 ? undefined : `task-${i - 1}`
				const rootId = i === 1 ? undefined : "task-1"
				allTasks.push(createMockTask(`task-${i}`, parentId, rootId, "code", 1000 + i))
			}

			const family = buildTaskFamily(allTasks, "task-1")

			expect(family.tasks).toHaveLength(10)
			expect(family.hierarchy).toHaveLength(1)

			// Verify deep nesting
			let currentLevel = family.hierarchy[0]
			for (let i = 2; i <= 10; i++) {
				expect(currentLevel.children).toHaveLength(1)
				currentLevel = currentLevel.children[0]
			}
			expect(currentLevel.task.id).toBe("task-10")
		})

		it("should handle disconnected task families", async () => {
			const allTasks = [
				createMockTask("task-1", undefined, undefined, "architect", 1000),
				createMockTask("task-2", "task-1", "task-1", "code", 2000),
				createMockTask("task-3", "missing-parent", "task-1", "debug", 3000), // Orphaned
				createMockTask("task-4", "task-2", "task-1", "test", 4000),
			]

			const family = buildTaskFamily(allTasks, "task-1")

			expect(family.tasks).toHaveLength(4) // All tasks included
			expect(family.hierarchy[0].children).toHaveLength(1) // Only task-2 is direct child
			expect(family.hierarchy[0].children[0].children).toHaveLength(1) // task-4 under task-2

			// Orphaned task-3 won't appear in hierarchy but is in tasks list
			const orphanedTask = family.tasks.find((t) => t.id === "task-3")
			expect(orphanedTask).toBeDefined()
			expect(orphanedTask?.parentTaskId).toBe("missing-parent")
		})
	})

	describe("File naming and structure", () => {
		it("should generate correct file names for different modes", async () => {
			const modes = ["code", "architect", "debug", "test", "orchestrator", "translate"]

			for (const mode of modes) {
				const mockTask = {
					id: "task-1",
					number: 1,
					ts: new Date("2024-01-15T14:30:45").getTime(),
					task: "Test task",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.05,
					workspace: "/test",
					mode,
				}

				const mockGetTaskWithId = jest.fn().mockResolvedValue({
					historyItem: mockTask,
					apiConversationHistory: [],
				})

				const mockSelectedFolders = [{ fsPath: "/test/export" }]
				;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(mockSelectedFolders)

				const taskFamily = buildTaskFamily([mockTask], "task-1")
				await downloadTaskFamily(taskFamily, mockGetTaskWithId)

				// Verify folder selection dialog was called
				expect(vscode.window.showOpenDialog).toHaveBeenCalledWith({
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
					openLabel: "Select Export Location",
					defaultUri: expect.any(Object),
				})

				jest.clearAllMocks()
			}
		})

		it("should handle tasks without mode in naming", async () => {
			const mockTask = {
				id: "task-1",
				number: 1,
				ts: new Date("2024-01-15T14:30:45").getTime(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				totalCost: 0.05,
				workspace: "/test",
				// No mode field
			}

			const mockGetTaskWithId = jest.fn().mockResolvedValue({
				historyItem: mockTask,
				apiConversationHistory: [],
			})

			const mockSelectedFolders = [{ fsPath: "/test/export" }]
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(mockSelectedFolders)

			const taskFamily = buildTaskFamily([mockTask], "task-1")
			await downloadTaskFamily(taskFamily, mockGetTaskWithId)

			// Verify folder selection dialog was called
			expect(vscode.window.showOpenDialog).toHaveBeenCalledWith({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: "Select Export Location",
				defaultUri: expect.any(Object),
			})
		})
	})
})

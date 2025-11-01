import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import getFolderSize from "get-folder-size"

import { AutoPurgeService } from "../AutoPurgeService"
import { TaskType, type HistoryItem, type AutoPurgeSettings, TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

// Mock dependencies
vi.mock("fs/promises")
vi.mock("get-folder-size")
vi.mock("@roo-code/telemetry")
vi.mock("../../../utils/storage")
vi.mock("../../../utils/fs")

const mockFs = vi.mocked(fs)
const mockGetFolderSize = vi.mocked(getFolderSize)
const mockTelemetryService = vi.mocked(TelemetryService)

describe("AutoPurgeService", () => {
	let autoPurgeService: AutoPurgeService
	let mockGlobalStoragePath: string

	beforeEach(() => {
		mockGlobalStoragePath = "/mock/storage/path"
		autoPurgeService = new AutoPurgeService(mockGlobalStoragePath)

		// Reset all mocks
		vi.clearAllMocks()

		// Setup default mock implementations
		mockGetFolderSize.loose = vi.fn().mockResolvedValue(1024)

		// Mock TelemetryService.instance
		Object.defineProperty(mockTelemetryService, "instance", {
			value: {
				captureEvent: vi.fn(),
			},
			writable: true,
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("getTasksEligibleForPurge", () => {
		it("should identify tasks eligible for purging based on age", async () => {
			const now = Date.now()
			const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000
			const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000 // Within 7-day retention for incomplete tasks

			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const taskHistory: HistoryItem[] = [
				{
					id: "old-task",
					ts: thirtyOneDaysAgo,
					task: "Old task",
					tokensIn: 100,
					tokensOut: 500, // High token output - classified as completed
					totalCost: 0.01,
					number: 1,
				},
				{
					id: "recent-task",
					ts: fiveDaysAgo,
					task: "Recent task",
					tokensIn: 100,
					tokensOut: 10, // Low token output - classified as incomplete, but within 7-day retention
					totalCost: 0.01,
					number: 2,
				},
			]

			// Mock file existence checks
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockResolvedValue(true)

			// Mock getTaskDirectoryPath
			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			const eligibleTasks = await autoPurgeService.getTasksEligibleForPurge(settings, taskHistory, undefined, {
				skipActiveTask: true,
			})

			// Both tasks are old enough, but we need to check which one is actually eligible
			// The "recent-task" is 29 days old, which should not be eligible (< 30 days)
			// The "old-task" is 31 days old, which should be eligible (> 30 days)
			expect(eligibleTasks).toHaveLength(1)
			expect(eligibleTasks[0].taskId).toBe("old-task")
			expect(eligibleTasks[0].shouldPurge).toBe(true)
			expect(eligibleTasks[0].ageInDays).toBeGreaterThan(30)
		})

		it("should not purge favorited tasks when retention is null", async () => {
			const now = Date.now()
			const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000

			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null, // Never purge
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const taskHistory: HistoryItem[] = [
				{
					id: "favorited-task",
					ts: sixtyDaysAgo,
					task: "Favorited task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					number: 1,
					isFavorited: true,
				},
			]

			// Mock file existence checks
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockResolvedValue(true)

			// Mock getTaskDirectoryPath
			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			const eligibleTasks = await autoPurgeService.getTasksEligibleForPurge(settings, taskHistory, undefined, {
				skipActiveTask: true,
			})

			expect(eligibleTasks).toHaveLength(0)
		})

		it("should skip current active task when requested", async () => {
			const now = Date.now()
			const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000

			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const taskHistory: HistoryItem[] = [
				{
					id: "active-task",
					ts: thirtyOneDaysAgo,
					task: "Active task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					number: 1,
				},
			]

			// Mock file existence checks
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockResolvedValue(true)

			// Mock getTaskDirectoryPath
			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			const eligibleTasks = await autoPurgeService.getTasksEligibleForPurge(
				settings,
				taskHistory,
				"active-task", // Current active task
				{ skipActiveTask: true },
			)

			expect(eligibleTasks).toHaveLength(0)
		})
	})

	describe("purgeOldTasks", () => {
		it("should successfully purge eligible tasks", async () => {
			const now = Date.now()
			const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000

			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const taskHistory: HistoryItem[] = [
				{
					id: "old-task",
					ts: thirtyOneDaysAgo,
					task: "Old task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					number: 1,
				},
			]

			// Mock file operations
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockResolvedValue(true)

			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			mockFs.rm = vi.fn().mockResolvedValue(undefined)

			const result = await autoPurgeService.purgeOldTasks(settings, taskHistory, undefined, {})

			expect(result.totalTasksScanned).toBe(1)
			expect(result.tasksEligibleForPurge).toBe(1)
			expect(result.tasksSuccessfullyPurged).toBe(1)
			expect(result.tasksPurgeErrors).toBe(0)
			expect(mockFs.rm).toHaveBeenCalledWith("/mock/path/old-task", { recursive: true, force: true })
			expect(mockTelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AUTO_PURGE_COMPLETED,
				expect.objectContaining({
					totalTasksScanned: 1,
					tasksEligibleForPurge: 1,
					tasksSuccessfullyPurged: 1,
					tasksPurgeErrors: 0,
					diskSpaceFreedBytes: expect.any(Number),
					duration: expect.any(Number),
					dryRun: false,
				}),
			)
		})

		it("should handle errors gracefully during purge", async () => {
			const now = Date.now()
			const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000

			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const taskHistory: HistoryItem[] = [
				{
					id: "error-task",
					ts: thirtyOneDaysAgo,
					task: "Error task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					number: 1,
				},
			]

			// Mock file operations
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockResolvedValue(true)

			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			// Mock fs.rm to throw an error
			mockFs.rm = vi.fn().mockRejectedValue(new Error("Permission denied"))

			const result = await autoPurgeService.purgeOldTasks(settings, taskHistory, undefined, {})

			expect(result.totalTasksScanned).toBe(1)
			expect(result.tasksEligibleForPurge).toBe(1)
			expect(result.tasksSuccessfullyPurged).toBe(0)
			expect(result.tasksPurgeErrors).toBe(1)
			expect(result.errors).toHaveLength(1)
			expect(result.errors[0].taskId).toBe("error-task")
			expect(result.errors[0].error).toBe("Permission denied")
		})

		it("should respect dry run mode", async () => {
			const now = Date.now()
			const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000

			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const taskHistory: HistoryItem[] = [
				{
					id: "dry-run-task",
					ts: thirtyOneDaysAgo,
					task: "Dry run task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					number: 1,
				},
			]

			// Mock file operations
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockResolvedValue(true)

			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			mockFs.rm = vi.fn().mockResolvedValue(undefined)

			const result = await autoPurgeService.purgeOldTasks(settings, taskHistory, undefined, { dryRun: true })

			expect(result.tasksSuccessfullyPurged).toBe(1)
			expect(mockFs.rm).not.toHaveBeenCalled() // Should not actually delete in dry run
			expect(mockTelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AUTO_PURGE_COMPLETED,
				expect.objectContaining({
					dryRun: true,
				}),
			)
		})
	})

	describe("task classification", () => {
		it("should classify favorited tasks correctly", async () => {
			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const taskHistory: HistoryItem[] = [
				{
					id: "favorited-task",
					ts: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days old
					task: "Favorited task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					number: 1,
					isFavorited: true,
				},
			]

			// Mock file operations
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockResolvedValue(true)

			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			const eligibleTasks = await autoPurgeService.getTasksEligibleForPurge(settings, taskHistory)

			// Favorited tasks should not be eligible for purging when retention is null
			expect(eligibleTasks).toHaveLength(0)
		})

		it("should classify completed vs incomplete tasks", async () => {
			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const taskHistory: HistoryItem[] = [
				{
					id: "completed-task",
					ts: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days old
					task: "Completed task",
					tokensIn: 100,
					tokensOut: 500,
					totalCost: 0.05,
					number: 1,
				},
				{
					id: "incomplete-task",
					ts: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days old
					task: "Incomplete task",
					tokensIn: 50,
					tokensOut: 10,
					totalCost: 0.01,
					number: 2,
				},
			]

			// Mock file operations
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockImplementation(async (filePath: string) => {
				// Mock task directory exists
				if (filePath.includes("/mock/path/")) {
					return true
				}
				// Mock UI messages file exists only for completed task
				if (filePath.includes("completed-task") && filePath.includes("ui_messages.json")) {
					return true
				}
				// Incomplete task has no UI messages file (or no completion_result)
				if (filePath.includes("incomplete-task") && filePath.includes("ui_messages.json")) {
					return false
				}
				return false
			})

			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			// Mock fs.readFile to return completion_result for completed task
			vi.mocked(fs.readFile).mockImplementation(async (filePath: string | any) => {
				if (
					typeof filePath === "string" &&
					filePath.includes("completed-task") &&
					filePath.includes("ui_messages.json")
				) {
					return JSON.stringify([
						{ type: "say", say: "text", text: "Working on task..." },
						{ type: "say", say: "completion_result", text: "Task completed successfully" },
					])
				}
				throw new Error("File not found")
			})

			const eligibleTasks = await autoPurgeService.getTasksEligibleForPurge(settings, taskHistory)

			// Since incomplete task retention is 7 days and the task is 10 days old, it should be eligible
			// Completed task retention is 30 days and the task is 10 days old, so it should not be eligible
			expect(eligibleTasks).toHaveLength(1)

			const incompleteTask = eligibleTasks.find((t) => t.taskId === "incomplete-task")
			expect(incompleteTask?.taskType).toBe(TaskType.INCOMPLETE)
			expect(incompleteTask?.shouldPurge).toBe(true) // 10 days > 7 day retention
		})

		it("should detect task completion based on completion_result messages", async () => {
			const now = Date.now()
			const taskHistory: HistoryItem[] = [
				{
					id: "truly-completed-task",
					ts: now - 10 * 24 * 60 * 60 * 1000,
					task: "Task with completion_result",
					tokensIn: 50,
					tokensOut: 50, // Low token output but has completion_result
					totalCost: 0.01,
					number: 1,
				},
				{
					id: "high-token-incomplete-task",
					ts: now - 10 * 24 * 60 * 60 * 1000,
					task: "Task with high tokens but no completion",
					tokensIn: 100,
					tokensOut: 1000, // High token output but no completion_result
					totalCost: 0.1,
					number: 2,
				},
			]

			// Mock file operations
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockImplementation(async (filePath: string) => {
				// Both task directories exist
				if (filePath.includes("/mock/path/")) {
					return true
				}
				// Only the truly completed task has UI messages
				if (filePath.includes("truly-completed-task") && filePath.includes("ui_messages.json")) {
					return true
				}
				// High token task has no UI messages file
				if (filePath.includes("high-token-incomplete-task") && filePath.includes("ui_messages.json")) {
					return false
				}
				return false
			})

			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			// Mock fs.readFile to return completion_result for the truly completed task
			vi.mocked(fs.readFile).mockImplementation(async (filePath: string | any) => {
				if (
					typeof filePath === "string" &&
					filePath.includes("truly-completed-task") &&
					filePath.includes("ui_messages.json")
				) {
					return JSON.stringify([
						{ type: "say", say: "text", text: "Working on task..." },
						{ type: "say", say: "completion_result", text: "Task completed successfully" },
					])
				}
				throw new Error("File not found")
			})

			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const eligibleTasks = await autoPurgeService.getTasksEligibleForPurge(settings, taskHistory)

			// Only the high-token incomplete task should be eligible for purging
			// (10 days old > 7 day retention for incomplete tasks)
			// The truly completed task should not be eligible (10 days old < 30 day retention for completed tasks)
			expect(eligibleTasks).toHaveLength(1)

			const incompleteTask = eligibleTasks.find((t) => t.taskId === "high-token-incomplete-task")
			expect(incompleteTask?.taskType).toBe(TaskType.INCOMPLETE)
			expect(incompleteTask?.shouldPurge).toBe(true)

			// Verify the completed task is not eligible
			const completedTaskNotEligible = eligibleTasks.find((t) => t.taskId === "truly-completed-task")
			expect(completedTaskNotEligible).toBeUndefined()
		})
	})

	describe("getTaskStorageStats", () => {
		it("should calculate storage statistics correctly", async () => {
			const now = Date.now()
			const taskHistory: HistoryItem[] = [
				{
					id: "task1",
					ts: now - 10 * 24 * 60 * 60 * 1000,
					task: "Task 1",
					tokensIn: 100,
					tokensOut: 500,
					totalCost: 0.05,
					number: 1,
					size: 1024,
				},
				{
					id: "task2",
					ts: now - 5 * 24 * 60 * 60 * 1000,
					task: "Task 2",
					tokensIn: 50,
					tokensOut: 10,
					totalCost: 0.01,
					number: 2,
					size: 512,
					isFavorited: true,
				},
			]

			// Mock file operations for completion detection
			const { fileExistsAtPath } = await import("../../../utils/fs")
			const mockFileExistsAtPath = vi.mocked(fileExistsAtPath)
			mockFileExistsAtPath.mockImplementation(async (filePath: string) => {
				// Mock UI messages file exists only for task1 (completed)
				if (filePath.includes("task1") && filePath.includes("ui_messages.json")) {
					return true
				}
				return false
			})

			const { getTaskDirectoryPath } = await import("../../../utils/storage")
			const mockGetTaskDirectoryPath = vi.mocked(getTaskDirectoryPath)
			mockGetTaskDirectoryPath.mockImplementation(async (_, taskId) => `/mock/path/${taskId}`)

			// Mock fs.readFile to return completion_result for task1
			vi.mocked(fs.readFile).mockImplementation(async (filePath: string | any) => {
				if (
					typeof filePath === "string" &&
					filePath.includes("task1") &&
					filePath.includes("ui_messages.json")
				) {
					return JSON.stringify([
						{ type: "say", say: "text", text: "Working on task..." },
						{ type: "say", say: "completion_result", text: "Task completed successfully" },
					])
				}
				throw new Error("File not found")
			})

			const stats = await autoPurgeService.getTaskStorageStats(taskHistory)

			expect(stats.totalTasks).toBe(2)
			expect(stats.totalSizeBytes).toBe(1536) // 1024 + 512
			expect(stats.tasksByType[TaskType.COMPLETED]).toBe(1)
			expect(stats.tasksByType[TaskType.FAVORITED]).toBe(1)
			expect(stats.oldestTaskTimestamp).toBe(now - 10 * 24 * 60 * 60 * 1000)
			expect(stats.newestTaskTimestamp).toBe(now - 5 * 24 * 60 * 60 * 1000)
		})
	})
})

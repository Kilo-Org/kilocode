import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import type { AutoPurgeSettings } from "@roo-code/types"
import type { Dirent } from "fs"

// Mock dependencies BEFORE importing modules that use them
// Note: vi.mock is hoisted, so we cannot use variables defined above
vi.mock("fs/promises")
vi.mock("../../utils/paths.js", () => ({
	KiloCodePaths: {
		getTasksDir: vi.fn().mockReturnValue("/mock/tasks/dir"),
		getLogsDir: vi.fn().mockReturnValue("/mock/logs/dir"),
		getConfigDir: vi.fn().mockReturnValue("/mock/config/dir"),
		getHistoryPath: vi.fn().mockReturnValue("/mock/history.json"),
	},
}))
vi.mock("../logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

// Import AFTER mocks are set up
import { AutoPurgeService } from "../auto-purge.js"
import { logs } from "../logs.js"

// Helper to create mock Dirent objects
const createMockDirent = (name: string, isDir: boolean): Dirent =>
	({
		name,
		isDirectory: () => isDir,
		isFile: () => !isDir,
		isBlockDevice: () => false,
		isCharacterDevice: () => false,
		isSymbolicLink: () => false,
		isFIFO: () => false,
		isSocket: () => false,
		path: "/mock/tasks/dir",
		parentPath: "/mock/tasks/dir",
	}) as Dirent

const mockTasksDir = "/mock/tasks/dir"

describe("AutoPurgeService", () => {
	const now = 1700000000000 // Fixed timestamp for testing

	const defaultSettings: AutoPurgeSettings = {
		enabled: true,
		defaultRetentionDays: 30,
		favoritedTaskRetentionDays: null,
		completedTaskRetentionDays: 30,
		incompleteTaskRetentionDays: 30,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		vi.setSystemTime(now)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	const createMockTask = (
		id: string,
		ageDays: number,
		status: string = "completed",
		isFavorited: boolean = false,
	) => {
		const ts = now - ageDays * 24 * 60 * 60 * 1000
		return {
			id,
			ts,
			task: `Task ${id}`,
			tokensIn: 100,
			tokensOut: 100,
			totalCost: 0.01,
			status,
			isFavorited,
		}
	}

	it("should not run if disabled", async () => {
		const service = new AutoPurgeService({ ...defaultSettings, enabled: false })
		await service.run()
		expect(fs.readdir).not.toHaveBeenCalled()
	})

	it("should purge old completed tasks", async () => {
		const service = new AutoPurgeService(defaultSettings)
		const oldTask = createMockTask("task-old", 31, "completed")
		const newTask = createMockTask("task-new", 29, "completed")

		vi.mocked(fs.readdir).mockResolvedValue([
			createMockDirent("task-old", true),
			createMockDirent("task-new", true),
		])

		vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
			if (filePath.toString().includes("task-old")) {
				return JSON.stringify(oldTask)
			}
			if (filePath.toString().includes("task-new")) {
				return JSON.stringify(newTask)
			}
			throw new Error("File not found")
		})

		await service.run()

		expect(fs.rm).toHaveBeenCalledWith(path.join(mockTasksDir, "task-old"), { recursive: true, force: true })
		expect(fs.rm).not.toHaveBeenCalledWith(path.join(mockTasksDir, "task-new"), expect.anything())
	})

	it("should purge old incomplete tasks", async () => {
		const service = new AutoPurgeService(defaultSettings)
		const oldTask = createMockTask("task-old", 31, "active") // active = incomplete

		vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-old", true)])

		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(oldTask))

		await service.run()

		expect(fs.rm).toHaveBeenCalledWith(path.join(mockTasksDir, "task-old"), { recursive: true, force: true })
	})

	it("should NOT purge favorited tasks if retention is null", async () => {
		const service = new AutoPurgeService(defaultSettings)
		const oldFavTask = createMockTask("task-fav", 100, "completed", true)

		vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-fav", true)])

		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(oldFavTask))

		await service.run()

		expect(fs.rm).not.toHaveBeenCalled()
	})

	it("should purge favorited tasks if retention is set and exceeded", async () => {
		const settings = { ...defaultSettings, favoritedTaskRetentionDays: 60 }
		const service = new AutoPurgeService(settings)
		const oldFavTask = createMockTask("task-fav", 61, "completed", true)

		vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-fav", true)])

		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(oldFavTask))

		await service.run()

		expect(fs.rm).toHaveBeenCalledWith(path.join(mockTasksDir, "task-fav"), { recursive: true, force: true })
	})

	it("should handle missing metadata files gracefully", async () => {
		const service = new AutoPurgeService(defaultSettings)

		vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-corrupt", true)])

		vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"))

		await service.run()

		expect(fs.rm).not.toHaveBeenCalled()
		expect(logs.warn).toHaveBeenCalled()
	})

	it("should handle file permission errors gracefully", async () => {
		const service = new AutoPurgeService(defaultSettings)
		const oldTask = createMockTask("task-old", 31, "completed")

		vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-old", true)])

		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(oldTask))
		vi.mocked(fs.rm).mockRejectedValue(new Error("Permission denied"))

		await service.run()

		expect(logs.error).toHaveBeenCalled()
	})

	// ============================================
	// DATA SAFETY TESTS - Critical for preventing data loss
	// ============================================

	describe("Data Safety - Preventing Accidental Data Loss", () => {
		it("should NOT purge tasks that are exactly at retention boundary", async () => {
			// Edge case: task is exactly 30 days old, retention is 30 days
			// Should NOT be purged (only purge if OLDER than retention)
			const service = new AutoPurgeService(defaultSettings)
			const boundaryTask = createMockTask("task-boundary", 30, "completed")

			vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-boundary", true)])

			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(boundaryTask))

			await service.run()

			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should NOT purge recent tasks even with very short retention", async () => {
			const settings = { ...defaultSettings, completedTaskRetentionDays: 1 }
			const service = new AutoPurgeService(settings)
			const recentTask = createMockTask("task-recent", 0.5, "completed") // 12 hours old

			vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-recent", true)])

			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(recentTask))

			await service.run()

			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should NOT purge tasks with invalid/missing timestamp", async () => {
			const service = new AutoPurgeService(defaultSettings)
			const invalidTask = {
				id: "task-invalid",
				ts: undefined, // Missing timestamp
				task: "Invalid task",
				status: "completed",
			}

			vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-invalid", true)])

			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(invalidTask))

			await service.run()

			// Should not purge - invalid timestamp results in NaN age
			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should NOT purge tasks with future timestamp (clock skew protection)", async () => {
			const service = new AutoPurgeService(defaultSettings)
			const futureTask = createMockTask("task-future", -10, "completed") // 10 days in the future

			vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-future", true)])

			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(futureTask))

			await service.run()

			// Negative age should not trigger purge
			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should NOT purge tasks with malformed JSON metadata", async () => {
			const service = new AutoPurgeService(defaultSettings)

			vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-malformed", true)])

			vi.mocked(fs.readFile).mockResolvedValue("{ invalid json }")

			await service.run()

			expect(fs.rm).not.toHaveBeenCalled()
			expect(logs.warn).toHaveBeenCalled()
		})

		it("should NOT purge non-directory entries in tasks folder", async () => {
			const service = new AutoPurgeService(defaultSettings)

			vi.mocked(fs.readdir).mockResolvedValue([
				createMockDirent("some-file.txt", false),
				createMockDirent(".DS_Store", false),
			])

			await service.run()

			expect(fs.readFile).not.toHaveBeenCalled()
			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should preserve all tasks when all retention settings are null", async () => {
			const settings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 30,
			}
			const service = new AutoPurgeService(settings)
			const oldFavTask = createMockTask("task-fav", 365, "completed", true) // 1 year old favorited

			vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-fav", true)])

			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(oldFavTask))

			await service.run()

			// Favorited tasks with null retention should NEVER be purged
			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should handle mixed valid and invalid tasks without affecting valid ones", async () => {
			const service = new AutoPurgeService(defaultSettings)
			const validOldTask = createMockTask("task-valid-old", 31, "completed")
			const validNewTask = createMockTask("task-valid-new", 5, "completed")

			vi.mocked(fs.readdir).mockResolvedValue([
				createMockDirent("task-valid-old", true),
				createMockDirent("task-corrupt", true),
				createMockDirent("task-valid-new", true),
			])

			vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
				if (filePath.toString().includes("task-valid-old")) {
					return JSON.stringify(validOldTask)
				}
				if (filePath.toString().includes("task-valid-new")) {
					return JSON.stringify(validNewTask)
				}
				if (filePath.toString().includes("task-corrupt")) {
					throw new Error("File not found")
				}
				throw new Error("Unexpected file")
			})

			await service.run()

			// Should only purge the valid old task, not the new one or corrupt one
			expect(fs.rm).toHaveBeenCalledTimes(1)
			expect(fs.rm).toHaveBeenCalledWith(path.join(mockTasksDir, "task-valid-old"), {
				recursive: true,
				force: true,
			})
		})

		it("should correctly identify task status for retention calculation", async () => {
			const settings = {
				...defaultSettings,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7, // Shorter retention for incomplete
			}
			const service = new AutoPurgeService(settings)

			// 10 days old - should be purged if incomplete (7 day retention) but not if completed (30 day retention)
			const incompleteTask = createMockTask("task-incomplete", 10, "active")
			const completedTask = createMockTask("task-completed", 10, "completed")

			vi.mocked(fs.readdir).mockResolvedValue([
				createMockDirent("task-incomplete", true),
				createMockDirent("task-completed", true),
			])

			vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
				if (filePath.toString().includes("task-incomplete")) {
					return JSON.stringify(incompleteTask)
				}
				if (filePath.toString().includes("task-completed")) {
					return JSON.stringify(completedTask)
				}
				throw new Error("Unexpected file")
			})

			await service.run()

			// Only incomplete task should be purged
			expect(fs.rm).toHaveBeenCalledTimes(1)
			expect(fs.rm).toHaveBeenCalledWith(path.join(mockTasksDir, "task-incomplete"), {
				recursive: true,
				force: true,
			})
		})

		it("should NOT delete anything outside the tasks directory (path traversal protection)", async () => {
			const service = new AutoPurgeService(defaultSettings)
			const oldTask = createMockTask("../../../etc/passwd", 31, "completed") // Path traversal attempt

			vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("../../../etc/passwd", true)])

			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(oldTask))

			await service.run()

			// Path traversal attempts should be blocked - no deletion should occur
			expect(fs.rm).not.toHaveBeenCalled()
			expect(logs.warn).toHaveBeenCalled()
		})

		it("should reject task IDs with special characters", async () => {
			const service = new AutoPurgeService(defaultSettings)
			const oldTask = createMockTask("task;rm -rf /", 31, "completed")

			vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task;rm -rf /", true)])

			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(oldTask))

			await service.run()

			// Task IDs with special characters should be rejected
			expect(fs.rm).not.toHaveBeenCalled()
			expect(logs.warn).toHaveBeenCalled()
		})

		it("should accept valid task IDs with alphanumeric, hyphens, and underscores", async () => {
			const service = new AutoPurgeService(defaultSettings)
			const oldTask = createMockTask("task-123_abc", 31, "completed")

			vi.mocked(fs.readdir).mockResolvedValue([createMockDirent("task-123_abc", true)])

			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(oldTask))

			await service.run()

			// Valid task ID should be processed
			expect(fs.rm).toHaveBeenCalledWith(path.join(mockTasksDir, "task-123_abc"), {
				recursive: true,
				force: true,
			})
		})
	})
})

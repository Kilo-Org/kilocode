import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"

import { AutoPurgeScheduler } from "../AutoPurgeScheduler"
import { type AutoPurgeSettings, type HistoryItem, TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

// Mock dependencies
vi.mock("vscode")
vi.mock("@roo-code/telemetry")

const mockVscode = vi.mocked(vscode)
const mockTelemetryService = vi.mocked(TelemetryService)

describe("AutoPurgeScheduler", () => {
	let scheduler: AutoPurgeScheduler
	let mockGlobalStoragePath: string
	let mockGetSettings: ReturnType<typeof vi.fn<() => Promise<AutoPurgeSettings>>>
	let mockGetTaskHistory: ReturnType<typeof vi.fn<() => Promise<HistoryItem[]>>>
	let mockGetCurrentTaskId: ReturnType<typeof vi.fn<() => string | undefined>>

	beforeEach(() => {
		mockGlobalStoragePath = "/mock/storage/path"
		scheduler = new AutoPurgeScheduler(mockGlobalStoragePath)

		// Setup mock functions
		mockGetSettings = vi.fn()
		mockGetTaskHistory = vi.fn()
		mockGetCurrentTaskId = vi.fn()

		// Setup default mock implementations
		Object.defineProperty(mockTelemetryService, "instance", {
			value: {
				captureEvent: vi.fn(),
			},
			writable: true,
		})

		mockVscode.window = {
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
		} as any

		// Clear all timers
		vi.clearAllTimers()
		vi.useFakeTimers()
	})

	afterEach(() => {
		scheduler.stop()
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	describe("start", () => {
		it("should schedule initial purge check after startup delay", () => {
			const mockSettings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			mockGetSettings.mockResolvedValue(mockSettings)
			mockGetTaskHistory.mockResolvedValue([])

			scheduler.start(mockGetSettings, mockGetTaskHistory, mockGetCurrentTaskId)

			const status = scheduler.getStatus()
			expect(status.isScheduled).toBe(true)
			expect(status.isRunning).toBe(false)
		})

		it("should not run purge when disabled", async () => {
			const mockSettings: AutoPurgeSettings = {
				enabled: false, // Disabled
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			mockGetSettings.mockResolvedValue(mockSettings)
			mockGetTaskHistory.mockResolvedValue([])

			scheduler.start(mockGetSettings, mockGetTaskHistory, mockGetCurrentTaskId)

			// Fast-forward past startup delay
			await vi.advanceTimersByTimeAsync(30000)

			// Should not have called the purge service
			expect(mockGetTaskHistory).not.toHaveBeenCalled()
		})
	})

	describe("triggerManualPurge", () => {
		it("should capture telemetry for manual purge", async () => {
			const mockSettings: AutoPurgeSettings = {
				enabled: true,
				defaultRetentionDays: 30,
				favoritedTaskRetentionDays: null,
				completedTaskRetentionDays: 30,
				incompleteTaskRetentionDays: 7,
			}

			const mockTaskHistory: HistoryItem[] = [
				{
					id: "task1",
					ts: Date.now() - 31 * 24 * 60 * 60 * 1000,
					task: "Old task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					number: 1,
				},
			]

			// Mock the purgeOldTasks method to avoid actual execution
			const mockPurgeOldTasks = vi.fn().mockResolvedValue({
				totalTasksScanned: 1,
				tasksEligibleForPurge: 1,
				tasksSuccessfullyPurged: 1,
				tasksPurgeErrors: 0,
				diskSpaceFreedBytes: 1024,
				errors: [],
				duration: 100,
				timestamp: Date.now(),
			})

			// Replace the method on the instance
			;(scheduler as any).autoPurgeService = {
				purgeOldTasks: mockPurgeOldTasks,
			}

			await scheduler.triggerManualPurge(mockSettings, mockTaskHistory, "current-task")

			expect(mockTelemetryService.instance.captureEvent).toHaveBeenCalledWith(
				TelemetryEventName.MANUAL_PURGE_TRIGGERED,
				{
					totalTasks: 1,
				},
			)
		})
	})

	describe("getStatus", () => {
		it("should return correct status information", () => {
			const status = scheduler.getStatus()

			expect(status).toHaveProperty("isRunning")
			expect(status).toHaveProperty("isScheduled")
			expect(status).toHaveProperty("nextRunTime")
			expect(typeof status.isRunning).toBe("boolean")
			expect(typeof status.isScheduled).toBe("boolean")
		})
	})

	describe("stop", () => {
		it("should clear scheduled timeouts", () => {
			scheduler.start(mockGetSettings, mockGetTaskHistory, mockGetCurrentTaskId)

			let statusBefore = scheduler.getStatus()
			expect(statusBefore.isScheduled).toBe(true)

			scheduler.stop()

			let statusAfter = scheduler.getStatus()
			expect(statusAfter.isScheduled).toBe(false)
		})
	})
})

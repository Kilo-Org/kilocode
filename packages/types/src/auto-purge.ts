// kilocode_change - file added
import { z } from "zod"
import type { HistoryItem } from "./history.js"

/**
 * Auto-purge configuration schema
 */
export const autoPurgeSettingsSchema = z.object({
	enabled: z.boolean(),
	defaultRetentionDays: z.number().min(1),
	favoritedTaskRetentionDays: z.number().min(1).nullable(), // null = never purge
	completedTaskRetentionDays: z.number().min(1),
	incompleteTaskRetentionDays: z.number().min(1),
	lastRunTimestamp: z.number().optional(),
})

export type AutoPurgeSettings = z.infer<typeof autoPurgeSettingsSchema>

/**
 * Task classification for purge policies
 */
export enum TaskType {
	FAVORITED = "favorited",
	COMPLETED = "completed",
	INCOMPLETE = "incomplete",
	REGULAR = "regular",
}

/**
 * Information about a task eligible for purging
 */
export interface TaskPurgeInfo {
	taskId: string
	historyItem: HistoryItem
	taskType: TaskType
	ageInDays: number
	shouldPurge: boolean
	retentionDays: number
	taskDirectoryPath: string
}

/**
 * Result of a purge operation
 */
export interface PurgeResult {
	totalTasksScanned: number
	tasksEligibleForPurge: number
	tasksSuccessfullyPurged: number
	tasksPurgeErrors: number
	diskSpaceFreedBytes: number
	errors: PurgeError[]
	duration: number
	timestamp: number
}

/**
 * Error information for failed purge operations
 */
export interface PurgeError {
	taskId: string
	error: string
	operation: "delete_files" | "remove_history" | "classify_task"
}

/**
 * Options for purge operations
 */
export interface PurgeOptions {
	dryRun?: boolean
	maxTasksToProcess?: number
	skipActiveTask?: boolean
}

/**
 * Statistics about task storage
 */
export interface TaskStorageStats {
	totalTasks: number
	totalSizeBytes: number
	tasksByType: Record<TaskType, number>
	oldestTaskTimestamp: number
	newestTaskTimestamp: number
}

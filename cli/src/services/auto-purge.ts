import * as fs from "fs/promises"
import * as path from "path"
import type { AutoPurgeSettings, HistoryItem } from "@roo-code/types"
import { KiloCodePaths } from "../utils/paths.js"
import { logs } from "./logs.js"

export class AutoPurgeService {
	constructor(private settings: AutoPurgeSettings) {}

	async run(): Promise<void> {
		if (!this.settings.enabled) {
			logs.debug("Auto-purge is disabled", "AutoPurgeService")
			return
		}

		const tasksDir = KiloCodePaths.getTasksDir()
		logs.debug(`Starting auto-purge scan in ${tasksDir}`, "AutoPurgeService")

		try {
			// Check if tasks directory exists
			try {
				await fs.access(tasksDir)
			} catch {
				logs.debug("Tasks directory does not exist, skipping auto-purge", "AutoPurgeService")
				return
			}

			const entries = await fs.readdir(tasksDir, { withFileTypes: true })
			const taskDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

			logs.debug(`Found ${taskDirs.length} task directories`, "AutoPurgeService")

			let purgedCount = 0
			let errorCount = 0

			for (const taskId of taskDirs) {
				try {
					// SAFETY: Validate task ID to prevent path traversal attacks
					// Only allow alphanumeric characters, hyphens, and underscores
					if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
						logs.warn(`Skipping task with invalid ID: ${taskId}`, "AutoPurgeService")
						continue
					}

					const taskPath = path.join(tasksDir, taskId)

					// SAFETY: Verify the resolved path is still within the tasks directory
					const resolvedTaskPath = path.resolve(taskPath)
					const resolvedTasksDir = path.resolve(tasksDir)
					if (!resolvedTaskPath.startsWith(resolvedTasksDir + path.sep)) {
						logs.warn(`Skipping task with path outside tasks directory: ${taskId}`, "AutoPurgeService")
						continue
					}

					const metadataPath = path.join(taskPath, "task_metadata.json")

					// Read metadata
					const metadataContent = await fs.readFile(metadataPath, "utf-8")
					const historyItem = JSON.parse(metadataContent) as HistoryItem

					if (this.shouldPurge(historyItem)) {
						logs.info(
							`Purging task ${taskId} (Age: ${this.getAgeInDays(historyItem.ts).toFixed(1)} days)`,
							"AutoPurgeService",
						)
						try {
							await fs.rm(taskPath, { recursive: true, force: true })
							purgedCount++
						} catch (rmError) {
							logs.error(`Failed to delete task ${taskId}`, "AutoPurgeService", { error: rmError })
							errorCount++
						}
					}
				} catch (error) {
					// Skip tasks with missing metadata or other errors
					logs.warn(`Failed to process task ${taskId} for auto-purge`, "AutoPurgeService", { error })
					errorCount++
				}
			}

			logs.info(`Auto-purge completed. Purged: ${purgedCount}, Errors: ${errorCount}`, "AutoPurgeService")
		} catch (error) {
			logs.error("Auto-purge failed", "AutoPurgeService", { error })
		}
	}

	private shouldPurge(task: HistoryItem): boolean {
		const ageInDays = this.getAgeInDays(task.ts)

		// SAFETY: Never purge tasks with invalid timestamps
		// This protects against data loss from corrupted metadata
		if (!Number.isFinite(ageInDays) || ageInDays < 0) {
			logs.debug(`Skipping task with invalid age: ${ageInDays}`, "AutoPurgeService")
			return false
		}

		// Determine retention period based on task type
		let retentionDays = this.settings.defaultRetentionDays

		if (task.isFavorited) {
			if (this.settings.favoritedTaskRetentionDays === null) {
				return false // Never purge favorited tasks if null
			}
			retentionDays = this.settings.favoritedTaskRetentionDays
		} else if (task.status === "completed") {
			retentionDays = this.settings.completedTaskRetentionDays
		} else {
			// Incomplete/Active/Delegated
			retentionDays = this.settings.incompleteTaskRetentionDays
		}

		// SAFETY: Use strict greater-than comparison
		// Tasks exactly at the retention boundary are NOT purged
		return ageInDays > retentionDays
	}

	private getAgeInDays(timestamp: number): number {
		const now = Date.now()
		const diffMs = now - timestamp
		return diffMs / (1000 * 60 * 60 * 24)
	}
}

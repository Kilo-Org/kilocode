/**
 * Task resume utilities for CLI
 * Handles finding and resuming the last conversation from a workspace
 */

import * as fs from "fs/promises"
import * as path from "path"
import { KiloCodePaths } from "./paths.js"
import { logs } from "../services/logs.js"
import type { HistoryItem } from "../types/messages.js"

/**
 * Load global state from disk
 */
async function loadGlobalState(): Promise<Record<string, any>> {
	try {
		const globalStatePath = path.join(KiloCodePaths.getGlobalStorageDir(), "global-state.json")
		const exists = await fs
			.access(globalStatePath)
			.then(() => true)
			.catch(() => false)

		if (!exists) {
			logs.debug("Global state file does not exist", "TaskResume")
			return {}
		}

		const content = await fs.readFile(globalStatePath, "utf-8")
		return JSON.parse(content)
	} catch (error) {
		logs.error("Failed to load global state", "TaskResume", { error })
		return {}
	}
}

/**
 * Get the last task from the current workspace
 * Returns the most recent task based on timestamp
 */
export async function getLastTaskForWorkspace(workspacePath: string): Promise<HistoryItem | null> {
	try {
		const globalState = await loadGlobalState()
		const taskHistory = (globalState.taskHistory as HistoryItem[] | undefined) || []

		logs.debug("Task history loaded", "TaskResume", {
			totalTasks: taskHistory.length,
			workspace: workspacePath,
		})

		// Filter tasks by workspace and sort by timestamp (most recent first)
		const workspaceTasks = taskHistory
			.filter((task) => task.workspace === workspacePath)
			.sort((a, b) => b.ts - a.ts)

		if (workspaceTasks.length === 0) {
			logs.debug("No tasks found for workspace", "TaskResume", { workspace: workspacePath })
			return null
		}

		const lastTask = workspaceTasks[0]
		if (!lastTask) {
			return null
		}

		logs.info("Found last task for workspace", "TaskResume", {
			taskId: lastTask.id,
			timestamp: lastTask.ts,
			task: lastTask.task?.substring(0, 50) + "...",
		})

		return lastTask
	} catch (error) {
		logs.error("Failed to get last task for workspace", "TaskResume", { error })
		return null
	}
}

/**
 * Check if task files exist on disk
 */
export async function taskFilesExist(taskId: string): Promise<boolean> {
	try {
		const globalStoragePath = KiloCodePaths.getGlobalStorageDir()
		const taskDir = path.join(globalStoragePath, "tasks", taskId)

		// Check if task directory exists
		const exists = await fs
			.access(taskDir)
			.then(() => true)
			.catch(() => false)

		if (!exists) {
			logs.warn("Task directory does not exist", "TaskResume", { taskId, taskDir })
			return false
		}

		// Check if required files exist
		const apiHistoryFile = path.join(taskDir, "api_conversation_history.json")
		const uiMessagesFile = path.join(taskDir, "ui_messages.json")

		const apiHistoryExists = await fs
			.access(apiHistoryFile)
			.then(() => true)
			.catch(() => false)

		const uiMessagesExists = await fs
			.access(uiMessagesFile)
			.then(() => true)
			.catch(() => false)

		if (!apiHistoryExists) {
			logs.warn("API conversation history file does not exist", "TaskResume", { taskId, apiHistoryFile })
		}

		if (!uiMessagesExists) {
			logs.warn("UI messages file does not exist", "TaskResume", { taskId, uiMessagesFile })
		}

		// We need at least one of these files to resume
		return apiHistoryExists || uiMessagesExists
	} catch (error) {
		logs.error("Failed to check task files", "TaskResume", { error, taskId })
		return false
	}
}

/**
 * Get a user-friendly error message when no tasks are found
 */
export function getNoTasksErrorMessage(workspacePath: string): string {
	return `No previous conversations found for workspace: ${workspacePath}\n\nStart a new conversation by running 'kilocode' without the -c flag.`
}

/**
 * Get a user-friendly error message when task files are not found
 */
export function getTaskFilesNotFoundErrorMessage(taskId: string): string {
	return `Task files not found for task ID: ${taskId}\n\nThe conversation may have been deleted or corrupted.\nTry starting a new conversation by running 'kilocode' without the -c flag.`
}

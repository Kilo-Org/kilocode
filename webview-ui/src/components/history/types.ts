import type { HistoryItem } from "@roo-code/types"

/**
 * Extended HistoryItem with display-related fields for search highlighting and subtask indication
 */
export interface DisplayHistoryItem extends HistoryItem {
	/** HTML string with search match highlighting */
	highlight?: string
	/** Whether this task is a subtask (has a parent in the current task list) */
	isSubtask?: boolean
}

/**
 * A group of tasks consisting of a parent task and its subtasks
 */
export interface TaskGroup {
	/** The parent task */
	parent: DisplayHistoryItem
	/** List of direct subtasks */
	subtasks: DisplayHistoryItem[]
	/** Whether the subtask list is expanded */
	isExpanded: boolean
}

/**
 * Result from the useGroupedTasks hook
 */
export interface GroupedTasksResult {
	/** Groups of tasks (parent + subtasks) - used in normal view */
	groups: TaskGroup[]
	/** Flat list of tasks with isSubtask flag - used in search mode */
	flatTasks: DisplayHistoryItem[] | null
	/** Function to toggle expand/collapse state of a group */
	toggleExpand: (taskId: string) => void
	/** Whether search mode is active */
	isSearchMode: boolean
}

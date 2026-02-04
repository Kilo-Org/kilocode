import { useState, useMemo, useCallback } from "react"
import type { HistoryItem } from "@roo-code/types"
import type { DisplayHistoryItem, TaskGroup, GroupedTasksResult } from "./types"

/**
 * Hook to transform a flat task list into grouped structure based on parent-child relationships.
 * In search mode, returns a flat list with isSubtask flag for each item.
 *
 * @param tasks - The list of tasks to group
 * @param searchQuery - Current search query (empty string means not searching)
 * @returns GroupedTasksResult with groups, flatTasks, toggleExpand, and isSearchMode
 */
export function useGroupedTasks(tasks: HistoryItem[], searchQuery: string): GroupedTasksResult {
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

	const isSearchMode = searchQuery.trim().length > 0

	// Build a map of taskId -> HistoryItem for quick lookup
	const taskMap = useMemo(() => {
		const map = new Map<string, HistoryItem>()
		for (const task of tasks) {
			map.set(task.id, task)
		}
		return map
	}, [tasks])

	// Group tasks by parent-child relationship
	const groups = useMemo((): TaskGroup[] => {
		if (isSearchMode) {
			// In search mode, we don't group - return empty groups
			return []
		}

		// Build children map: parentId -> children[]
		const childrenMap = new Map<string, HistoryItem[]>()

		for (const task of tasks) {
			if (task.parentTaskId && taskMap.has(task.parentTaskId)) {
				const siblings = childrenMap.get(task.parentTaskId) || []
				siblings.push(task)
				childrenMap.set(task.parentTaskId, siblings)
			}
		}

		// Identify root tasks - tasks that either:
		// 1. Have no parentTaskId
		// 2. Have a parentTaskId that doesn't exist in our task list
		const rootTasks = tasks.filter((task) => !task.parentTaskId || !taskMap.has(task.parentTaskId))

		// Build groups from root tasks
		const taskGroups: TaskGroup[] = rootTasks.map((parent) => {
			// Get direct children (sorted by timestamp, newest first)
			const subtasks = (childrenMap.get(parent.id) || [])
				.slice()
				.sort((a, b) => b.ts - a.ts) as DisplayHistoryItem[]

			return {
				parent: parent as DisplayHistoryItem,
				subtasks,
				isExpanded: expandedIds.has(parent.id),
			}
		})

		// Sort groups by parent timestamp (newest first)
		taskGroups.sort((a, b) => b.parent.ts - a.parent.ts)

		return taskGroups
	}, [tasks, taskMap, isSearchMode, expandedIds])

	// Flatten tasks for search mode with isSubtask flag
	const flatTasks = useMemo((): DisplayHistoryItem[] | null => {
		if (!isSearchMode) {
			return null
		}

		return tasks.map((task) => ({
			...task,
			isSubtask: !!task.parentTaskId && taskMap.has(task.parentTaskId),
		})) as DisplayHistoryItem[]
	}, [tasks, taskMap, isSearchMode])

	// Toggle expand/collapse for a group
	const toggleExpand = useCallback((taskId: string) => {
		setExpandedIds((prev) => {
			const newSet = new Set(prev)
			if (newSet.has(taskId)) {
				newSet.delete(taskId)
			} else {
				newSet.add(taskId)
			}
			return newSet
		})
	}, [])

	return {
		groups,
		flatTasks,
		toggleExpand,
		isSearchMode,
	}
}

/**
 * Hook for managing tasks and todos
 * Provides access to current task, todos, and task actions
 */

import { useAtomValue } from "jotai"
import { useMemo } from "react"
import type { HistoryItem, TodoItem } from "../../types/messages.js"
import {
	currentTaskAtom,
	taskTodosAtom,
	hasActiveTaskAtom,
	pendingTodosCountAtom,
	completedTodosCountAtom,
	inProgressTodosCountAtom,
} from "../atoms/extension.js"

/**
 * Todo filter function type
 */
export type TodoFilter = (todo: TodoItem) => boolean

/**
 * Return type for useTaskManagement hook
 */
export interface UseTaskManagementReturn {
	/** The current task (null if no active task) */
	currentTask: HistoryItem | null
	/** All todos for the current task */
	todos: TodoItem[]
	/** Whether there is an active task */
	hasActiveTask: boolean
	/** Count of pending todos */
	pendingCount: number
	/** Count of completed todos */
	completedCount: number
	/** Count of in-progress todos */
	inProgressCount: number
	/** Total count of todos */
	totalCount: number
	/** Get todos by status */
	getTodosByStatus: (status: "pending" | "in_progress" | "completed") => TodoItem[]
	/** Filter todos with a custom function */
	filterTodos: (filter: TodoFilter) => TodoItem[]
	/** Get the next pending todo */
	getNextPendingTodo: () => TodoItem | null
	/** Get the current in-progress todo */
	getCurrentTodo: () => TodoItem | null
	/** Calculate completion percentage */
	completionPercentage: number
}

/**
 * Hook for managing tasks and todos
 *
 * Provides access to the current task and its associated todos with filtering
 * and status tracking utilities. Task state is automatically synchronized with
 * the extension.
 *
 * @example
 * ```tsx
 * function TaskPanel() {
 *   const {
 *     currentTask,
 *     todos,
 *     hasActiveTask,
 *     completionPercentage,
 *     getTodosByStatus
 *   } = useTaskManagement()
 *
 *   if (!hasActiveTask) {
 *     return <div>No active task</div>
 *   }
 *
 *   const pendingTodos = getTodosByStatus('pending')
 *
 *   return (
 *     <div>
 *       <h2>{currentTask.task}</h2>
 *       <progress value={completionPercentage} max={100} />
 *       <h3>Pending ({pendingTodos.length})</h3>
 *       {pendingTodos.map(todo => (
 *         <div key={todo.id}>{todo.text}</div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useTaskManagement(): UseTaskManagementReturn {
	// Read atoms
	const currentTask = useAtomValue(currentTaskAtom)
	const todos = useAtomValue(taskTodosAtom)
	const hasActiveTask = useAtomValue(hasActiveTaskAtom)
	const pendingCount = useAtomValue(pendingTodosCountAtom)
	const completedCount = useAtomValue(completedTodosCountAtom)
	const inProgressCount = useAtomValue(inProgressTodosCountAtom)

	// Memoized filter functions
	const getTodosByStatus = useMemo(
		() => (status: "pending" | "in_progress" | "completed") => {
			return todos.filter((todo) => todo.status === status)
		},
		[todos],
	)

	const filterTodos = useMemo(
		() => (filter: TodoFilter) => {
			return todos.filter(filter)
		},
		[todos],
	)

	const getNextPendingTodo = useMemo(
		() => () => {
			const pending = todos.filter((todo) => todo.status === "pending")
			return pending.length > 0 ? (pending[0] ?? null) : null
		},
		[todos],
	)

	const getCurrentTodo = useMemo(
		() => () => {
			const inProgress = todos.filter((todo) => todo.status === "in_progress")
			return inProgress.length > 0 ? (inProgress[0] ?? null) : null
		},
		[todos],
	)

	// Memoized counts and calculations
	const totalCount = useMemo(() => todos.length, [todos])

	const completionPercentage = useMemo(() => {
		if (totalCount === 0) return 0
		return Math.round((completedCount / totalCount) * 100)
	}, [completedCount, totalCount])

	// Memoize return value
	return useMemo(
		() => ({
			currentTask,
			todos,
			hasActiveTask,
			pendingCount,
			completedCount,
			inProgressCount,
			totalCount,
			getTodosByStatus,
			filterTodos,
			getNextPendingTodo,
			getCurrentTodo,
			completionPercentage,
		}),
		[
			currentTask,
			todos,
			hasActiveTask,
			pendingCount,
			completedCount,
			inProgressCount,
			totalCount,
			getTodosByStatus,
			filterTodos,
			getNextPendingTodo,
			getCurrentTodo,
			completionPercentage,
		],
	)
}

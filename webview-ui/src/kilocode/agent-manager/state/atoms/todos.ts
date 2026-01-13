import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import type { TodoItem } from "@roo-code/types"

/**
 * Per-session todo list using atomFamily.
 * Tracks the latest todos extracted from session messages.
 */
export const sessionTodosAtomFamily = atomFamily((_sessionId: string) => atom<TodoItem[]>([]))

/**
 * Computed stats for a todo list.
 */
export interface TodoStats {
	todos: TodoItem[]
	completedCount: number
	totalCount: number
	inProgressTodo: TodoItem | undefined
	nextPendingTodo: TodoItem | undefined
	currentTodo: TodoItem | undefined
	allCompleted: boolean
	progressPercent: number
}

/**
 * Compute stats from a todo list. Pure function for testability.
 */
export function computeTodoStats(todos: TodoItem[]): TodoStats {
	const completedCount = todos.filter((t) => t.status === "completed").length
	const totalCount = todos.length
	const inProgressTodo = todos.find((t) => t.status === "in_progress")
	const nextPendingTodo = todos.find((t) => t.status === "pending")
	const currentTodo = inProgressTodo || nextPendingTodo
	const allCompleted = totalCount > 0 && completedCount === totalCount
	const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

	return {
		todos,
		completedCount,
		totalCount,
		inProgressTodo,
		nextPendingTodo,
		currentTodo,
		allCompleted,
		progressPercent,
	}
}

/**
 * Derived atom family for todo stats per session.
 */
export const sessionTodoStatsAtomFamily = atomFamily((sessionId: string) =>
	atom((get): TodoStats => {
		const todos = get(sessionTodosAtomFamily(sessionId))
		return computeTodoStats(todos)
	}),
)

/**
 * Action atom to update todos for a session.
 */
export const updateSessionTodosAtom = atom(null, (_get, set, payload: { sessionId: string; todos: TodoItem[] }) => {
	const { sessionId, todos } = payload
	set(sessionTodosAtomFamily(sessionId), todos)
})

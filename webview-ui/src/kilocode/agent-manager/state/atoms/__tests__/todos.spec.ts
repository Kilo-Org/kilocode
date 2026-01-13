import { describe, it, expect } from "vitest"
import { createStore } from "jotai"
import type { TodoItem } from "@roo-code/types"
import { sessionTodosAtomFamily, updateSessionTodosAtom, computeTodoStats, sessionTodoStatsAtomFamily } from "../todos"

describe("todos atom", () => {
	describe("sessionTodosAtomFamily", () => {
		it("returns empty array for new session", () => {
			const store = createStore()
			const todos = store.get(sessionTodosAtomFamily("session-1"))
			expect(todos).toEqual([])
		})

		it("isolates todos between sessions", () => {
			const store = createStore()
			const todos1: TodoItem[] = [{ id: "1", content: "Task 1", status: "pending" }]
			const todos2: TodoItem[] = [{ id: "2", content: "Task 2", status: "completed" }]

			store.set(updateSessionTodosAtom, { sessionId: "session-1", todos: todos1 })
			store.set(updateSessionTodosAtom, { sessionId: "session-2", todos: todos2 })

			expect(store.get(sessionTodosAtomFamily("session-1"))).toEqual(todos1)
			expect(store.get(sessionTodosAtomFamily("session-2"))).toEqual(todos2)
		})
	})

	describe("updateSessionTodosAtom", () => {
		it("updates todos for a session", () => {
			const store = createStore()
			const todos: TodoItem[] = [
				{ id: "1", content: "First", status: "in_progress" },
				{ id: "2", content: "Second", status: "pending" },
			]

			store.set(updateSessionTodosAtom, { sessionId: "session-1", todos })

			expect(store.get(sessionTodosAtomFamily("session-1"))).toEqual(todos)
		})

		it("replaces existing todos", () => {
			const store = createStore()
			const oldTodos: TodoItem[] = [{ id: "1", content: "Old", status: "pending" }]
			const newTodos: TodoItem[] = [{ id: "2", content: "New", status: "completed" }]

			store.set(updateSessionTodosAtom, { sessionId: "session-1", todos: oldTodos })
			store.set(updateSessionTodosAtom, { sessionId: "session-1", todos: newTodos })

			expect(store.get(sessionTodosAtomFamily("session-1"))).toEqual(newTodos)
		})
	})

	describe("computeTodoStats", () => {
		it("returns zero stats for empty todos", () => {
			const stats = computeTodoStats([])
			expect(stats.totalCount).toBe(0)
			expect(stats.completedCount).toBe(0)
			expect(stats.progressPercent).toBe(0)
			expect(stats.allCompleted).toBe(false)
			expect(stats.currentTodo).toBeUndefined()
			expect(stats.inProgressTodo).toBeUndefined()
			expect(stats.nextPendingTodo).toBeUndefined()
		})

		it("calculates correct counts", () => {
			const todos: TodoItem[] = [
				{ id: "1", content: "Done", status: "completed" },
				{ id: "2", content: "Working", status: "in_progress" },
				{ id: "3", content: "Waiting", status: "pending" },
			]
			const stats = computeTodoStats(todos)
			expect(stats.totalCount).toBe(3)
			expect(stats.completedCount).toBe(1)
		})

		it("calculates progress percent correctly", () => {
			const todos: TodoItem[] = [
				{ id: "1", content: "Done", status: "completed" },
				{ id: "2", content: "Waiting", status: "pending" },
			]
			const stats = computeTodoStats(todos)
			expect(stats.progressPercent).toBe(50)
		})

		it("handles division by zero for empty todos", () => {
			const stats = computeTodoStats([])
			expect(stats.progressPercent).toBe(0)
		})

		it("identifies in-progress todo", () => {
			const todos: TodoItem[] = [
				{ id: "1", content: "Done", status: "completed" },
				{ id: "2", content: "Working", status: "in_progress" },
				{ id: "3", content: "Waiting", status: "pending" },
			]
			const stats = computeTodoStats(todos)
			expect(stats.inProgressTodo).toEqual({ id: "2", content: "Working", status: "in_progress" })
			expect(stats.currentTodo).toEqual({ id: "2", content: "Working", status: "in_progress" })
		})

		it("falls back to next pending when no in-progress", () => {
			const todos: TodoItem[] = [
				{ id: "1", content: "Done", status: "completed" },
				{ id: "2", content: "Waiting", status: "pending" },
				{ id: "3", content: "Also waiting", status: "pending" },
			]
			const stats = computeTodoStats(todos)
			expect(stats.inProgressTodo).toBeUndefined()
			expect(stats.nextPendingTodo).toEqual({ id: "2", content: "Waiting", status: "pending" })
			expect(stats.currentTodo).toEqual({ id: "2", content: "Waiting", status: "pending" })
		})

		it("detects all completed", () => {
			const todos: TodoItem[] = [
				{ id: "1", content: "Done 1", status: "completed" },
				{ id: "2", content: "Done 2", status: "completed" },
			]
			const stats = computeTodoStats(todos)
			expect(stats.allCompleted).toBe(true)
			expect(stats.progressPercent).toBe(100)
		})

		it("allCompleted is false when not all done", () => {
			const todos: TodoItem[] = [
				{ id: "1", content: "Done", status: "completed" },
				{ id: "2", content: "Pending", status: "pending" },
			]
			const stats = computeTodoStats(todos)
			expect(stats.allCompleted).toBe(false)
		})

		it("allCompleted is false for empty list", () => {
			const stats = computeTodoStats([])
			expect(stats.allCompleted).toBe(false)
		})

		it("includes original todos in stats", () => {
			const todos: TodoItem[] = [{ id: "1", content: "Task", status: "pending" }]
			const stats = computeTodoStats(todos)
			expect(stats.todos).toBe(todos)
		})
	})

	describe("sessionTodoStatsAtomFamily", () => {
		it("derives stats from session todos", () => {
			const store = createStore()
			const todos: TodoItem[] = [
				{ id: "1", content: "Done", status: "completed" },
				{ id: "2", content: "Working", status: "in_progress" },
			]

			store.set(updateSessionTodosAtom, { sessionId: "session-1", todos })

			const stats = store.get(sessionTodoStatsAtomFamily("session-1"))
			expect(stats.totalCount).toBe(2)
			expect(stats.completedCount).toBe(1)
			expect(stats.progressPercent).toBe(50)
			expect(stats.inProgressTodo?.id).toBe("2")
		})

		it("returns zero stats for new session", () => {
			const store = createStore()
			const stats = store.get(sessionTodoStatsAtomFamily("new-session"))
			expect(stats.totalCount).toBe(0)
			expect(stats.completedCount).toBe(0)
		})

		it("updates when source todos change", () => {
			const store = createStore()

			store.set(updateSessionTodosAtom, {
				sessionId: "session-1",
				todos: [{ id: "1", content: "Task", status: "pending" }],
			})
			expect(store.get(sessionTodoStatsAtomFamily("session-1")).completedCount).toBe(0)

			store.set(updateSessionTodosAtom, {
				sessionId: "session-1",
				todos: [{ id: "1", content: "Task", status: "completed" }],
			})
			expect(store.get(sessionTodoStatsAtomFamily("session-1")).completedCount).toBe(1)
		})
	})
})

import { describe, it, expect } from "vitest"
import { createStore } from "jotai"
import type { ClineMessage, TodoItem } from "@roo-code/types"
import { sessionTodosAtomFamily, updateSessionTodosAtom, extractTodosFromMessages } from "../todos"

describe("todos atom", () => {
	describe("extractTodosFromMessages", () => {
		it("returns empty array when no messages", () => {
			expect(extractTodosFromMessages([])).toEqual([])
		})

		it("extracts todos from ask:tool message with updateTodoList", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "updateTodoList",
						todos: [
							{ id: "1", content: "First task", status: "in_progress" },
							{ id: "2", content: "Second task", status: "pending" },
						],
					}),
				},
			]

			const todos = extractTodosFromMessages(messages)
			expect(todos).toEqual([
				{ id: "1", content: "First task", status: "in_progress" },
				{ id: "2", content: "Second task", status: "pending" },
			])
		})

		it("extracts todos from say:user_edit_todos message", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "say",
					say: "user_edit_todos",
					text: JSON.stringify({
						tool: "updateTodoList",
						todos: [{ id: "1", content: "Edited task", status: "completed" }],
					}),
				},
			]

			const todos = extractTodosFromMessages(messages)
			expect(todos).toEqual([{ id: "1", content: "Edited task", status: "completed" }])
		})

		it("returns latest todos when multiple updates exist", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "updateTodoList",
						todos: [{ id: "1", content: "Old task", status: "pending" }],
					}),
				},
				{
					ts: 2,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "updateTodoList",
						todos: [
							{ id: "1", content: "Old task", status: "completed" },
							{ id: "2", content: "New task", status: "in_progress" },
						],
					}),
				},
			]

			const todos = extractTodosFromMessages(messages)
			expect(todos).toEqual([
				{ id: "1", content: "Old task", status: "completed" },
				{ id: "2", content: "New task", status: "in_progress" },
			])
		})

		it("ignores non-updateTodoList tool messages", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "readFile",
						path: "/some/file.ts",
					}),
				},
			]

			expect(extractTodosFromMessages(messages)).toEqual([])
		})

		it("handles malformed JSON gracefully", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: "not valid json",
				},
			]

			expect(extractTodosFromMessages(messages)).toEqual([])
		})

		it("handles missing text field", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
				},
			]

			expect(extractTodosFromMessages(messages)).toEqual([])
		})

		it("extracts todos from metadata (CLI format)", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					metadata: {
						tool: "updateTodoList",
						todos: [{ id: "1", content: "Task from metadata", status: "in_progress" }],
					},
				} as ClineMessage,
			]

			const todos = extractTodosFromMessages(messages)
			expect(todos).toEqual([{ id: "1", content: "Task from metadata", status: "in_progress" }])
		})

		it("prefers metadata over text when both exist", () => {
			const messages: ClineMessage[] = [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "updateTodoList",
						todos: [{ id: "1", content: "From text", status: "pending" }],
					}),
					metadata: {
						tool: "updateTodoList",
						todos: [{ id: "2", content: "From metadata", status: "in_progress" }],
					},
				} as ClineMessage,
			]

			const todos = extractTodosFromMessages(messages)
			expect(todos).toEqual([{ id: "2", content: "From metadata", status: "in_progress" }])
		})
	})

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
})

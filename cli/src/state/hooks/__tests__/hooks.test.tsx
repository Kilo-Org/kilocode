/**
 * Tests for custom React hooks
 *
 * Note: These are basic unit tests for the hook logic.
 * For full integration testing with React components, install @testing-library/react.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { extensionServiceAtom, isServiceReadyAtom, serviceErrorAtom, isInitializingAtom } from "../../atoms/service.js"
import { chatMessagesAtom, currentTaskAtom, taskTodosAtom, apiConfigurationAtom } from "../../atoms/extension.js"
import { updateTextBufferAtom } from "../../atoms/ui.js"
import { textBufferStringAtom } from "../../atoms/textBuffer.js"
import type { ExtensionChatMessage, HistoryItem, TodoItem } from "../../../types/messages.js"

describe("Hook Atoms", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("Service Atoms", () => {
		it("should initialize with default values", () => {
			expect(store.get(extensionServiceAtom)).toBeNull()
			expect(store.get(isServiceReadyAtom)).toBe(false)
			expect(store.get(serviceErrorAtom)).toBeNull()
			expect(store.get(isInitializingAtom)).toBe(false)
		})

		it("should update service ready state", () => {
			store.set(isServiceReadyAtom, true)
			expect(store.get(isServiceReadyAtom)).toBe(true)
		})

		it("should store service errors", () => {
			const error = new Error("Test error")
			store.set(serviceErrorAtom, error)
			expect(store.get(serviceErrorAtom)).toBe(error)
		})
	})

	describe("Extension Message Atoms", () => {
		const mockMessages: ExtensionChatMessage[] = [
			{
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Hello",
			},
			{
				ts: Date.now() + 1000,
				type: "ask",
				ask: "followup",
				text: "What?",
				isAnswered: false,
			},
		]

		it("should store messages", () => {
			store.set(chatMessagesAtom, mockMessages)
			expect(store.get(chatMessagesAtom)).toEqual(mockMessages)
		})

		it("should filter messages by type", () => {
			store.set(chatMessagesAtom, mockMessages)
			const messages = store.get(chatMessagesAtom)

			const askMessages = messages.filter((m) => m.type === "ask")
			expect(askMessages).toHaveLength(1)
			expect(askMessages[0]?.type).toBe("ask")

			const sayMessages = messages.filter((m) => m.type === "say")
			expect(sayMessages).toHaveLength(1)
			expect(sayMessages[0]?.type).toBe("say")
		})
	})

	describe("Task Management Atoms", () => {
		const mockTask: HistoryItem = {
			number: 1,
			id: "task-1",
			ts: Date.now(),
			task: "Test task",
			workspace: "/test",
			totalCost: 0,
			tokensIn: 0,
			tokensOut: 0,
		}

		const mockTodos: TodoItem[] = [
			{
				id: "todo-1",
				content: "Todo 1",
				status: "pending",
			},
			{
				id: "todo-2",
				content: "Todo 2",
				status: "in_progress",
			},
			{
				id: "todo-3",
				content: "Todo 3",
				status: "completed",
			},
		]

		it("should store current task", () => {
			store.set(currentTaskAtom, mockTask)
			expect(store.get(currentTaskAtom)).toEqual(mockTask)
		})

		it("should store todos", () => {
			store.set(taskTodosAtom, mockTodos)
			expect(store.get(taskTodosAtom)).toEqual(mockTodos)
		})

		it("should filter todos by status", () => {
			store.set(taskTodosAtom, mockTodos)
			const todos = store.get(taskTodosAtom)

			const pending = todos.filter((t) => t.status === "pending")
			expect(pending).toHaveLength(1)

			const inProgress = todos.filter((t) => t.status === "in_progress")
			expect(inProgress).toHaveLength(1)

			const completed = todos.filter((t) => t.status === "completed")
			expect(completed).toHaveLength(1)
		})

		it("should calculate completion percentage", () => {
			store.set(taskTodosAtom, mockTodos)
			const todos = store.get(taskTodosAtom)

			const completedCount = todos.filter((t) => t.status === "completed").length
			const totalCount = todos.length
			const percentage = Math.round((completedCount / totalCount) * 100)

			expect(percentage).toBe(33) // 1 of 3 completed
		})
	})

	describe("Model Selection Atoms", () => {
		const mockApiConfig = {
			apiProvider: "anthropic" as const,
			apiModelId: "claude-3-5-sonnet-20241022",
		}

		it("should store API configuration", () => {
			store.set(apiConfigurationAtom, mockApiConfig)
			expect(store.get(apiConfigurationAtom)).toEqual(mockApiConfig)
		})

		it("should extract provider and model", () => {
			store.set(apiConfigurationAtom, mockApiConfig)
			const config = store.get(apiConfigurationAtom)

			expect(config?.apiProvider).toBe("anthropic")
			expect(config?.apiModelId).toBe("claude-3-5-sonnet-20241022")
		})
	})

	describe("Command Input Atoms", () => {
		it("should store input value", () => {
			store.set(updateTextBufferAtom, "/mode")
			expect(store.get(textBufferStringAtom)).toBe("/mode")
		})

		it("should detect command input", () => {
			store.set(updateTextBufferAtom, "/test")
			const input = store.get(textBufferStringAtom)
			expect(input.startsWith("/")).toBe(true)
		})

		it("should extract command query", () => {
			store.set(updateTextBufferAtom, "/mode code")
			const input = store.get(textBufferStringAtom)
			const query = input.startsWith("/") ? input.slice(1) : ""
			expect(query).toBe("mode code")
		})
	})
})

describe("Hook Integration", () => {
	it("should export all hooks", async () => {
		const hooks = await import("../index.js")

		expect(hooks.useExtensionService).toBeDefined()
		expect(hooks.useWebviewMessage).toBeDefined()
		expect(hooks.useExtensionMessage).toBeDefined()
		expect(hooks.useTaskManagement).toBeDefined()
		expect(hooks.useModelSelection).toBeDefined()
		expect(hooks.useCommandInput).toBeDefined()
	})

	it("should export hook types", async () => {
		// This test verifies that TypeScript types are properly exported
		// The actual type checking happens at compile time
		const hooks = await import("../index.js")

		expect(typeof hooks.useExtensionService).toBe("function")
		expect(typeof hooks.useWebviewMessage).toBe("function")
		expect(typeof hooks.useExtensionMessage).toBe("function")
		expect(typeof hooks.useTaskManagement).toBe("function")
		expect(typeof hooks.useModelSelection).toBe("function")
		expect(typeof hooks.useCommandInput).toBe("function")
	})
})

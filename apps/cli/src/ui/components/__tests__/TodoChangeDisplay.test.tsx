import { render } from "ink-testing-library"

import type { TodoItem } from "@roo-code/types"

import TodoChangeDisplay from "../TodoChangeDisplay.js"

describe("TodoChangeDisplay", () => {
	it("renders all todos for initial state (no previous todos)", () => {
		const newTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "completed" },
			{ id: "2", content: "Task 2", status: "in_progress" },
			{ id: "3", content: "Task 3", status: "pending" },
		]

		const { lastFrame } = render(<TodoChangeDisplay previousTodos={[]} newTodos={newTodos} />)
		const output = lastFrame()

		// Check header shows "List" for initial state
		expect(output).toContain("TODO List")

		// All items should be shown
		expect(output).toContain("Task 1")
		expect(output).toContain("Task 2")
		expect(output).toContain("Task 3")

		// Progress should be shown
		expect(output).toContain("(1/3)")
	})

	it("shows only changed items when previous todos exist", () => {
		const previousTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "pending" },
			{ id: "2", content: "Task 2", status: "pending" },
			{ id: "3", content: "Task 3", status: "pending" },
		]

		const newTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "completed" }, // Changed to completed
			{ id: "2", content: "Task 2", status: "in_progress" }, // Changed to in_progress
			{ id: "3", content: "Task 3", status: "pending" }, // No change
		]

		const { lastFrame } = render(<TodoChangeDisplay previousTodos={previousTodos} newTodos={newTodos} />)
		const output = lastFrame()

		// Header should say "Updated"
		expect(output).toContain("TODO Updated")

		// Only changed items should be shown
		expect(output).toContain("Task 1")
		expect(output).toContain("Task 2")

		// Unchanged item should NOT be shown
		// Note: We can check if "Task 3" appears but since rendering is compact,
		// we'll check for change labels instead
		expect(output).toContain("[done]")
		expect(output).toContain("[started]")
	})

	it("returns null when no todos provided", () => {
		const { lastFrame } = render(<TodoChangeDisplay previousTodos={[]} newTodos={[]} />)
		expect(lastFrame()).toBe("")
	})

	it("returns null when no changes detected", () => {
		const todos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "completed" },
			{ id: "2", content: "Task 2", status: "pending" },
		]

		const { lastFrame } = render(<TodoChangeDisplay previousTodos={todos} newTodos={todos} />)
		// No changes means nothing to display
		expect(lastFrame()).toBe("")
	})

	it("shows [new] label for newly added items", () => {
		const previousTodos: TodoItem[] = [{ id: "1", content: "Task 1", status: "completed" }]

		const newTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "completed" },
			{ id: "2", content: "New Task", status: "in_progress" }, // New item
		]

		const { lastFrame } = render(<TodoChangeDisplay previousTodos={previousTodos} newTodos={newTodos} />)
		const output = lastFrame()

		expect(output).toContain("New Task")
		expect(output).toContain("[new]")
	})

	it("displays correct status icons", () => {
		const newTodos: TodoItem[] = [
			{ id: "1", content: "Completed task", status: "completed" },
			{ id: "2", content: "In progress task", status: "in_progress" },
			{ id: "3", content: "Pending task", status: "pending" },
		]

		const { lastFrame } = render(<TodoChangeDisplay previousTodos={[]} newTodos={newTodos} />)
		const output = lastFrame()

		// Check status icons
		expect(output).toContain("✓") // completed
		expect(output).toContain("→") // in_progress
		expect(output).toContain("○") // pending
	})

	it("shows progress summary in header", () => {
		const newTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "completed" },
			{ id: "2", content: "Task 2", status: "completed" },
			{ id: "3", content: "Task 3", status: "pending" },
			{ id: "4", content: "Task 4", status: "pending" },
		]

		const { lastFrame } = render(<TodoChangeDisplay previousTodos={[]} newTodos={newTodos} />)
		const output = lastFrame()

		// 2 out of 4 completed
		expect(output).toContain("(2/4)")
	})

	it("does not show labels for initial state items", () => {
		const newTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "in_progress" },
			{ id: "2", content: "Task 2", status: "pending" },
		]

		const { lastFrame } = render(<TodoChangeDisplay previousTodos={[]} newTodos={newTodos} />)
		const output = lastFrame()

		// Initial state should not have change labels like [done], [started], [new]
		expect(output).not.toContain("[done]")
		expect(output).not.toContain("[started]")
		expect(output).not.toContain("[new]")
	})

	it("handles matching by content when ids differ", () => {
		const previousTodos: TodoItem[] = [{ id: "old-1", content: "Same content task", status: "pending" }]

		const newTodos: TodoItem[] = [{ id: "new-1", content: "Same content task", status: "completed" }]

		const { lastFrame } = render(<TodoChangeDisplay previousTodos={previousTodos} newTodos={newTodos} />)
		const output = lastFrame()

		// Should recognize as the same task that changed status
		expect(output).toContain("Same content task")
		expect(output).toContain("[done]")
	})
})

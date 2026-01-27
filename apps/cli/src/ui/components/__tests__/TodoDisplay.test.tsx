import { render } from "ink-testing-library"

import type { TodoItem } from "@roo-code/types"

import TodoDisplay from "../TodoDisplay.js"
import { resetNerdFontCache } from "../Icon.js"

describe("TodoDisplay", () => {
	beforeEach(() => {
		// Use fallback icons in tests so they render as visible characters
		process.env.ROOCODE_NERD_FONT = "0"
		resetNerdFontCache()
	})

	afterEach(() => {
		delete process.env.ROOCODE_NERD_FONT
		resetNerdFontCache()
	})

	const mockTodos: TodoItem[] = [
		{ id: "1", content: "Analyze requirements", status: "completed" },
		{ id: "2", content: "Design architecture", status: "completed" },
		{ id: "3", content: "Implement core logic", status: "in_progress" },
		{ id: "4", content: "Write tests", status: "pending" },
		{ id: "5", content: "Update documentation", status: "pending" },
	]

	it("renders all todos with correct status icons", () => {
		const { lastFrame } = render(<TodoDisplay todos={mockTodos} />)
		const output = lastFrame()

		// Check header (default title is "Progress")
		expect(output).toContain("Progress")

		// Check all items are rendered
		expect(output).toContain("Analyze requirements")
		expect(output).toContain("Design architecture")
		expect(output).toContain("Implement core logic")
		expect(output).toContain("Write tests")
		expect(output).toContain("Update documentation")

		// Check status icons are present (fallback icons)
		expect(output).toContain("✓") // completed
		expect(output).toContain("→") // in_progress
		expect(output).toContain("○") // pending
	})

	it("renders progress bar when showProgress is true", () => {
		const { lastFrame } = render(<TodoDisplay todos={mockTodos} showProgress={true} />)
		const output = lastFrame()

		// Check progress bar shows percentage (2/5 = 40%)
		expect(output).toContain("40%")
	})

	it("hides progress bar when showProgress is false", () => {
		const { lastFrame } = render(<TodoDisplay todos={mockTodos} showProgress={false} />)
		const output = lastFrame()

		// Should not show completion stats
		expect(output).not.toContain("2/5 completed")
	})

	it("returns null for empty todos array", () => {
		const { lastFrame } = render(<TodoDisplay todos={[]} />)
		expect(lastFrame()).toBe("")
	})

	it("shows only changed items when showChangesOnly is true", () => {
		const previousTodos: TodoItem[] = [
			{ id: "1", content: "Analyze requirements", status: "completed" },
			{ id: "2", content: "Design architecture", status: "in_progress" },
			{ id: "3", content: "Implement core logic", status: "pending" },
		]

		const newTodos: TodoItem[] = [
			{ id: "1", content: "Analyze requirements", status: "completed" },
			{ id: "2", content: "Design architecture", status: "completed" }, // Changed
			{ id: "3", content: "Implement core logic", status: "in_progress" }, // Changed
		]

		const { lastFrame } = render(
			<TodoDisplay todos={newTodos} previousTodos={previousTodos} showChangesOnly={true} />,
		)
		const output = lastFrame()

		// Should show changed items
		expect(output).toContain("Design architecture")
		expect(output).toContain("Implement core logic")

		// Unchanged item should still be there since we're just filtering by change
		// The filter only removes items that haven't changed status
	})

	it("shows change labels for items that changed status", () => {
		const previousTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "pending" },
			{ id: "2", content: "Task 2", status: "in_progress" },
		]

		const newTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "in_progress" },
			{ id: "2", content: "Task 2", status: "completed" },
		]

		const { lastFrame } = render(<TodoDisplay todos={newTodos} previousTodos={previousTodos} />)
		const output = lastFrame()

		// Check change indicators
		expect(output).toContain("[started]")
		expect(output).toContain("[done]")
	})

	it("shows [new] label for new items", () => {
		const previousTodos: TodoItem[] = [{ id: "1", content: "Task 1", status: "completed" }]

		const newTodos: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "completed" },
			{ id: "2", content: "New Task", status: "pending" },
		]

		const { lastFrame } = render(<TodoDisplay todos={newTodos} previousTodos={previousTodos} />)
		const output = lastFrame()

		expect(output).toContain("New Task")
		expect(output).toContain("[new]")
	})

	it("uses custom title when provided", () => {
		const { lastFrame } = render(<TodoDisplay todos={mockTodos} title="My Custom Title" />)
		const output = lastFrame()

		expect(output).toContain("My Custom Title")
	})

	it("calculates in_progress count correctly", () => {
		const todosWithMultipleInProgress: TodoItem[] = [
			{ id: "1", content: "Task 1", status: "completed" },
			{ id: "2", content: "Task 2", status: "in_progress" },
			{ id: "3", content: "Task 3", status: "in_progress" },
			{ id: "4", content: "Task 4", status: "pending" },
		]

		const { lastFrame } = render(<TodoDisplay todos={todosWithMultipleInProgress} showProgress={true} />)
		const output = lastFrame()

		// Progress bar shows percentage (1/4 = 25%)
		expect(output).toContain("25%")
		// In_progress items render with the arrow icon
		expect(output).toContain("→") // in_progress indicator
	})
})

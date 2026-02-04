import { renderHook, act } from "@/utils/test-utils"

import type { HistoryItem } from "@roo-code/types"

import { useGroupedTasks } from "../useGroupedTasks"

const createMockTask = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
	id: "task-1",
	number: 1,
	task: "Test task",
	ts: Date.now(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.01,
	workspace: "/workspace/project",
	...overrides,
})

describe("useGroupedTasks", () => {
	describe("grouping behavior", () => {
		it("groups tasks correctly by parentTaskId", () => {
			const parentTask = createMockTask({
				id: "parent-1",
				task: "Parent task",
				ts: new Date("2024-01-15T12:00:00").getTime(),
			})
			const childTask1 = createMockTask({
				id: "child-1",
				task: "Child task 1",
				parentTaskId: "parent-1",
				ts: new Date("2024-01-15T13:00:00").getTime(),
			})
			const childTask2 = createMockTask({
				id: "child-2",
				task: "Child task 2",
				parentTaskId: "parent-1",
				ts: new Date("2024-01-15T14:00:00").getTime(),
			})

			const { result } = renderHook(() => useGroupedTasks([parentTask, childTask1, childTask2], ""))

			expect(result.current.groups).toHaveLength(1)
			expect(result.current.groups[0].parent.id).toBe("parent-1")
			expect(result.current.groups[0].subtasks).toHaveLength(2)
			expect(result.current.groups[0].subtasks[0].id).toBe("child-2") // Newest first
			expect(result.current.groups[0].subtasks[1].id).toBe("child-1")
		})

		it("handles tasks with no children", () => {
			const task1 = createMockTask({
				id: "task-1",
				task: "Task 1",
				ts: new Date("2024-01-15T12:00:00").getTime(),
			})
			const task2 = createMockTask({
				id: "task-2",
				task: "Task 2",
				ts: new Date("2024-01-16T12:00:00").getTime(),
			})

			const { result } = renderHook(() => useGroupedTasks([task1, task2], ""))

			expect(result.current.groups).toHaveLength(2)
			expect(result.current.groups[0].parent.id).toBe("task-2") // Newest first
			expect(result.current.groups[0].subtasks).toHaveLength(0)
			expect(result.current.groups[1].parent.id).toBe("task-1")
			expect(result.current.groups[1].subtasks).toHaveLength(0)
		})

		it("handles orphaned subtasks (parent not in list)", () => {
			const orphanedTask = createMockTask({
				id: "orphan-1",
				task: "Orphaned task",
				parentTaskId: "non-existent-parent",
				ts: new Date("2024-01-15T12:00:00").getTime(),
			})
			const regularTask = createMockTask({
				id: "regular-1",
				task: "Regular task",
				ts: new Date("2024-01-16T12:00:00").getTime(),
			})

			const { result } = renderHook(() => useGroupedTasks([orphanedTask, regularTask], ""))

			// Orphaned task should be treated as a root task
			expect(result.current.groups).toHaveLength(2)
			expect(result.current.groups.find((g) => g.parent.id === "orphan-1")).toBeTruthy()
			expect(result.current.groups.find((g) => g.parent.id === "regular-1")).toBeTruthy()
		})

		it("sorts groups by parent timestamp (newest first)", () => {
			const oldTask = createMockTask({
				id: "old-1",
				task: "Old task",
				ts: new Date("2024-01-10T12:00:00").getTime(),
			})
			const middleTask = createMockTask({
				id: "middle-1",
				task: "Middle task",
				ts: new Date("2024-01-15T12:00:00").getTime(),
			})
			const newTask = createMockTask({
				id: "new-1",
				task: "New task",
				ts: new Date("2024-01-20T12:00:00").getTime(),
			})

			const { result } = renderHook(() => useGroupedTasks([oldTask, newTask, middleTask], ""))

			expect(result.current.groups).toHaveLength(3)
			expect(result.current.groups[0].parent.id).toBe("new-1")
			expect(result.current.groups[1].parent.id).toBe("middle-1")
			expect(result.current.groups[2].parent.id).toBe("old-1")
		})

		it("handles empty task list", () => {
			const { result } = renderHook(() => useGroupedTasks([], ""))

			expect(result.current.groups).toHaveLength(0)
			expect(result.current.flatTasks).toBeNull()
			expect(result.current.isSearchMode).toBe(false)
		})

		it("handles deeply nested tasks (grandchildren treated as children of their direct parent)", () => {
			const rootTask = createMockTask({
				id: "root-1",
				task: "Root task",
				ts: new Date("2024-01-15T12:00:00").getTime(),
			})
			const childTask = createMockTask({
				id: "child-1",
				task: "Child task",
				parentTaskId: "root-1",
				ts: new Date("2024-01-15T13:00:00").getTime(),
			})
			const grandchildTask = createMockTask({
				id: "grandchild-1",
				task: "Grandchild task",
				parentTaskId: "child-1",
				ts: new Date("2024-01-15T14:00:00").getTime(),
			})

			const { result } = renderHook(() => useGroupedTasks([rootTask, childTask, grandchildTask], ""))

			// Root task is the only group at top level
			expect(result.current.groups).toHaveLength(1)
			expect(result.current.groups[0].parent.id).toBe("root-1")
			expect(result.current.groups[0].subtasks).toHaveLength(1)
			expect(result.current.groups[0].subtasks[0].id).toBe("child-1")

			// Note: grandchild is a child of child-1, not root-1
			// The current implementation only shows direct children in subtasks
		})
	})

	describe("expand/collapse behavior", () => {
		it("starts with all groups collapsed", () => {
			const parentTask = createMockTask({
				id: "parent-1",
				task: "Parent task",
			})
			const childTask = createMockTask({
				id: "child-1",
				task: "Child task",
				parentTaskId: "parent-1",
			})

			const { result } = renderHook(() => useGroupedTasks([parentTask, childTask], ""))

			expect(result.current.groups[0].isExpanded).toBe(false)
		})

		it("expands groups correctly", () => {
			const parentTask = createMockTask({
				id: "parent-1",
				task: "Parent task",
			})
			const childTask = createMockTask({
				id: "child-1",
				task: "Child task",
				parentTaskId: "parent-1",
			})

			const { result } = renderHook(() => useGroupedTasks([parentTask, childTask], ""))

			expect(result.current.groups[0].isExpanded).toBe(false)

			act(() => {
				result.current.toggleExpand("parent-1")
			})

			expect(result.current.groups[0].isExpanded).toBe(true)
		})

		it("collapses expanded groups", () => {
			const parentTask = createMockTask({
				id: "parent-1",
				task: "Parent task",
			})
			const childTask = createMockTask({
				id: "child-1",
				task: "Child task",
				parentTaskId: "parent-1",
			})

			const { result } = renderHook(() => useGroupedTasks([parentTask, childTask], ""))

			// Expand first
			act(() => {
				result.current.toggleExpand("parent-1")
			})
			expect(result.current.groups[0].isExpanded).toBe(true)

			// Collapse
			act(() => {
				result.current.toggleExpand("parent-1")
			})
			expect(result.current.groups[0].isExpanded).toBe(false)
		})

		it("expands/collapses multiple groups independently", () => {
			const parent1 = createMockTask({
				id: "parent-1",
				task: "Parent 1",
				ts: new Date("2024-01-15T12:00:00").getTime(),
			})
			const child1 = createMockTask({
				id: "child-1",
				task: "Child 1",
				parentTaskId: "parent-1",
				ts: new Date("2024-01-15T13:00:00").getTime(),
			})
			const parent2 = createMockTask({
				id: "parent-2",
				task: "Parent 2",
				ts: new Date("2024-01-16T12:00:00").getTime(),
			})
			const child2 = createMockTask({
				id: "child-2",
				task: "Child 2",
				parentTaskId: "parent-2",
				ts: new Date("2024-01-16T13:00:00").getTime(),
			})

			const { result } = renderHook(() => useGroupedTasks([parent1, child1, parent2, child2], ""))

			// Expand parent-1
			act(() => {
				result.current.toggleExpand("parent-1")
			})

			const group1 = result.current.groups.find((g) => g.parent.id === "parent-1")
			const group2 = result.current.groups.find((g) => g.parent.id === "parent-2")

			expect(group1?.isExpanded).toBe(true)
			expect(group2?.isExpanded).toBe(false)

			// Expand parent-2
			act(() => {
				result.current.toggleExpand("parent-2")
			})

			const group1After = result.current.groups.find((g) => g.parent.id === "parent-1")
			const group2After = result.current.groups.find((g) => g.parent.id === "parent-2")

			expect(group1After?.isExpanded).toBe(true)
			expect(group2After?.isExpanded).toBe(true)
		})
	})

	describe("search mode behavior", () => {
		it("returns flat list in search mode with isSubtask flag", () => {
			const parentTask = createMockTask({
				id: "parent-1",
				task: "Parent task",
				ts: new Date("2024-01-15T12:00:00").getTime(),
			})
			const childTask = createMockTask({
				id: "child-1",
				task: "Child task",
				parentTaskId: "parent-1",
				ts: new Date("2024-01-15T13:00:00").getTime(),
			})

			const { result } = renderHook(() => useGroupedTasks([parentTask, childTask], "search query"))

			expect(result.current.isSearchMode).toBe(true)
			expect(result.current.groups).toHaveLength(0)
			expect(result.current.flatTasks).not.toBeNull()
			expect(result.current.flatTasks).toHaveLength(2)

			const parentInFlat = result.current.flatTasks?.find((t) => t.id === "parent-1")
			const childInFlat = result.current.flatTasks?.find((t) => t.id === "child-1")

			expect(parentInFlat?.isSubtask).toBe(false)
			expect(childInFlat?.isSubtask).toBe(true)
		})

		it("returns empty groups in search mode", () => {
			const task = createMockTask({ id: "task-1", task: "Test task" })

			const { result } = renderHook(() => useGroupedTasks([task], "search"))

			expect(result.current.groups).toHaveLength(0)
		})

		it("marks orphaned subtasks as non-subtasks in flat list", () => {
			const orphanedTask = createMockTask({
				id: "orphan-1",
				task: "Orphaned task",
				parentTaskId: "non-existent-parent",
			})

			const { result } = renderHook(() => useGroupedTasks([orphanedTask], "search"))

			expect(result.current.flatTasks?.[0].isSubtask).toBe(false)
		})

		it("handles whitespace-only search query as non-search mode", () => {
			const task = createMockTask({ id: "task-1", task: "Test task" })

			const { result } = renderHook(() => useGroupedTasks([task], "   "))

			expect(result.current.isSearchMode).toBe(false)
			expect(result.current.groups).toHaveLength(1)
			expect(result.current.flatTasks).toBeNull()
		})

		it("returns flatTasks as null when not in search mode", () => {
			const task = createMockTask({ id: "task-1", task: "Test task" })

			const { result } = renderHook(() => useGroupedTasks([task], ""))

			expect(result.current.flatTasks).toBeNull()
		})
	})

	describe("edge cases", () => {
		it("handles tasks with same timestamp", () => {
			const sameTime = new Date("2024-01-15T12:00:00").getTime()
			const task1 = createMockTask({ id: "task-1", task: "Task 1", ts: sameTime })
			const task2 = createMockTask({ id: "task-2", task: "Task 2", ts: sameTime })

			const { result } = renderHook(() => useGroupedTasks([task1, task2], ""))

			expect(result.current.groups).toHaveLength(2)
		})

		it("handles task list re-render with new data", () => {
			const initialTasks = [createMockTask({ id: "task-1", task: "Task 1" })]

			const { result, rerender } = renderHook(({ tasks, query }) => useGroupedTasks(tasks, query), {
				initialProps: { tasks: initialTasks, query: "" },
			})

			expect(result.current.groups).toHaveLength(1)

			// Add more tasks
			const updatedTasks = [...initialTasks, createMockTask({ id: "task-2", task: "Task 2" })]

			rerender({ tasks: updatedTasks, query: "" })

			expect(result.current.groups).toHaveLength(2)
		})

		it("preserves expand state when tasks change", () => {
			const parentTask = createMockTask({ id: "parent-1", task: "Parent task" })
			const childTask = createMockTask({
				id: "child-1",
				task: "Child task",
				parentTaskId: "parent-1",
			})

			const { result, rerender } = renderHook(({ tasks, query }) => useGroupedTasks(tasks, query), {
				initialProps: { tasks: [parentTask, childTask], query: "" },
			})

			// Expand the group
			act(() => {
				result.current.toggleExpand("parent-1")
			})
			expect(result.current.groups[0].isExpanded).toBe(true)

			// Add a new child task
			const newChildTask = createMockTask({
				id: "child-2",
				task: "Child task 2",
				parentTaskId: "parent-1",
			})

			rerender({ tasks: [parentTask, childTask, newChildTask], query: "" })

			// Expand state should be preserved
			expect(result.current.groups[0].isExpanded).toBe(true)
		})
	})
})

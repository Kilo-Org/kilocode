import { render, screen, fireEvent } from "@/utils/test-utils"

import TaskGroupItem from "../TaskGroupItem"
import type { TaskGroup, DisplayHistoryItem } from "../types"

vi.mock("@src/utils/vscode")
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => {
			if (key === "history:subtasks" && options?.count !== undefined) {
				return `${options.count} Subtask${options.count === 1 ? "" : "s"}`
			}
			if (key === "history:subtaskTag") return "Subtask: "
			return key
		},
	}),
}))

vi.mock("@/utils/format", () => ({
	formatTimeAgo: vi.fn(() => "2 hours ago"),
	formatDate: vi.fn(() => "January 15 at 2:30 PM"),
	formatLargeNumber: vi.fn((num: number) => num.toString()),
}))

const createMockDisplayHistoryItem = (overrides: Partial<DisplayHistoryItem> = {}): DisplayHistoryItem => ({
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

const createMockGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
	parent: createMockDisplayHistoryItem({ id: "parent-1", task: "Parent task" }),
	subtasks: [],
	isExpanded: false,
	...overrides,
})

describe("TaskGroupItem", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("parent task rendering", () => {
		it("renders parent task content", () => {
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({
					id: "parent-1",
					task: "Test parent task content",
				}),
			})

			render(<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} />)

			expect(screen.getByText("Test parent task content")).toBeInTheDocument()
		})

		it("renders group container with correct test id", () => {
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({ id: "my-parent-id" }),
			})

			render(<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} />)

			expect(screen.getByTestId("task-group-my-parent-id")).toBeInTheDocument()
		})
	})

	describe("subtask count display", () => {
		it("shows correct subtask count", () => {
			const group = createMockGroup({
				subtasks: [
					createMockDisplayHistoryItem({ id: "child-1", task: "Child 1" }),
					createMockDisplayHistoryItem({ id: "child-2", task: "Child 2" }),
					createMockDisplayHistoryItem({ id: "child-3", task: "Child 3" }),
				],
			})

			render(<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} />)

			expect(screen.getByText("3 Subtasks")).toBeInTheDocument()
		})

		it("shows singular subtask text for single subtask", () => {
			const group = createMockGroup({
				subtasks: [createMockDisplayHistoryItem({ id: "child-1", task: "Child 1" })],
			})

			render(<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} />)

			expect(screen.getByText("1 Subtask")).toBeInTheDocument()
		})

		it("does not show subtask row when no subtasks", () => {
			const group = createMockGroup({ subtasks: [] })

			render(<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} />)

			expect(screen.queryByTestId("subtask-collapsible-row")).not.toBeInTheDocument()
		})
	})

	describe("expand/collapse behavior", () => {
		it("calls onToggleExpand when chevron row is clicked", () => {
			const onToggleExpand = vi.fn()
			const group = createMockGroup({
				subtasks: [createMockDisplayHistoryItem({ id: "child-1", task: "Child 1" })],
			})

			render(<TaskGroupItem group={group} variant="full" onToggleExpand={onToggleExpand} />)

			const collapsibleRow = screen.getByTestId("subtask-collapsible-row")
			fireEvent.click(collapsibleRow)

			expect(onToggleExpand).toHaveBeenCalledTimes(1)
		})

		it("shows subtasks when expanded", () => {
			const group = createMockGroup({
				isExpanded: true,
				subtasks: [
					createMockDisplayHistoryItem({ id: "child-1", task: "Subtask content 1" }),
					createMockDisplayHistoryItem({ id: "child-2", task: "Subtask content 2" }),
				],
			})

			render(<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} />)

			expect(screen.getByTestId("subtask-list")).toBeInTheDocument()
			expect(screen.getByText("Subtask content 1")).toBeInTheDocument()
			expect(screen.getByText("Subtask content 2")).toBeInTheDocument()
		})

		it("hides subtasks when collapsed", () => {
			const group = createMockGroup({
				isExpanded: false,
				subtasks: [createMockDisplayHistoryItem({ id: "child-1", task: "Subtask content" })],
			})

			render(<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} />)

			// The subtask-list element is present but collapsed via CSS (max-h-0)
			const subtaskList = screen.queryByTestId("subtask-list")
			expect(subtaskList).toBeInTheDocument()
			expect(subtaskList).toHaveClass("max-h-0")
		})
	})

	describe("selection mode", () => {
		it("handles selection mode correctly", () => {
			const onToggleSelection = vi.fn()
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({ id: "parent-1" }),
			})

			render(
				<TaskGroupItem
					group={group}
					variant="full"
					isSelectionMode={true}
					isSelected={false}
					onToggleSelection={onToggleSelection}
					onToggleExpand={vi.fn()}
				/>,
			)

			const checkbox = screen.getByRole("checkbox")
			fireEvent.click(checkbox)

			expect(onToggleSelection).toHaveBeenCalledWith("parent-1", true)
		})

		it("shows selected state when isSelected is true", () => {
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({ id: "parent-1" }),
			})

			render(
				<TaskGroupItem
					group={group}
					variant="full"
					isSelectionMode={true}
					isSelected={true}
					onToggleSelection={vi.fn()}
					onToggleExpand={vi.fn()}
				/>,
			)

			const checkbox = screen.getByRole("checkbox")
			// Radix checkbox uses data-state instead of checked attribute
			expect(checkbox).toHaveAttribute("data-state", "checked")
		})
	})

	describe("variant handling", () => {
		it("passes compact variant to TaskItem", () => {
			const group = createMockGroup()

			render(<TaskGroupItem group={group} variant="compact" onToggleExpand={vi.fn()} />)

			// TaskItem should be rendered with compact styling
			const taskItem = screen.getByTestId("task-item-parent-1")
			expect(taskItem).toBeInTheDocument()
		})

		it("passes full variant to TaskItem", () => {
			const group = createMockGroup()

			render(<TaskGroupItem group={group} variant="full" onToggleExpand={vi.fn()} />)

			const taskItem = screen.getByTestId("task-item-parent-1")
			expect(taskItem).toBeInTheDocument()
		})
	})

	describe("delete handling", () => {
		it("passes onDelete to TaskItem", () => {
			const onDelete = vi.fn()
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({ id: "parent-1", task: "Parent task" }),
			})

			render(<TaskGroupItem group={group} variant="full" onDelete={onDelete} onToggleExpand={vi.fn()} />)

			// Delete button uses "delete-task-button" as testid
			const deleteButton = screen.getByTestId("delete-task-button")
			fireEvent.click(deleteButton)

			expect(onDelete).toHaveBeenCalledWith("parent-1")
		})
	})

	describe("workspace display", () => {
		it("passes showWorkspace to TaskItem", () => {
			const group = createMockGroup({
				parent: createMockDisplayHistoryItem({
					id: "parent-1",
					workspace: "/test/workspace/path",
				}),
			})

			render(<TaskGroupItem group={group} variant="full" showWorkspace={true} onToggleExpand={vi.fn()} />)

			// Workspace should be displayed in TaskItem
			const taskItem = screen.getByTestId("task-item-parent-1")
			expect(taskItem).toBeInTheDocument()
			// Check that workspace folder is shown
			expect(screen.getByText("/test/workspace/path")).toBeInTheDocument()
		})
	})

	describe("custom className", () => {
		it("applies custom className to container", () => {
			const group = createMockGroup()

			render(<TaskGroupItem group={group} variant="full" className="custom-class" onToggleExpand={vi.fn()} />)

			const container = screen.getByTestId("task-group-parent-1")
			expect(container).toHaveClass("custom-class")
		})
	})
})

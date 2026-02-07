import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@/utils/vscode"

import { BatchDeleteTaskDialog } from "../BatchDeleteTaskDialog"

vi.mock("@/utils/vscode")

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, any>) => {
			const count = options?.count ?? 0
			const taskLabel = count === 1 ? "task" : "tasks"
			const itemLabel = count === 1 ? "item" : "items"
			const translations: Record<string, string> = {
				"history:deleteTasks": "Delete Tasks",
				"history:confirmDeleteTasks": `Are you sure you want to delete ${count} ${taskLabel}?`,
				"history:deleteTasksWarning": "This action cannot be undone.",
				"history:cancel": "Cancel",
				"history:deleteItems": `Delete ${count} ${itemLabel}`,
				"history:deleteFavoritedCheckbox": "Include favorited tasks",
			}
			return translations[key] || key
		},
	}),
}))

// kilocode_change start: add mocks
vi.mock("@/kilocode/hooks/useTaskHistory", () => ({
	useTaskWithId: () => ({
		data: [
			{ id: "task-1", isFavorited: false },
			{ id: "task-2", isFavorited: true },
			{ id: "task-3", isFavorited: false },
			{ id: "task-4", isFavorited: true },
		],
	}),
}))
// kilocode_change end

describe("BatchDeleteTaskDialog", () => {
	const mockTaskIds = ["task-1", "task-2", "task-3"]
	const mockOnOpenChange = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders dialog with correct content", () => {
		render(<BatchDeleteTaskDialog taskIds={mockTaskIds} open={true} onOpenChange={mockOnOpenChange} />)

		expect(screen.getByText("Delete Tasks")).toBeInTheDocument()
		expect(screen.getByText("Are you sure you want to delete 2 tasks?")).toBeInTheDocument()
		expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument()
		expect(screen.getByText("Cancel")).toBeInTheDocument()
		// With favorited tasks in selection, shows checkbox and deletes non-favorited by default
		expect(screen.getByText("Include favorited tasks")).toBeInTheDocument()
		expect(screen.getByText("Delete 2 items")).toBeInTheDocument()
	})

	it("calls vscode.postMessage when delete is confirmed", () => {
		render(<BatchDeleteTaskDialog taskIds={mockTaskIds} open={true} onOpenChange={mockOnOpenChange} />)

		const deleteButton = screen.getByText("Delete 2 items")
		fireEvent.click(deleteButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "deleteMultipleTasksWithIds",
			ids: mockTaskIds,
			excludeFavorites: true,
		})
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("calls onOpenChange when cancel is clicked", () => {
		render(<BatchDeleteTaskDialog taskIds={mockTaskIds} open={true} onOpenChange={mockOnOpenChange} />)

		const cancelButton = screen.getByText("Cancel")
		fireEvent.click(cancelButton)

		expect(vscode.postMessage).not.toHaveBeenCalled()
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("does not call vscode.postMessage when taskIds is empty", () => {
		render(<BatchDeleteTaskDialog taskIds={[]} open={true} onOpenChange={mockOnOpenChange} />)

		const deleteButton = screen.getByText("Delete 0 items")
		fireEvent.click(deleteButton)

		expect(vscode.postMessage).not.toHaveBeenCalled()
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("renders with correct task count in messages", () => {
		const singleTaskId = ["task-1"]
		render(<BatchDeleteTaskDialog taskIds={singleTaskId} open={true} onOpenChange={mockOnOpenChange} />)

		expect(screen.getByText("Are you sure you want to delete 1 task?")).toBeInTheDocument()
		// task-1 is not favorited, so only shows single delete button
		expect(screen.getByText("Delete 1 item")).toBeInTheDocument()
	})

	it("toggles include favorited checkbox to delete all items", () => {
		render(<BatchDeleteTaskDialog taskIds={mockTaskIds} open={true} onOpenChange={mockOnOpenChange} />)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(screen.getByText("Are you sure you want to delete 3 tasks?")).toBeInTheDocument()
		const deleteButton = screen.getByText("Delete 3 items")
		fireEvent.click(deleteButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "deleteMultipleTasksWithIds",
			ids: mockTaskIds,
			excludeFavorites: false,
		})
		expect(mockOnOpenChange).toHaveBeenCalledWith(false)
	})

	it("renders trash icon in delete button", () => {
		render(<BatchDeleteTaskDialog taskIds={mockTaskIds} open={true} onOpenChange={mockOnOpenChange} />)

		const deleteButton = screen.getByText("Delete 2 items")
		const trashIcon = deleteButton.querySelector(".codicon-trash")
		expect(trashIcon).toBeInTheDocument()
	})
})

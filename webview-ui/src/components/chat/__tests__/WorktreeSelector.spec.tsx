import { render, screen, fireEvent, act } from "@/utils/test-utils"

import type { Worktree, WorktreeListResponse } from "@roo-code/types"

import { WorktreeSelector } from "../WorktreeSelector"

const mockPostMessage = vi.fn()

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: unknown[]) => mockPostMessage(...args),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/components/ui/hooks/useRooPortal", () => ({
	useRooPortal: () => document.body,
}))

const mockWorktrees: Worktree[] = [
	{
		path: "/path/to/main",
		branch: "main",
		commitHash: "abc123",
		isCurrent: true,
		isBare: true,
		isDetached: false,
		isLocked: false,
	},
	{
		path: "/path/to/feature-branch",
		branch: "feature-branch",
		commitHash: "def456",
		isCurrent: false,
		isBare: false,
		isDetached: false,
		isLocked: false,
	},
	{
		path: "/path/to/another-branch",
		branch: "another-branch",
		commitHash: "ghi789",
		isCurrent: false,
		isBare: false,
		isDetached: false,
		isLocked: false,
	},
]

const simulateWorktreeListMessage = (worktrees: Worktree[], isGitRepo: boolean = true) => {
	const message: Partial<WorktreeListResponse> & { type: string } = {
		type: "worktreeList",
		worktrees,
		isGitRepo,
		isMultiRoot: false,
		isSubfolder: false,
		gitRootPath: "/path/to/repo",
	}

	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: message }))
	})
}

describe("WorktreeSelector", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
	})

	test("requests worktrees on mount", () => {
		render(<WorktreeSelector />)

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "listWorktrees" })
	})

	test("does not render when not a git repo", () => {
		const { container } = render(<WorktreeSelector />)

		simulateWorktreeListMessage([], false)

		expect(container.querySelector('[data-testid="worktree-selector-trigger"]')).not.toBeInTheDocument()
	})

	test("does not render when only one worktree exists", () => {
		const { container } = render(<WorktreeSelector />)

		simulateWorktreeListMessage([mockWorktrees[0]])

		expect(container.querySelector('[data-testid="worktree-selector-trigger"]')).not.toBeInTheDocument()
	})

	test("renders trigger when multiple worktrees exist", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		expect(screen.getByTestId("worktree-selector-trigger")).toBeInTheDocument()
	})

	test("shows current branch name on trigger", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		const trigger = screen.getByTestId("worktree-selector-trigger")
		expect(trigger).toHaveTextContent("main")
	})

	test("opens popover and shows all worktrees when clicked", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		// Should show all worktree items
		const items = screen.getAllByTestId("worktree-selector-item")
		expect(items).toHaveLength(3)
	})

	test("shows worktree branch names and paths in popover", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		// "main" appears twice: once in trigger and once in popover list
		expect(screen.getAllByText("main").length).toBeGreaterThanOrEqual(2)
		expect(screen.getByText("feature-branch")).toBeInTheDocument()
		expect(screen.getByText("another-branch")).toBeInTheDocument()
		expect(screen.getByText("/path/to/main")).toBeInTheDocument()
		expect(screen.getByText("/path/to/feature-branch")).toBeInTheDocument()
	})

	test("shows primary badge on primary worktree", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		expect(screen.getByText("worktrees:primary")).toBeInTheDocument()
	})

	test("sends switch message when selecting a different worktree", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		// Click on feature-branch worktree
		const items = screen.getAllByTestId("worktree-selector-item")
		fireEvent.click(items[1]) // Second item is feature-branch

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "switchWorktree",
			worktreePath: "/path/to/feature-branch",
			worktreeNewWindow: false,
		})
	})

	test("does not send switch message when selecting current worktree", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		mockPostMessage.mockClear()

		// Click on current worktree (main)
		const items = screen.getAllByTestId("worktree-selector-item")
		fireEvent.click(items[0])

		expect(mockPostMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({
				type: "switchWorktree",
			}),
		)
	})

	test("shows settings button in footer", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		// Check for settings gear icon button
		const settingsButton = document.querySelector(".codicon-settings-gear")
		expect(settingsButton).toBeInTheDocument()
	})

	test("navigates to worktree settings when settings button clicked", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		// Find and click the settings button
		const settingsButton = document.querySelector(".codicon-settings-gear")
		expect(settingsButton).toBeInTheDocument()

		fireEvent.click(settingsButton!.closest("button")!)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "switchTab",
			tab: "settings",
			values: { section: "worktrees" },
		})
	})

	test("shows title in header", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		expect(screen.getByText("worktrees:selector.title")).toBeInTheDocument()
	})

	test("shows description in popover", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		expect(screen.getByText("worktrees:selector.description")).toBeInTheDocument()
	})

	test("is disabled when disabled prop is true", () => {
		render(<WorktreeSelector disabled={true} />)

		simulateWorktreeListMessage(mockWorktrees)

		const trigger = screen.getByTestId("worktree-selector-trigger")
		expect(trigger).toBeDisabled()
	})

	test("refreshes worktrees when popover opens", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		mockPostMessage.mockClear()

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "listWorktrees" })
	})

	test("shows check mark on current worktree", () => {
		render(<WorktreeSelector />)

		simulateWorktreeListMessage(mockWorktrees)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		// The current worktree should have Check component (Check from lucide-react)
		const items = screen.getAllByTestId("worktree-selector-item")
		const currentItem = items[0] // main is current
		const checkIcon = currentItem.querySelector("svg.lucide-check")
		expect(checkIcon).toBeInTheDocument()
	})

	test("handles worktree with no branch (detached HEAD)", () => {
		const worktreesWithDetached: Worktree[] = [
			...mockWorktrees,
			{
				path: "/path/to/detached",
				branch: "",
				commitHash: "xyz999",
				isCurrent: false,
				isBare: false,
				isDetached: true,
				isLocked: false,
			},
		]

		render(<WorktreeSelector />)

		simulateWorktreeListMessage(worktreesWithDetached)

		fireEvent.click(screen.getByTestId("worktree-selector-trigger"))

		// Should show "worktrees:noBranch" translation key for detached HEAD
		expect(screen.getByText("worktrees:noBranch")).toBeInTheDocument()
	})
})

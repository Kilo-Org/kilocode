import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ContextPillsBar } from "../ContextPillsBar"

// Mock StandardTooltip to simplify testing
vi.mock("@/components/ui", () => ({
	StandardTooltip: ({ children }: any) => <>{children}</>,
}))

describe("ContextPillsBar", () => {
	it("should render nothing when mentions array is empty", () => {
		const { container } = render(<ContextPillsBar mentions={[]} onRemove={vi.fn()} />)
		expect(container.firstChild).toBeNull()
	})

	it("should render pills for each mention", () => {
		const mentions = ["/src/App.tsx", "/src/utils/helper.ts", "/README.md"]
		render(<ContextPillsBar mentions={mentions} onRemove={vi.fn()} />)

		expect(screen.getByText("App.tsx")).toBeInTheDocument()
		expect(screen.getByText("helper.ts")).toBeInTheDocument()
		expect(screen.getByText("README.md")).toBeInTheDocument()
	})

	it("should display only filename for file paths", () => {
		const mentions = ["/path/to/deeply/nested/file.tsx"]
		render(<ContextPillsBar mentions={mentions} onRemove={vi.fn()} />)

		expect(screen.getByText("file.tsx")).toBeInTheDocument()
		expect(screen.queryByText("/path/to/deeply/nested/file.tsx")).not.toBeInTheDocument()
	})

	it("should display special mentions correctly", () => {
		const mentions = ["problems", "terminal", "git-changes"]
		render(<ContextPillsBar mentions={mentions} onRemove={vi.fn()} />)

		expect(screen.getByText("problems")).toBeInTheDocument()
		expect(screen.getByText("terminal")).toBeInTheDocument()
		expect(screen.getByText("git-changes")).toBeInTheDocument()
	})

	it("should display shortened git commit hash", () => {
		const mentions = ["a1b2c3d4e5f6789"]
		render(<ContextPillsBar mentions={mentions} onRemove={vi.fn()} />)

		expect(screen.getByText("a1b2c3d")).toBeInTheDocument()
	})

	it("should display hostname for URLs", () => {
		const mentions = ["https://example.com/path/to/page"]
		render(<ContextPillsBar mentions={mentions} onRemove={vi.fn()} />)

		expect(screen.getByText("example.com")).toBeInTheDocument()
	})

	it("should call onRemove when remove button is clicked", async () => {
		const onRemove = vi.fn()
		const mentions = ["/src/App.tsx", "/src/utils/helper.ts"]
		const user = userEvent.setup()

		render(<ContextPillsBar mentions={mentions} onRemove={onRemove} />)

		const removeButtons = screen.getAllByRole("button")
		await user.click(removeButtons[0])

		expect(onRemove).toHaveBeenCalledWith("/src/App.tsx")
	})

	it("should render remove button for each pill", () => {
		const mentions = ["/src/App.tsx", "/src/utils/helper.ts", "/README.md"]
		render(<ContextPillsBar mentions={mentions} onRemove={vi.fn()} />)

		const removeButtons = screen.getAllByRole("button")
		expect(removeButtons).toHaveLength(3)
	})

	it("should have correct aria-label for remove buttons", () => {
		const mentions = ["/src/App.tsx"]
		render(<ContextPillsBar mentions={mentions} onRemove={vi.fn()} />)

		const removeButton = screen.getByLabelText("Remove App.tsx")
		expect(removeButton).toBeInTheDocument()
	})

	it("should handle mentions with @ prefix", () => {
		const mentions = ["@/src/App.tsx"]
		render(<ContextPillsBar mentions={mentions} onRemove={vi.fn()} />)

		expect(screen.getByText("App.tsx")).toBeInTheDocument()
	})

	it("should handle multiple pills with same filename", () => {
		const mentions = ["/src/components/App.tsx", "/tests/App.tsx"]
		render(<ContextPillsBar mentions={mentions} onRemove={vi.fn()} />)

		const pills = screen.getAllByText("App.tsx")
		expect(pills).toHaveLength(2)
	})
})
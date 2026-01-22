// kilocode_change - new file
// npx vitest src/components/kilocode/__tests__/DiffStatsDisplay.spec.tsx

import { render, screen } from "@testing-library/react"
import DiffStatsDisplay from "../DiffStatsDisplay"

// Mock the StandardTooltip component
vi.mock("@src/components/ui", () => ({
	StandardTooltip: ({ children, content }: { children: React.ReactNode; content: string }) => (
		<div data-testid="tooltip" data-tooltip-content={content}>
			{children}
		</div>
	),
}))

describe("DiffStatsDisplay", () => {
	describe("rendering", () => {
		it("should not render when both added and removed are 0", () => {
			const { container } = render(<DiffStatsDisplay added={0} removed={0} />)

			expect(container.firstChild).toBeNull()
		})

		it("should render when there are additions", () => {
			render(<DiffStatsDisplay added={10} removed={0} />)

			expect(screen.getByText("+10")).toBeInTheDocument()
			expect(screen.getByText("−0")).toBeInTheDocument()
		})

		it("should render when there are removals", () => {
			render(<DiffStatsDisplay added={0} removed={5} />)

			expect(screen.getByText("+0")).toBeInTheDocument()
			expect(screen.getByText("−5")).toBeInTheDocument()
		})

		it("should render when there are both additions and removals", () => {
			render(<DiffStatsDisplay added={8} removed={4} />)

			expect(screen.getByText("+8")).toBeInTheDocument()
			expect(screen.getByText("−4")).toBeInTheDocument()
		})
	})

	describe("tooltip", () => {
		it("should show correct tooltip for single addition", () => {
			render(<DiffStatsDisplay added={1} removed={0} />)

			const tooltip = screen.getByTestId("tooltip")
			expect(tooltip).toHaveAttribute("data-tooltip-content", "1 addition & 0 deletions")
		})

		it("should show correct tooltip for single deletion", () => {
			render(<DiffStatsDisplay added={0} removed={1} />)

			const tooltip = screen.getByTestId("tooltip")
			expect(tooltip).toHaveAttribute("data-tooltip-content", "0 additions & 1 deletion")
		})

		it("should show correct tooltip for multiple additions and deletions", () => {
			render(<DiffStatsDisplay added={10} removed={5} />)

			const tooltip = screen.getByTestId("tooltip")
			expect(tooltip).toHaveAttribute("data-tooltip-content", "10 additions & 5 deletions")
		})
	})

	describe("box calculation", () => {
		it("should render 0 boxes by default", () => {
			render(<DiffStatsDisplay added={10} removed={0} />)

			// No boxes should be rendered with default maxBoxes=0
			const boxes = screen.getAllByRole("generic", { hidden: true }).filter((el) => el.classList.contains("w-2"))
			expect(boxes.length).toBe(0)
		})

		it("should render custom number of boxes when maxBoxes is specified", () => {
			render(<DiffStatsDisplay added={10} removed={0} maxBoxes={3} />)

			const boxes = screen.getAllByRole("generic", { hidden: true }).filter((el) => el.classList.contains("w-2"))
			expect(boxes.length).toBe(3)
		})

		it("should show proportional green and red boxes", () => {
			// 80% additions, 20% removals -> 4 green, 1 red
			render(<DiffStatsDisplay added={80} removed={20} maxBoxes={5} />)

			const greenBoxes = screen
				.getAllByRole("generic", { hidden: true })
				.filter((el) => el.classList.contains("bg-vscode-charts-green"))
			const redBoxes = screen
				.getAllByRole("generic", { hidden: true })
				.filter((el) => el.classList.contains("bg-vscode-charts-red"))

			expect(greenBoxes.length).toBe(4)
			expect(redBoxes.length).toBe(1)
		})

		it("should ensure at least 1 box for non-zero values", () => {
			// 99% additions, 1% removals -> should still show at least 1 red box
			render(<DiffStatsDisplay added={99} removed={1} maxBoxes={5} />)

			const redBoxes = screen
				.getAllByRole("generic", { hidden: true })
				.filter((el) => el.classList.contains("bg-vscode-charts-red"))

			expect(redBoxes.length).toBeGreaterThanOrEqual(1)
		})

		it("should show all green boxes for additions only", () => {
			render(<DiffStatsDisplay added={100} removed={0} maxBoxes={5} />)

			const greenBoxes = screen
				.getAllByRole("generic", { hidden: true })
				.filter((el) => el.classList.contains("bg-vscode-charts-green"))
			const redBoxes = screen
				.getAllByRole("generic", { hidden: true })
				.filter((el) => el.classList.contains("bg-vscode-charts-red"))

			expect(greenBoxes.length).toBe(5)
			expect(redBoxes.length).toBe(0)
		})

		it("should show all red boxes for removals only", () => {
			render(<DiffStatsDisplay added={0} removed={100} maxBoxes={5} />)

			const greenBoxes = screen
				.getAllByRole("generic", { hidden: true })
				.filter((el) => el.classList.contains("bg-vscode-charts-green"))
			const redBoxes = screen
				.getAllByRole("generic", { hidden: true })
				.filter((el) => el.classList.contains("bg-vscode-charts-red"))

			expect(greenBoxes.length).toBe(0)
			expect(redBoxes.length).toBe(5)
		})
	})

	describe("styling", () => {
		it("should apply custom className", () => {
			render(<DiffStatsDisplay added={10} removed={5} className="custom-class" />)

			const tooltip = screen.getByTestId("tooltip")
			const container = tooltip.firstChild as HTMLElement
			expect(container).toHaveClass("custom-class")
		})

		it("should have green color for additions text", () => {
			render(<DiffStatsDisplay added={10} removed={5} />)

			const addedText = screen.getByText("+10")
			expect(addedText).toHaveClass("text-vscode-charts-green")
		})

		it("should have red color for removals text", () => {
			render(<DiffStatsDisplay added={10} removed={5} />)

			const removedText = screen.getByText("−5")
			expect(removedText).toHaveClass("text-vscode-charts-red")
		})
	})
})

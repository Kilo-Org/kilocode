import { render, screen } from "@testing-library/react"
import { AnimatedTabContainer } from "../AnimatedTabContainer"

describe("AnimatedTabContainer", () => {
	it("should render children correctly", () => {
		render(
			<AnimatedTabContainer tabKey="test-tab">
				<div data-testid="test-content">Test Content</div>
			</AnimatedTabContainer>,
		)

		expect(screen.getByTestId("test-content")).toBeInTheDocument()
		expect(screen.getByText("Test Content")).toBeInTheDocument()
	})

	it("should apply custom className", () => {
		const { container } = render(
			<AnimatedTabContainer tabKey="test-tab" className="custom-class">
				<div>Test Content</div>
			</AnimatedTabContainer>,
		)

		const motionDiv = container.querySelector(".custom-class")
		expect(motionDiv).toBeInTheDocument()
	})
})

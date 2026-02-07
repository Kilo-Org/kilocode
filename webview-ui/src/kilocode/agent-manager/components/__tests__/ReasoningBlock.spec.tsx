import { render, screen, fireEvent } from "@testing-library/react"
import { ReasoningBlock } from "../ReasoningBlock"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { count?: number }) => {
			if (key === "messages.thinking") return "Thinking"
			if (key === "messages.thinkingSeconds") return `${options?.count}s`
			return key
		},
	}),
}))

describe("ReasoningBlock", () => {
	const defaultProps = {
		content: "This is the reasoning content",
		ts: Date.now(),
		isStreaming: false,
		isLast: false,
	}

	it("renders with thinking title", () => {
		render(<ReasoningBlock {...defaultProps} />)
		expect(screen.getByText("Thinking")).toBeInTheDocument()
	})

	it("is collapsed by default", () => {
		render(<ReasoningBlock {...defaultProps} />)
		expect(screen.queryByText("This is the reasoning content")).not.toBeInTheDocument()
	})

	it("expands when header is clicked", () => {
		render(<ReasoningBlock {...defaultProps} />)

		// Click the header to expand
		const header = screen.getByText("Thinking").closest(".am-reasoning-header")
		expect(header).toBeInTheDocument()
		fireEvent.click(header!)

		// Content should now be visible
		expect(screen.getByText("This is the reasoning content")).toBeInTheDocument()
	})

	it("collapses when header is clicked again", () => {
		render(<ReasoningBlock {...defaultProps} />)

		const header = screen.getByText("Thinking").closest(".am-reasoning-header")

		// Expand
		fireEvent.click(header!)
		expect(screen.getByText("This is the reasoning content")).toBeInTheDocument()

		// Collapse
		fireEvent.click(header!)
		expect(screen.queryByText("This is the reasoning content")).not.toBeInTheDocument()
	})

	it("does not show elapsed time when not streaming", () => {
		render(<ReasoningBlock {...defaultProps} isStreaming={false} isLast={true} />)
		expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument()
	})

	it("does not render content when content is empty", () => {
		const { container } = render(<ReasoningBlock {...defaultProps} content="" />)

		// Expand
		const header = screen.getByText("Thinking").closest(".am-reasoning-header")
		fireEvent.click(header!)

		// No content div should be rendered
		expect(container.querySelector(".am-reasoning-content")).not.toBeInTheDocument()
	})

	it("does not render content when content is whitespace only", () => {
		const { container } = render(<ReasoningBlock {...defaultProps} content="   " />)

		// Expand
		const header = screen.getByText("Thinking").closest(".am-reasoning-header")
		fireEvent.click(header!)

		// No content div should be rendered
		expect(container.querySelector(".am-reasoning-content")).not.toBeInTheDocument()
	})

	it("has correct CSS classes", () => {
		const { container } = render(<ReasoningBlock {...defaultProps} />)

		expect(container.querySelector(".am-reasoning-block")).toBeInTheDocument()
		expect(container.querySelector(".am-reasoning-header")).toBeInTheDocument()
		expect(container.querySelector(".am-reasoning-title")).toBeInTheDocument()
		expect(container.querySelector(".am-reasoning-chevron")).toBeInTheDocument()
	})

	it("chevron has collapsed class when collapsed", () => {
		const { container } = render(<ReasoningBlock {...defaultProps} />)

		const chevron = container.querySelector(".am-reasoning-chevron")
		expect(chevron).toHaveClass("am-collapsed")
	})

	it("chevron does not have collapsed class when expanded", () => {
		const { container } = render(<ReasoningBlock {...defaultProps} />)

		// Expand
		const header = screen.getByText("Thinking").closest(".am-reasoning-header")
		fireEvent.click(header!)

		const chevron = container.querySelector(".am-reasoning-chevron")
		expect(chevron).not.toHaveClass("am-collapsed")
	})
})

import { render, screen } from "@testing-library/react"
import { DecoratedVSCodeTextField } from "../DecoratedVSCodeTextField"

describe("DecoratedVSCodeTextField", () => {
	test("renders without nodes as standard VSCodeTextField", () => {
		render(<DecoratedVSCodeTextField placeholder="Test placeholder" data-testid="test-input" />)

		const input = screen.getByTestId("test-input")
		expect(input).toBeInTheDocument()
	})

	test("renders with left nodes", () => {
		render(
			<DecoratedVSCodeTextField
				placeholder="Test placeholder"
				data-testid="test-input"
				leftNodes={[<span key="dollar">$</span>]}
			/>,
		)

		const input = screen.getByTestId("test-input")
		expect(input).toBeInTheDocument()

		// Check that the dollar sign is rendered
		expect(screen.getByText("$")).toBeInTheDocument()
	})

	test("renders with right nodes", () => {
		render(
			<DecoratedVSCodeTextField
				placeholder="Test placeholder"
				data-testid="test-input"
				rightNodes={[<span key="usd">USD</span>]}
			/>,
		)

		const input = screen.getByTestId("test-input")
		expect(input).toBeInTheDocument()

		// Check that the USD text is rendered
		expect(screen.getByText("USD")).toBeInTheDocument()
	})

	test("renders with both left and right nodes", () => {
		render(
			<DecoratedVSCodeTextField
				placeholder="Test placeholder"
				data-testid="test-input"
				leftNodes={[<span key="dollar">$</span>]}
				rightNodes={[<span key="usd">USD</span>]}
			/>,
		)

		const input = screen.getByTestId("test-input")
		expect(input).toBeInTheDocument()

		// Check that both nodes are rendered
		expect(screen.getByText("$")).toBeInTheDocument()
		expect(screen.getByText("USD")).toBeInTheDocument()
	})

	test("handles multiple left nodes", () => {
		render(
			<DecoratedVSCodeTextField
				placeholder="Test placeholder"
				data-testid="test-input"
				leftNodes={[<span key="icon">🔍</span>, <span key="text">Search</span>]}
			/>,
		)

		const input = screen.getByTestId("test-input")
		expect(input).toBeInTheDocument()

		// Check that both left nodes are rendered
		expect(screen.getByText("🔍")).toBeInTheDocument()
		expect(screen.getByText("Search")).toBeInTheDocument()
	})
})

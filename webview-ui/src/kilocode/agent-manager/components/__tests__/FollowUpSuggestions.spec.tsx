import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import { FollowUpSuggestions } from "../FollowUpSuggestions"
import type { SuggestionItem } from "@roo-code/types"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Wrapper component to provide TooltipProvider context
const TestWrapper = ({ children }: { children: React.ReactNode }) => <TooltipProvider>{children}</TooltipProvider>

describe("FollowUpSuggestions", () => {
	const mockSuggestions: SuggestionItem[] = [
		{ answer: "Yes, proceed" },
		{ answer: "No, cancel" },
		{ answer: "Let me think" },
	]

	it("renders nothing when suggestions array is empty", () => {
		const { container } = render(<FollowUpSuggestions suggestions={[]} onSuggestionClick={vi.fn()} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders all suggestions as buttons", () => {
		render(<FollowUpSuggestions suggestions={mockSuggestions} onSuggestionClick={vi.fn()} />)

		expect(screen.getByText("Yes, proceed")).toBeInTheDocument()
		expect(screen.getByText("No, cancel")).toBeInTheDocument()
		expect(screen.getByText("Let me think")).toBeInTheDocument()
	})

	it("calls onSuggestionClick when a suggestion is clicked", () => {
		const onSuggestionClick = vi.fn()
		render(<FollowUpSuggestions suggestions={mockSuggestions} onSuggestionClick={onSuggestionClick} />)

		fireEvent.click(screen.getByText("Yes, proceed"))

		expect(onSuggestionClick).toHaveBeenCalledTimes(1)
		expect(onSuggestionClick).toHaveBeenCalledWith({ answer: "Yes, proceed" })
	})

	it("calls onCopyToInput when copy button is clicked", async () => {
		const onCopyToInput = vi.fn()
		render(
			<TestWrapper>
				<FollowUpSuggestions
					suggestions={mockSuggestions}
					onSuggestionClick={vi.fn()}
					onCopyToInput={onCopyToInput}
				/>
			</TestWrapper>,
		)

		// Find the copy button by its aria-label
		const copyButtons = screen.getAllByLabelText("chat:followUpSuggest.copyToInput")
		fireEvent.click(copyButtons[0])

		expect(onCopyToInput).toHaveBeenCalledTimes(1)
		expect(onCopyToInput).toHaveBeenCalledWith({ answer: "Yes, proceed" })
	})

	it("does not show copy buttons when onCopyToInput is not provided", () => {
		render(<FollowUpSuggestions suggestions={mockSuggestions} onSuggestionClick={vi.fn()} />)

		const copyButtons = screen.queryAllByLabelText("chat:followUpSuggest.copyToInput")
		expect(copyButtons).toHaveLength(0)
	})
})

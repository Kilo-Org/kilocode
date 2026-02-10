// kilocode_change - new file
// npx vitest src/components/kilocode/welcome/__tests__/OnboardingView.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"
import OnboardingView from "../OnboardingView"

// Mock Logo component
vi.mock("../../common/Logo", () => ({
	default: () => <div data-testid="kilo-logo">Kilo Logo</div>,
}))

describe("OnboardingView", () => {
	const mockOnSelectFreeModels = vi.fn()
	const mockOnSelectPremiumModels = vi.fn()
	const mockOnSelectBYOK = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the Kilo logo", () => {
		render(
			<OnboardingView
				onSelectFreeModels={mockOnSelectFreeModels}
				onSelectPremiumModels={mockOnSelectPremiumModels}
				onSelectBYOK={mockOnSelectBYOK}
			/>,
		)

		expect(screen.getByTestId("kilo-logo")).toBeInTheDocument()
	})

	it("renders the title", () => {
		render(
			<OnboardingView
				onSelectFreeModels={mockOnSelectFreeModels}
				onSelectPremiumModels={mockOnSelectPremiumModels}
				onSelectBYOK={mockOnSelectBYOK}
			/>,
		)

		// The translation key is returned as-is by the test-utils mock
		expect(screen.getByText("kilocode:onboarding.title")).toBeInTheDocument()
	})

	it("renders all three options", () => {
		render(
			<OnboardingView
				onSelectFreeModels={mockOnSelectFreeModels}
				onSelectPremiumModels={mockOnSelectPremiumModels}
				onSelectBYOK={mockOnSelectBYOK}
			/>,
		)

		expect(screen.getByText("kilocode:onboarding.freeModels.title")).toBeInTheDocument()
		expect(screen.getByText("kilocode:onboarding.freeModels.description")).toBeInTheDocument()

		expect(screen.getByText("kilocode:onboarding.premiumModels.title")).toBeInTheDocument()
		expect(screen.getByText("kilocode:onboarding.premiumModels.description")).toBeInTheDocument()

		expect(screen.getByText("kilocode:onboarding.byok.title")).toBeInTheDocument()
		expect(screen.getByText("kilocode:onboarding.byok.description")).toBeInTheDocument()
	})

	it("calls onSelectFreeModels when Free models option is clicked", () => {
		render(
			<OnboardingView
				onSelectFreeModels={mockOnSelectFreeModels}
				onSelectPremiumModels={mockOnSelectPremiumModels}
				onSelectBYOK={mockOnSelectBYOK}
			/>,
		)

		const freeModelsButton = screen.getByText("kilocode:onboarding.freeModels.title").closest("button")
		expect(freeModelsButton).toBeInTheDocument()
		fireEvent.click(freeModelsButton!)

		expect(mockOnSelectFreeModels).toHaveBeenCalledTimes(1)
		expect(mockOnSelectPremiumModels).not.toHaveBeenCalled()
		expect(mockOnSelectBYOK).not.toHaveBeenCalled()
	})

	it("calls onSelectPremiumModels when Premium models option is clicked", () => {
		render(
			<OnboardingView
				onSelectFreeModels={mockOnSelectFreeModels}
				onSelectPremiumModels={mockOnSelectPremiumModels}
				onSelectBYOK={mockOnSelectBYOK}
			/>,
		)

		const premiumModelsButton = screen.getByText("kilocode:onboarding.premiumModels.title").closest("button")
		expect(premiumModelsButton).toBeInTheDocument()
		fireEvent.click(premiumModelsButton!)

		expect(mockOnSelectPremiumModels).toHaveBeenCalledTimes(1)
		expect(mockOnSelectFreeModels).not.toHaveBeenCalled()
		expect(mockOnSelectBYOK).not.toHaveBeenCalled()
	})

	it("calls onSelectBYOK when BYOK option is clicked", () => {
		render(
			<OnboardingView
				onSelectFreeModels={mockOnSelectFreeModels}
				onSelectPremiumModels={mockOnSelectPremiumModels}
				onSelectBYOK={mockOnSelectBYOK}
			/>,
		)

		const byokButton = screen.getByText("kilocode:onboarding.byok.title").closest("button")
		expect(byokButton).toBeInTheDocument()
		fireEvent.click(byokButton!)

		expect(mockOnSelectBYOK).toHaveBeenCalledTimes(1)
		expect(mockOnSelectFreeModels).not.toHaveBeenCalled()
		expect(mockOnSelectPremiumModels).not.toHaveBeenCalled()
	})
})

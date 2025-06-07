import { render, screen } from "@testing-library/react"
import { useTranslation } from "react-i18next"
import RulesWorkflowsSection from "../RulesWorkflowsSection"

// Mock the translation hook
jest.mock("react-i18next", () => ({
	useTranslation: jest.fn(),
}))

// Mock the RulesToggleList component
jest.mock("../RulesToggleList", () => {
	return function MockRulesToggleList({ ruleType, isGlobal }: { ruleType: string; isGlobal: boolean }) {
		return <div data-testid={`rules-list-${ruleType}-${isGlobal ? "global" : "local"}`} />
	}
})

const mockT = jest.fn((key: string) => key)

describe("RulesWorkflowsSection", () => {
	beforeEach(() => {
		;(useTranslation as jest.Mock).mockReturnValue({ t: mockT })
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	it("renders rules sections correctly", () => {
		const mockToggleGlobal = jest.fn()
		const mockToggleLocal = jest.fn()
		const globalRules: [string, boolean][] = [["rule1", true]]
		const localRules: [string, boolean][] = [["rule2", false]]

		render(
			<RulesWorkflowsSection
				type="rules"
				globalItems={globalRules}
				localItems={localRules}
				toggleGlobal={mockToggleGlobal}
				toggleLocal={mockToggleLocal}
			/>,
		)

		expect(mockT).toHaveBeenCalledWith("kilocode:rules.sections.globalRules")
		expect(mockT).toHaveBeenCalledWith("kilocode:rules.sections.workspaceRules")
		expect(screen.getByTestId("rules-list-rule-global")).toBeInTheDocument()
		expect(screen.getByTestId("rules-list-rule-local")).toBeInTheDocument()
	})

	it("renders workflows sections correctly", () => {
		const mockToggleGlobal = jest.fn()
		const mockToggleLocal = jest.fn()
		const globalWorkflows: [string, boolean][] = [["workflow1", true]]
		const localWorkflows: [string, boolean][] = [["workflow2", false]]

		render(
			<RulesWorkflowsSection
				type="workflows"
				globalItems={globalWorkflows}
				localItems={localWorkflows}
				toggleGlobal={mockToggleGlobal}
				toggleLocal={mockToggleLocal}
			/>,
		)

		expect(mockT).toHaveBeenCalledWith("kilocode:rules.sections.globalWorkflows")
		expect(mockT).toHaveBeenCalledWith("kilocode:rules.sections.workspaceWorkflows")
		expect(screen.getByTestId("rules-list-workflow-global")).toBeInTheDocument()
		expect(screen.getByTestId("rules-list-workflow-local")).toBeInTheDocument()
	})
})

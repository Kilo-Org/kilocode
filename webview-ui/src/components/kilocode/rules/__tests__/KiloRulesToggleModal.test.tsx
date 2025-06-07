import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import KiloRulesToggleModal from "../KiloRulesToggleModal"

// Mock the translation hook
jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"kilocode:rules.tooltip": "Manage Kilo Code Rules & Workflows",
				"kilocode:rules.ariaLabel": "Kilo Code Rules",
				"kilocode:rules.tabs.rules": "Rules",
				"kilocode:rules.tabs.workflows": "Workflows",
				"kilocode:rules.description.rules": "Rules allow you to provide Kilo Code with system-level guidance.",
				"kilocode:rules.description.workflows": "Workflows allow you to define a series of steps.",
				"kilocode:rules.description.workflowsInChat": "in the chat.",
				"kilocode:rules.sections.globalRules": "Global Rules",
				"kilocode:rules.sections.workspaceRules": "Workspace Rules",
				"kilocode:rules.sections.globalWorkflows": "Global Workflows",
				"kilocode:rules.sections.workspaceWorkflows": "Workspace Workflows",
				"kilocode:docs": "Docs",
			}
			return translations[key] || key
		},
	}),
}))

// Mock the extension state context
jest.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		workflowToggles: {},
		setWorkflowToggles: jest.fn(),
	}),
}))

// Mock vscode
jest.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

// Mock react-use hooks
jest.mock("react-use", () => ({
	useWindowSize: () => ({ width: 1024, height: 768 }),
	useClickAway: jest.fn(),
}))

describe("KiloRulesToggleModal", () => {
	it("renders the rules toggle button", () => {
		render(<KiloRulesToggleModal />)

		const button = screen.getByRole("button", { name: "Kilo Code Rules" })
		expect(button).toBeInTheDocument()
	})

	it("has the correct icon", () => {
		render(<KiloRulesToggleModal />)

		const icon = document.querySelector(".codicon-law")
		expect(icon).toBeInTheDocument()
	})
})

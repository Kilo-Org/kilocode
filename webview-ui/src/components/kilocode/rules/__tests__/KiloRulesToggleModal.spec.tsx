import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"

import KiloRulesToggleModal from "../KiloRulesToggleModal"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("react-use", () => ({
	useWindowSize: () => ({ width: 1000, height: 800 }),
	useClickAway: () => undefined,
}))

vi.mock("@src/components/modes/ModesView", () => ({
	__esModule: true,
	default: () => <div data-testid="modes-view" />,
}))

vi.mock("@src/components/mcp/McpView", () => ({
	__esModule: true,
	default: () => <div data-testid="mcp-view" />,
}))

vi.mock("../KiloRulesWorkflowsView", () => ({
	__esModule: true,
	default: ({ type }: { type: "rule" | "workflow" }) => <div data-testid={`rules-workflows-${type}`} />,
}))

describe("KiloRulesToggleModal", () => {
	it("renders Modes, MCP, Rules, and Workflows as tabs", () => {
		render(<KiloRulesToggleModal />)

		fireEvent.click(screen.getByLabelText("kilocode:rules.ariaLabel"))

		expect(screen.getByText("settings:sections.modes")).toBeInTheDocument()
		expect(screen.getByText("kilocode:settings.sections.mcp")).toBeInTheDocument()
		expect(screen.getByText("kilocode:rules.tabs.rules")).toBeInTheDocument()
		expect(screen.getByText("kilocode:rules.tabs.workflows")).toBeInTheDocument()

		fireEvent.click(screen.getByText("settings:sections.modes"))
		expect(screen.getByTestId("modes-view")).toBeInTheDocument()

		fireEvent.click(screen.getByText("kilocode:settings.sections.mcp"))
		expect(screen.getByTestId("mcp-view")).toBeInTheDocument()

		fireEvent.click(screen.getByText("kilocode:rules.tabs.rules"))
		expect(screen.getByTestId("rules-workflows-rule")).toBeInTheDocument()

		fireEvent.click(screen.getByText("kilocode:rules.tabs.workflows"))
		expect(screen.getByTestId("rules-workflows-workflow")).toBeInTheDocument()
	})
})

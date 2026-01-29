import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useTaskHistory } from "@/kilocode/hooks/useTaskHistory"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"

vi.mock("@/kilocode/hooks/useTaskHistory")
vi.mock("@/context/ExtensionStateContext")
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock i18next before importing the component (it uses i18next.t at module level)
vi.mock("i18next", () => ({
	default: {
		t: (key: string, options?: any) => {
			if (key === "ideaSuggestionsBox.ideas" && options?.returnObjects) {
				return {
					idea1: "Create a portfolio website",
					idea2: "Build a todo app",
					idea3: "Make a calculator",
				}
			}
			return key
		},
	},
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: any) => {
			if (key === "ideaSuggestionsBox.newHere") return "New here?"
			if (key === "ideaSuggestionsBox.tryOneOfThese") return "Try one of these ideas to get started:"
			if (key === "ideaSuggestionsBox.clickToInsert")
				return "Click any suggestion to start working on it immediately"
			if (key === "ideaSuggestionsBox.ideas" && options?.returnObjects) {
				return {
					idea1: "Create a portfolio website",
					idea2: "Build a todo app",
					idea3: "Make a calculator",
				}
			}
			return key
		},
	}),
}))

// Import component after mocks are set up
import { IdeaSuggestionsBox } from "../IdeaSuggestionsBox"

describe("IdeaSuggestionsBox", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(window as any).ICONS_BASE_URI = "/icons"
		vi.mocked(useExtensionState).mockReturnValue({
			taskHistoryVersion: 1,
		} as any)
	})

	it("should render when workspace has no tasks", () => {
		vi.mocked(useTaskHistory).mockReturnValue({
			data: { historyItems: [] },
		} as any)

		render(<IdeaSuggestionsBox />)

		expect(screen.getByText("New here?")).toBeInTheDocument()
		expect(screen.getByText("Try one of these ideas to get started:")).toBeInTheDocument()
	})

	it("should not render when workspace has tasks", () => {
		vi.mocked(useTaskHistory).mockReturnValue({
			data: { historyItems: [{ id: "1" }] },
		} as any)

		const { container } = render(<IdeaSuggestionsBox />)

		expect(container.firstChild).toBeNull()
	})

	it("should display suggestion buttons", () => {
		vi.mocked(useTaskHistory).mockReturnValue({
			data: { historyItems: [] },
		} as any)

		render(<IdeaSuggestionsBox />)

		const buttons = screen.getAllByRole("button")
		expect(buttons.length).toBeGreaterThan(0)
	})

	it("should execute task immediately when suggestion is clicked", async () => {
		vi.mocked(useTaskHistory).mockReturnValue({
			data: { historyItems: [] },
		} as any)

		render(<IdeaSuggestionsBox />)

		const buttons = screen.getAllByRole("button")
		fireEvent.click(buttons[0])

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "newTask",
					text: expect.any(String),
					images: [],
				}),
			)
		})
	})

	it("should display Kilo logo", () => {
		vi.mocked(useTaskHistory).mockReturnValue({
			data: { historyItems: [] },
		} as any)

		render(<IdeaSuggestionsBox />)

		const logo = screen.getByAltText("Kilo Code")
		expect(logo).toBeInTheDocument()
		expect(logo).toHaveAttribute("src", "/icons/kilo-dark.svg")
	})
})

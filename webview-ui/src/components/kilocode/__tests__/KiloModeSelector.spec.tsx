import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"
import { KiloModeSelector } from "../KiloModeSelector"
import { vscode } from "@/utils/vscode"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("KiloModeSelector", () => {
	const mockOnChange = vi.fn()
	const defaultProps = {
		value: "code" as const,
		onChange: mockOnChange,
		modeShortcutText: "Cmd+.",
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("renders the mode selector", () => {
		render(<KiloModeSelector {...defaultProps} />)

		const dropdownTrigger = screen.getByTestId("dropdown-trigger")
		expect(dropdownTrigger).toBeInTheDocument()
	})

	test("triggers promptsButtonClicked action when edit option is selected", async () => {
		// Mock window.postMessage to capture the action message
		const mockWindowPostMessage = vi.fn()
		const originalPostMessage = window.postMessage
		window.postMessage = mockWindowPostMessage

		render(<KiloModeSelector {...defaultProps} />)

		// Open the dropdown
		const dropdownTrigger = screen.getByTestId("dropdown-trigger")
		fireEvent.click(dropdownTrigger)

		// Find and click the edit option
		await waitFor(() => {
			const editOption = screen.getByText("chat:edit")
			expect(editOption).toBeInTheDocument()
		})

		const editOption = screen.getByText("chat:edit")
		fireEvent.click(editOption)

		// Verify that window.postMessage was called with the action
		expect(mockWindowPostMessage).toHaveBeenCalledWith({ type: "action", action: "promptsButtonClicked" })

		// Verify that onChange was NOT called (since this is an action, not a mode selection)
		expect(mockOnChange).not.toHaveBeenCalled()

		// Restore original postMessage
		window.postMessage = originalPostMessage
	})

	test("sends mode message when a mode is selected", async () => {
		render(<KiloModeSelector {...defaultProps} />)

		// Open the dropdown
		const dropdownTrigger = screen.getByTestId("dropdown-trigger")
		fireEvent.click(dropdownTrigger)

		// Find and click a mode option (e.g., "Architect")
		await waitFor(() => {
			const architectOption = screen.getByText("Architect")
			expect(architectOption).toBeInTheDocument()
		})

		const architectOption = screen.getByText("Architect")
		fireEvent.click(architectOption)

		// Verify that mode message was sent
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "mode",
			text: "architect",
		})

		// Verify that onChange was called with the selected mode
		expect(mockOnChange).toHaveBeenCalledWith("architect")
	})
})

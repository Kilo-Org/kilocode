import { render, screen, fireEvent } from "@/utils/test-utils"
import { GlobalIgnoreSettings } from "../GlobalIgnoreSettings"
import { vscode } from "@/utils/vscode"

// Mock vscode
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

describe("GlobalIgnoreSettings", () => {
	const mockSetCachedStateField = vi.fn()
	const defaultProps = {
		globallyIgnoredFiles: [".env", "*.secret"],
		alwaysAllowReadOnlyOutsideWorkspace: false,
		setCachedStateField: mockSetCachedStateField,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders correctly", () => {
		render(<GlobalIgnoreSettings {...defaultProps} />)
		expect(screen.getByText("settings:autoApprove.readOnly.label")).toBeInTheDocument()
		expect(screen.getByTestId("global-ignore-input")).toBeInTheDocument()
		expect(screen.getByText(".env")).toBeInTheDocument()
		expect(screen.getByText("*.secret")).toBeInTheDocument()
	})

	it("adds a new global ignore pattern", () => {
		render(<GlobalIgnoreSettings {...defaultProps} />)

		const input = screen.getByTestId("global-ignore-input")
		fireEvent.change(input, { target: { value: "*.pem" } })

		const addButton = screen.getByTestId("add-global-ignore-button")
		fireEvent.click(addButton)

		// Check if state update was called
		expect(mockSetCachedStateField).toHaveBeenCalledWith("globallyIgnoredFiles", [".env", "*.secret", "*.pem"])

		// Check if vscode message was sent
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				globallyIgnoredFiles: [".env", "*.secret", "*.pem"],
			},
		})
	})

	it("does not add duplicate patterns", () => {
		render(<GlobalIgnoreSettings {...defaultProps} />)

		const input = screen.getByTestId("global-ignore-input")
		fireEvent.change(input, { target: { value: ".env" } }) // Already exists

		const addButton = screen.getByTestId("add-global-ignore-button")
		fireEvent.click(addButton)

		expect(mockSetCachedStateField).not.toHaveBeenCalled()
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("removes a global ignore pattern", () => {
		render(<GlobalIgnoreSettings {...defaultProps} />)

		const removeButton = screen.getByTestId("remove-global-ignore-0") // Remove first item (.env)
		fireEvent.click(removeButton)

		expect(mockSetCachedStateField).toHaveBeenCalledWith("globallyIgnoredFiles", ["*.secret"])

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				globallyIgnoredFiles: ["*.secret"],
			},
		})
	})

	it("toggles alwaysAllowReadOnlyOutsideWorkspace", () => {
		render(<GlobalIgnoreSettings {...defaultProps} />)

		const checkbox = screen.getByTestId("always-allow-readonly-outside-workspace-checkbox")
		fireEvent.click(checkbox)

		expect(mockSetCachedStateField).toHaveBeenCalledWith("alwaysAllowReadOnlyOutsideWorkspace", true)
	})
})

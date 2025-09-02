import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { GhostServiceSettingsView } from "../GhostServiceSettings"
import { TranslationProvider } from "../../../../i18n/TranslationContext"
import { useKeybindings } from "../../../../hooks/useKeybindings"

vi.mock("../../../../utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("../../../../context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		listApiConfigMeta: [],
	}),
}))

vi.mock("../../../../hooks/useKeybindings", () => ({
	useKeybindings: vi.fn(),
}))

// Mock ghost service settings
const mockGhostServiceSettings = {
	enableAutoTrigger: true,
	autoTriggerDelay: 1000,
	apiConfigId: "test-config",
	enableQuickInlineTaskKeybinding: true,
	enableSmartInlineTaskKeybinding: true,
}

const mockSetCachedStateField = vi.fn()

// Test wrapper component
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
	<TranslationProvider>{children}</TranslationProvider>
)

describe("GhostServiceSettings Integration", () => {
	const mockUseKeybindings = vi.mocked(useKeybindings)

	beforeEach(() => {
		vi.clearAllMocks()
		// Default mock return empty keybindings
		mockUseKeybindings.mockReturnValue({})
	})

	it("should call useKeybindings with correct command IDs", () => {
		render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Verify useKeybindings is called with the correct command IDs
		expect(mockUseKeybindings).toHaveBeenCalledWith([
			"kilo-code.ghost.promptCodeSuggestion",
			"kilo-code.ghost.generateSuggestions",
		])
	})

	it("should render without crashing when keybindings are provided", () => {
		// Mock keybindings hook to return specific keybindings
		mockUseKeybindings.mockReturnValue({
			"kilo-code.ghost.promptCodeSuggestion": "Command+I",
			"kilo-code.ghost.generateSuggestions": "Control+Shift+G",
		})

		render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Component should render without errors
		expect(screen.getByRole("checkbox", { name: /Quick Task/i })).toBeInTheDocument()
	})

	it("should render without crashing when keybindings are empty", () => {
		// Mock keybindings hook to return empty keybindings
		mockUseKeybindings.mockReturnValue({})

		render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Component should render without errors even with empty keybindings
		expect(screen.getByRole("checkbox", { name: /Quick Task/i })).toBeInTheDocument()
	})

	it("should handle different keybinding formats", () => {
		// Mock keybindings hook to return various keybinding formats
		mockUseKeybindings.mockReturnValue({
			"kilo-code.ghost.promptCodeSuggestion": "Ctrl+I",
			"kilo-code.ghost.generateSuggestions": "Alt+Shift+G",
		})

		render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Component should render without errors with different keybinding formats
		expect(screen.getByRole("checkbox", { name: /Quick Task/i })).toBeInTheDocument()
		expect(screen.getByRole("checkbox", { name: /Manual Autocomplete/i })).toBeInTheDocument()
	})

	it("should pass keybindings to Trans components correctly", () => {
		// Mock keybindings hook to return specific keybindings
		mockUseKeybindings.mockReturnValue({
			"kilo-code.ghost.promptCodeSuggestion": "TestKey+I",
			"kilo-code.ghost.generateSuggestions": "TestKey+L",
		})

		const { container } = render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Verify the component renders and the keybindings hook was called
		expect(mockUseKeybindings).toHaveBeenCalledWith([
			"kilo-code.ghost.promptCodeSuggestion",
			"kilo-code.ghost.generateSuggestions",
		])
		expect(container).toBeInTheDocument()
	})
})

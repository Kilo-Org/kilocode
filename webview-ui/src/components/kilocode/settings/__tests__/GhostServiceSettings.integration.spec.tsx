import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { GhostServiceSettingsView } from "../GhostServiceSettings"
import { TranslationProvider } from "../../../../i18n/TranslationContext"

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
	beforeEach(() => {
		vi.clearAllMocks()
		// Clear any existing event listeners
		window.removeEventListener("message", expect.any(Function))
	})

	it("should display dynamic keybinding in settings description", async () => {
		const { vscode } = await import("../../../../utils/vscode")

		render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Verify that the component requests keybindings
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "getKeybindings",
			commandIds: ["kilo-code.ghost.promptCodeSuggestion", "kilo-code.ghost.generateSuggestions"],
		})

		// Simulate receiving keybindings from the extension
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "keybindingsResponse",
				keybindings: {
					"kilo-code.ghost.promptCodeSuggestion": "Command+I",
					"kilo-code.ghost.generateSuggestions": "Control+Shift+G",
				},
			},
		})
		window.dispatchEvent(messageEvent)

		// Wait for the component to update with the keybinding
		await waitFor(() => {
			// Look for text that contains the dynamic keybinding
			const descriptionElement = screen.getByText(/Command\+I/)
			expect(descriptionElement).toBeInTheDocument()
		})
	})

	it("should fallback to default keybinding when no custom keybinding is set", async () => {
		render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Simulate receiving empty keybindings from the extension
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "keybindingsResponse",
				keybindings: {},
			},
		})
		window.dispatchEvent(messageEvent)

		// Wait for the component to update with the fallback keybinding
		await waitFor(() => {
			// Should show the fallback "Cmd+I"
			const descriptionElement = screen.getByText(/Cmd\+I/)
			expect(descriptionElement).toBeInTheDocument()
		})
	})

	it("should handle platform-specific keybinding display", async () => {
		render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Simulate receiving Windows/Linux style keybindings
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "keybindingsResponse",
				keybindings: {
					"kilo-code.ghost.promptCodeSuggestion": "Ctrl+I", // Windows/Linux format
				},
			},
		})
		window.dispatchEvent(messageEvent)

		// Wait for the component to update with the platform-specific keybinding
		await waitFor(() => {
			const descriptionElement = screen.getByText(/Ctrl\+I/)
			expect(descriptionElement).toBeInTheDocument()
		})
	})

	it("should re-request keybindings when component mounts", async () => {
		const { vscode } = await import("../../../../utils/vscode")

		// Render the component
		render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Verify keybindings are requested on mount
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "getKeybindings",
			commandIds: ["kilo-code.ghost.promptCodeSuggestion", "kilo-code.ghost.generateSuggestions"],
		})
	})

	it("should handle keybinding interpolation in translated text", async () => {
		render(
			<TestWrapper>
				<GhostServiceSettingsView
					ghostServiceSettings={mockGhostServiceSettings}
					setCachedStateField={mockSetCachedStateField}
				/>
			</TestWrapper>,
		)

		// Simulate receiving keybindings
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "keybindingsResponse",
				keybindings: {
					"kilo-code.ghost.promptCodeSuggestion": "Alt+I", // Custom keybinding
				},
			},
		})
		window.dispatchEvent(messageEvent)

		// Wait for the component to update and verify the custom keybinding is displayed
		await waitFor(() => {
			const descriptionElement = screen.getByText(/Alt\+I/)
			expect(descriptionElement).toBeInTheDocument()
		})
	})
})

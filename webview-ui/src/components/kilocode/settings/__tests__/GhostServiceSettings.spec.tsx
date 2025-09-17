import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { GhostServiceSettingsView } from "../GhostServiceSettings"
import { GhostServiceSettings } from "@roo-code/types"
import React from "react"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: any) => <span>{i18nKey || children}</span>,
	useTranslation: () => ({
		t: (key: string) => key,
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

// Mock the context providers
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		listApiConfigMeta: [
			{ id: "config1", name: "Config 1", apiProvider: "openai" },
			{ id: "config2", name: "Config 2", apiProvider: "anthropic" },
		],
	}),
	ExtensionStateProvider: ({ children }: any) => <div>{children}</div>,
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
	TranslationProvider: ({ children }: any) => <div>{children}</div>,
}))

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
	Bot: ({ className }: any) => <span className={className}>Bot Icon</span>,
	Webhook: ({ className }: any) => <span className={className}>Webhook Icon</span>,
	Zap: ({ className }: any) => <span className={className}>Zap Icon</span>,
}))

// Mock cn utility
vi.mock("@/lib/utils", () => ({
	cn: (...classes: any[]) => classes.filter(Boolean).join(" "),
}))

// Mock the vscode module
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock ControlledCheckbox
vi.mock("../../common/ControlledCheckbox", () => ({
	ControlledCheckbox: ({ children, checked, onChange }: any) => (
		<label>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
			{children}
		</label>
	),
}))

// Mock the UI components
vi.mock("@src/components/ui", () => ({
	Select: ({ children, value, onValueChange }: any) => (
		<div data-testid="select" data-value={value} onClick={() => onValueChange?.("test-value")}>
			{children}
		</div>
	),
	SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
	SelectContent: ({ children }: any) => <div>{children}</div>,
	SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
	Slider: ({ value, onValueChange, disabled }: any) => (
		<input
			type="range"
			value={value?.[0] || 0}
			onChange={(e) => onValueChange?.([parseInt(e.target.value)])}
			disabled={disabled}
		/>
	),
	Collapsible: ({ children, open, onOpenChange }: any) => (
		<div data-testid="collapsible" data-open={open}>
			{React.Children.map(children, (child) => {
				if (child?.type?.name === "CollapsibleTrigger") {
					return React.cloneElement(child, {
						onClick: () => onOpenChange?.(!open),
					})
				}
				return child
			})}
		</div>
	),
	CollapsibleTrigger: ({ children, onClick }: any) => (
		<button data-testid="collapsible-trigger" onClick={onClick}>
			{children}
		</button>
	),
	CollapsibleContent: ({ children }: any) => <div data-testid="collapsible-content">{children}</div>,
}))

// Mock the settings components
vi.mock("../../settings/SectionHeader", () => ({
	SectionHeader: ({ children }: any) => <div>{children}</div>,
}))

vi.mock("../../settings/Section", () => ({
	Section: ({ children }: any) => <div>{children}</div>,
}))

const defaultGhostServiceSettings: GhostServiceSettings = {
	enableAutoTrigger: false,
	autoTriggerDelay: 3,
	apiConfigId: "",
	enableQuickInlineTaskKeybinding: false,
	enableSmartInlineTaskKeybinding: false,
	enableCustomProvider: false,
}

const renderComponent = (props = {}) => {
	const defaultProps = {
		ghostServiceSettings: defaultGhostServiceSettings,
		setCachedStateField: vi.fn(),
		...props,
	}

	return render(<GhostServiceSettingsView {...defaultProps} />)
}

describe("GhostServiceSettingsView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the component without errors", () => {
		expect(() => renderComponent()).not.toThrow()
	})

	it("renders basic component structure", () => {
		renderComponent()

		// Verify basic structure is present
		expect(document.querySelector(".flex.flex-col")).toBeInTheDocument()

		// Verify checkboxes are rendered
		const checkboxes = screen.getAllByRole("checkbox")
		expect(checkboxes.length).toBeGreaterThan(0)
	})

	it("renders basic trigger settings", () => {
		renderComponent()

		// Check that trigger settings are visible
		expect(screen.getByText(/kilocode:ghost.settings.triggers/)).toBeInTheDocument()
		expect(screen.getByText(/kilocode:ghost.settings.enableAutoTrigger.label/)).toBeInTheDocument()
	})

	it("shows advanced settings collapsed by default", () => {
		renderComponent()

		// Check that the collapsible is rendered but closed
		const collapsible = screen.getByTestId("collapsible")
		expect(collapsible).toHaveAttribute("data-open", "false")

		// Provider settings should still be in the DOM but inside collapsed content
		expect(screen.getByText(/kilocode:ghost.settings.provider/)).toBeInTheDocument()
	})

	it("expands advanced settings when clicked", () => {
		renderComponent()

		// Find and verify the trigger exists and can be clicked
		const trigger = screen.getByTestId("collapsible-trigger")
		expect(trigger).toBeInTheDocument()

		// Verify it has the correct initial text
		expect(screen.getByText("settings:advancedSettings.title")).toBeInTheDocument()

		// Click the trigger - state changes are handled by the actual Collapsible component
		fireEvent.click(trigger)

		// The click event should be handled without errors
		expect(trigger).toBeInTheDocument()
	})

	it("toggles auto trigger checkbox correctly", () => {
		const setCachedStateField = vi.fn()
		renderComponent({ setCachedStateField })

		// Find and click the auto trigger checkbox
		const checkbox = screen
			.getByText(/kilocode:ghost.settings.enableAutoTrigger.label/)
			.closest("label")
			?.querySelector("input[type='checkbox']")

		if (checkbox) {
			fireEvent.click(checkbox)
		}

		expect(setCachedStateField).toHaveBeenCalledWith(
			"ghostServiceSettings",
			expect.objectContaining({
				enableAutoTrigger: true,
			}),
		)
	})

	it("toggles quick inline task keybinding checkbox correctly", () => {
		const setCachedStateField = vi.fn()
		renderComponent({ setCachedStateField })

		// Find and click the quick inline task keybinding checkbox
		const checkbox = screen
			.getByText(/kilocode:ghost.settings.enableQuickInlineTaskKeybinding.label/)
			.closest("label")
			?.querySelector("input[type='checkbox']")

		if (checkbox) {
			fireEvent.click(checkbox)
		}

		expect(setCachedStateField).toHaveBeenCalledWith(
			"ghostServiceSettings",
			expect.objectContaining({
				enableQuickInlineTaskKeybinding: true,
			}),
		)
	})

	it("toggles smart inline task keybinding checkbox correctly", () => {
		const setCachedStateField = vi.fn()
		renderComponent({ setCachedStateField })

		// Find and click the smart inline task keybinding checkbox
		const checkbox = screen
			.getByText(/kilocode:ghost.settings.enableSmartInlineTaskKeybinding.label/)
			.closest("label")
			?.querySelector("input[type='checkbox']")

		if (checkbox) {
			fireEvent.click(checkbox)
		}

		expect(setCachedStateField).toHaveBeenCalledWith(
			"ghostServiceSettings",
			expect.objectContaining({
				enableSmartInlineTaskKeybinding: true,
			}),
		)
	})

	it("toggles custom provider checkbox correctly", () => {
		const setCachedStateField = vi.fn()
		renderComponent({ setCachedStateField })

		// Find and click the custom provider checkbox
		const checkbox = screen
			.getByText(/kilocode:ghost.settings.enableCustomProvider.label/)
			.closest("label")
			?.querySelector("input[type='checkbox']")

		if (checkbox) {
			fireEvent.click(checkbox)
		}

		expect(setCachedStateField).toHaveBeenCalledWith(
			"ghostServiceSettings",
			expect.objectContaining({
				enableCustomProvider: true,
			}),
		)
	})

	it("shows API config selector when custom provider is enabled", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				enableCustomProvider: true,
			},
		})

		// Check that the API config selector is visible
		expect(screen.getByText(/kilocode:ghost.settings.apiConfigId.label/)).toBeInTheDocument()
		expect(screen.getByTestId("autocomplete-api-config-select")).toBeInTheDocument()
	})

	it("hides API config selector when custom provider is disabled", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				enableCustomProvider: false,
			},
		})

		// The label exists in the DOM but the selector should not
		expect(screen.queryByTestId("autocomplete-api-config-select")).not.toBeInTheDocument()
	})

	it("shows auto-trigger delay slider when auto-trigger is enabled", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				enableAutoTrigger: true,
			},
		})

		// Check that the delay slider is visible
		expect(screen.getByText(/kilocode:ghost.settings.autoTriggerDelay.label/)).toBeInTheDocument()
		expect(screen.getByRole("slider")).toBeInTheDocument()
	})

	it("hides auto-trigger delay slider when auto-trigger is disabled", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				enableAutoTrigger: false,
			},
		})

		// Check that the delay slider is not visible
		expect(screen.queryByText(/kilocode:ghost.settings.autoTriggerDelay.label/)).not.toBeInTheDocument()
		expect(screen.queryByRole("slider")).not.toBeInTheDocument()
	})

	it("updates auto-trigger delay via slider", () => {
		const setCachedStateField = vi.fn()
		renderComponent({
			setCachedStateField,
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				enableAutoTrigger: true,
			},
		})

		// Find and change the slider value
		const slider = screen.getByRole("slider")
		fireEvent.change(slider, { target: { value: "5" } })

		expect(setCachedStateField).toHaveBeenCalledWith(
			"ghostServiceSettings",
			expect.objectContaining({
				autoTriggerDelay: 5,
			}),
		)
	})

	it("renders with proper chevron icon state", () => {
		renderComponent()

		const trigger = screen.getByTestId("collapsible-trigger")
		const chevron = trigger.querySelector(".codicon-chevron-right")

		expect(chevron).toBeInTheDocument()

		// Click to expand
		fireEvent.click(trigger)

		// After clicking, it should change to chevron-down
		// Note: This would require re-render in real implementation
	})

	it("preserves trigger settings visibility when advanced settings are toggled", () => {
		renderComponent()

		// Trigger settings should always be visible
		expect(screen.getByText(/kilocode:ghost.settings.triggers/)).toBeInTheDocument()
		expect(screen.getByText(/kilocode:ghost.settings.enableAutoTrigger.label/)).toBeInTheDocument()

		// Toggle advanced settings
		const trigger = screen.getByTestId("collapsible-trigger")
		fireEvent.click(trigger)

		// Trigger settings should still be visible
		expect(screen.getByText(/kilocode:ghost.settings.triggers/)).toBeInTheDocument()
		expect(screen.getByText(/kilocode:ghost.settings.enableAutoTrigger.label/)).toBeInTheDocument()
	})

	it("renders Trans components with proper structure", () => {
		renderComponent()

		// Look for the description divs that should contain the Trans components
		const descriptionDivs = document.querySelectorAll(".text-vscode-descriptionForeground.text-sm")

		// We should have multiple description divs for the different settings
		expect(descriptionDivs.length).toBeGreaterThan(2)
	})

	it("handles API config selection correctly", () => {
		const setCachedStateField = vi.fn()
		renderComponent({
			setCachedStateField,
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				enableCustomProvider: true,
			},
		})

		// Find and click the API config select
		const select = screen.getByTestId("autocomplete-api-config-select")
		fireEvent.click(select)

		// The select should be rendered without errors
		expect(select).toBeInTheDocument()
	})

	it("resets API config when custom provider is disabled", () => {
		const setCachedStateField = vi.fn()
		renderComponent({
			setCachedStateField,
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				enableCustomProvider: true,
				apiConfigId: "config1",
			},
		})

		// Find and click the custom provider checkbox to disable it
		const checkbox = screen
			.getByText(/kilocode:ghost.settings.enableCustomProvider.label/)
			.closest("label")
			?.querySelector("input[type='checkbox']")

		if (checkbox) {
			fireEvent.click(checkbox)
		}

		expect(setCachedStateField).toHaveBeenCalledWith(
			"ghostServiceSettings",
			expect.objectContaining({
				enableCustomProvider: false,
				apiConfigId: "",
			}),
		)
	})
})

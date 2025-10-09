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

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
	TranslationProvider: ({ children }: any) => <div>{children}</div>,
}))

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
	Bot: ({ className }: any) => <span className={className}>Bot Icon</span>,
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
	Slider: ({ value, onValueChange, disabled }: any) => (
		<input
			type="range"
			value={value?.[0] || 0}
			onChange={(e) => onValueChange?.([parseInt(e.target.value)])}
			disabled={disabled}
		/>
	),
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
	enableQuickInlineTaskKeybinding: false,
	enableSmartInlineTaskKeybinding: false,
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

	it("renders Trans components with proper structure", () => {
		renderComponent()

		// Look for the description divs that should contain the Trans components
		const descriptionDivs = document.querySelectorAll(".text-vscode-descriptionForeground.text-sm")

		// We should have multiple description divs for the different settings
		expect(descriptionDivs.length).toBeGreaterThan(2)
	})
})

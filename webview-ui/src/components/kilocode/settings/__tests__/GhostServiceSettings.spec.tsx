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
	Settings: ({ className }: any) => <span className={className}>Settings Icon</span>,
	Check: ({ className }: any) => <span className={className}>Check Icon</span>,
	X: ({ className }: any) => <span className={className}>X Icon</span>,
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

// Mock useKeybindings hook
vi.mock("@/hooks/useKeybindings", () => ({
	useKeybindings: () => ({
		"kilo-code.addToContextAndFocus": "Cmd+K",
		"kilo-code.ghost.generateSuggestions": "Cmd+Shift+G",
	}),
}))

// Mock ExtensionStateContext
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		listApiConfigMeta: [
			{ id: "profile1", name: "Profile 1", apiProvider: "anthropic" },
			{ id: "profile2", name: "Profile 2", apiProvider: "openrouter" },
		],
	}),
}))

// Mock VSCodeCheckbox and VSCodeTextField to render as regular HTML elements for testing
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, onChange, children }: any) => (
		<label>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange({ target: { checked: e.target.checked } })}
			/>
			{children}
		</label>
	),
	VSCodeTextField: ({ value, onInput, placeholder }: any) => (
		<input type="text" value={value} onInput={onInput} placeholder={placeholder} />
	),
}))

// Mock SelectDropdown first to avoid circular dependency
vi.mock("../../ui/select-dropdown", () => ({
	SelectDropdown: ({ value, onChange, options, placeholder }: any) => (
		<select value={value} onChange={(e) => onChange(e.target.value)} data-testid="select-dropdown">
			{options.map((opt: any) => (
				<option key={opt.value} value={opt.value}>
					{opt.label}
				</option>
			))}
		</select>
	),
}))

// Mock the UI components
vi.mock("@src/components/ui", async (importOriginal) => {
	const actual: any = await importOriginal()
	return {
		...actual,
		Slider: ({ value, onValueChange, disabled }: any) => (
			<input
				type="range"
				value={value?.[0] || 0}
				onChange={(e) => onValueChange?.([parseInt(e.target.value)])}
				disabled={disabled}
			/>
		),
	}
})

// Mock the settings components
vi.mock("../../settings/SectionHeader", () => ({
	SectionHeader: ({ children }: any) => <div>{children}</div>,
}))

vi.mock("../../settings/Section", () => ({
	Section: ({ children }: any) => <div>{children}</div>,
}))

const defaultGhostServiceSettings: GhostServiceSettings = {
	enableAutoTrigger: false,
	enableQuickInlineTaskKeybinding: false,
	enableSmartInlineTaskKeybinding: false,
	provider: "openrouter",
	model: "openai/gpt-4o-mini",
}

const renderComponent = (props = {}) => {
	const defaultProps = {
		ghostServiceSettings: defaultGhostServiceSettings,
		onGhostServiceSettingsChange: vi.fn(),
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
		const onGhostServiceSettingsChange = vi.fn()
		renderComponent({ onGhostServiceSettingsChange })

		const checkboxLabel = screen.getByText(/kilocode:ghost.settings.enableAutoTrigger.label/).closest("label")
		const checkbox = checkboxLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement

		fireEvent.click(checkbox)

		expect(onGhostServiceSettingsChange).toHaveBeenCalledWith("enableAutoTrigger", true)
	})

	it("toggles quick inline task keybinding checkbox correctly", () => {
		const onGhostServiceSettingsChange = vi.fn()
		renderComponent({ onGhostServiceSettingsChange })

		const checkboxLabel = screen
			.getByText(/kilocode:ghost.settings.enableQuickInlineTaskKeybinding.label/)
			.closest("label")
		const checkbox = checkboxLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement

		fireEvent.click(checkbox)

		expect(onGhostServiceSettingsChange).toHaveBeenCalledWith("enableQuickInlineTaskKeybinding", true)
	})

	it("toggles smart inline task keybinding checkbox correctly", () => {
		const onGhostServiceSettingsChange = vi.fn()
		renderComponent({ onGhostServiceSettingsChange })

		const checkboxLabel = screen
			.getByText(/kilocode:ghost.settings.enableSmartInlineTaskKeybinding.label/)
			.closest("label")
		const checkbox = checkboxLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement

		fireEvent.click(checkbox)

		expect(onGhostServiceSettingsChange).toHaveBeenCalledWith("enableSmartInlineTaskKeybinding", true)
	})

	it("renders Trans components with proper structure", () => {
		renderComponent()

		// Look for the description divs that should contain the Trans components
		const descriptionDivs = document.querySelectorAll(".text-vscode-descriptionForeground.text-sm")

		// We should have multiple description divs for the different settings
		expect(descriptionDivs.length).toBeGreaterThan(2)
	})

	it("displays provider and model information when available", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				provider: "openrouter",
				model: "openai/gpt-4o-mini",
			},
		})

		expect(screen.getByText(/kilocode:ghost.settings.provider/)).toBeInTheDocument()
		expect(screen.getByText(/openrouter/)).toBeInTheDocument()
		expect(screen.getAllByText(/kilocode:ghost.settings.model/).length).toBeGreaterThan(0)
		expect(screen.getByText(/openai\/gpt-4o-mini/)).toBeInTheDocument()
	})

	it("displays error message when provider and model are not configured", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				provider: undefined,
				model: undefined,
			},
		})

		expect(screen.getByText(/kilocode:ghost.settings.noModelConfigured/)).toBeInTheDocument()
	})

	it("displays error message when only provider is missing", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				provider: undefined,
				model: "openai/gpt-4o-mini",
			},
		})

		expect(screen.getByText(/kilocode:ghost.settings.noModelConfigured/)).toBeInTheDocument()
	})

	it("displays error message when only model is missing", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				provider: "openrouter",
				model: undefined,
			},
		})

		expect(screen.getByText(/kilocode:ghost.settings.noModelConfigured/)).toBeInTheDocument()
	})

	describe("Autocomplete Configuration", () => {
		it("renders autocomplete profile selector", () => {
			renderComponent()

			const triggers = screen.getAllByTestId("dropdown-trigger")
			expect(triggers.length).toBeGreaterThan(0)
			expect(screen.getByText("Autocomplete Configuration")).toBeInTheDocument()
		})

		it("shows profile selector with auto-detect as default", () => {
			renderComponent()

			expect(screen.getByText("Auto-detect (use first available)")).toBeInTheDocument()
		})

		it("shows provider and model overrides when profile is selected", () => {
			renderComponent({
				ghostServiceSettings: {
					...defaultGhostServiceSettings,
					autocompleteProfileId: "profile1",
				},
			})

			// Should show provider override and model input
			expect(screen.getByText("Provider Override (Optional)")).toBeInTheDocument()
			expect(screen.getByText("Model Override (Optional)")).toBeInTheDocument()

			// Check for model input
			const modelInput = screen.getByPlaceholderText(/Use profile default/)
			expect(modelInput).toBeInTheDocument()
		})

		it("hides provider and model overrides when no profile is selected", () => {
			renderComponent({
				ghostServiceSettings: {
					...defaultGhostServiceSettings,
					autocompleteProfileId: undefined,
				},
			})

			// Provider and model overrides should not be present
			expect(screen.queryByText("Provider Override (Optional)")).not.toBeInTheDocument()
			expect(screen.queryByText("Model Override (Optional)")).not.toBeInTheDocument()
			expect(screen.queryByPlaceholderText(/Use profile default/)).not.toBeInTheDocument()
		})

		it("displays selected profile name", () => {
			renderComponent({
				ghostServiceSettings: {
					...defaultGhostServiceSettings,
					autocompleteProfileId: "profile1",
				},
			})

			expect(screen.getByText("Profile 1")).toBeInTheDocument()
		})
	})
})

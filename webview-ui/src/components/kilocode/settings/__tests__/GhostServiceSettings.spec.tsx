import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { GhostServiceSettingsView } from "../GhostServiceSettings"
import { GhostServiceSettings } from "@roo-code/types"
import React from "react"
import { SearchIndexProvider } from "@/components/settings/useSettingsSearch"

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
	Clock: ({ className }: any) => <span className={className}>Clock Icon</span>,
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
		"kilo-code.ghost.generateSuggestions": "Cmd+Shift+G",
	}),
}))

// Mock useExtensionState hook
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		kiloCodeWrapperProperties: undefined,
	}),
}))

// Mock VSCode webview-ui-toolkit components for testing
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
	VSCodeButton: ({ children, onClick, appearance }: any) => (
		<button onClick={onClick} data-appearance={appearance}>
			{children}
		</button>
	),
	VSCodeDropdown: ({ children, value, onChange }: any) => (
		<select value={value} onChange={(e) => onChange({ target: { value: e.target.value } })}>
			{children}
		</select>
	),
	VSCodeOption: ({ children, value }: any) => <option value={value}>{children}</option>,
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
	enableSmartInlineTaskKeybinding: false,
	enableChatAutocomplete: false,
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

const renderComponentWithSearch = (
	props: Partial<React.ComponentProps<typeof GhostServiceSettingsView>> & { registerSetting?: any } = {},
) => {
	const registerSetting = props.registerSetting ?? vi.fn()
	const { registerSetting: _omit, ...rest } = props

	const defaultProps = {
		ghostServiceSettings: defaultGhostServiceSettings,
		onGhostServiceSettingsChange: vi.fn(),
		...rest,
	}

	return {
		registerSetting,
		...render(
			<SearchIndexProvider value={{ registerSetting }}>
				<GhostServiceSettingsView {...(defaultProps as any)} />
			</SearchIndexProvider>,
		),
	}
}

describe("GhostServiceSettingsView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("renders the component without errors", () => {
		expect(() => renderComponent()).not.toThrow()
	})

	it("registers settings for Settings Search when a SearchIndexProvider is present", async () => {
		// RTL's waitFor uses timers internally; these tests need real timers.
		vi.useRealTimers()

		const { registerSetting } = renderComponentWithSearch({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				enableAutoTrigger: false,
				enableChatAutocomplete: false,
				enableSmartInlineTaskKeybinding: false,
			},
		})

		await waitFor(() => {
			const ids = registerSetting.mock.calls.map(([arg]: any[]) => arg.settingId)
			expect(ids).toContain("ghost-enable-auto-trigger")
			expect(ids).toContain("ghost-smart-inline-task-keybinding")
			expect(ids).toContain("ghost-chat-autocomplete")
			expect(ids).toContain("ghost-autocomplete-model")
		})

		// Snooze setting should not be registered unless enableAutoTrigger is enabled
		const snoozeCalls = registerSetting.mock.calls.filter(([arg]: any[]) => arg.settingId === "ghost-snooze")
		expect(snoozeCalls).toHaveLength(0)
	})

	it("registers snooze setting when auto-trigger is enabled", async () => {
		// RTL's waitFor uses timers internally; these tests need real timers.
		vi.useRealTimers()

		const { registerSetting } = renderComponentWithSearch({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				enableAutoTrigger: true,
				snoozeUntil: undefined,
			},
		})

		await waitFor(() => {
			const ids = registerSetting.mock.calls.map(([arg]: any[]) => arg.settingId)
			expect(ids).toContain("ghost-snooze")
		})
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
		expect(screen.getByText(/kilocode:ghost.settings.codeEditorSuggestions/)).toBeInTheDocument()
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

	it("toggles chat autocomplete checkbox correctly", () => {
		const onGhostServiceSettingsChange = vi.fn()
		renderComponent({ onGhostServiceSettingsChange })

		const checkboxLabel = screen.getByText(/kilocode:ghost.settings.enableChatAutocomplete.label/).closest("label")
		const checkbox = checkboxLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement

		fireEvent.click(checkbox)

		expect(onGhostServiceSettingsChange).toHaveBeenCalledWith("enableChatAutocomplete", true)
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

		expect(screen.getByText(/kilocode:ghost.settings.noModelConfigured.title/)).toBeInTheDocument()
	})

	it("displays error message when only provider is missing", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				provider: undefined,
				model: "openai/gpt-4o-mini",
			},
		})

		expect(screen.getByText(/kilocode:ghost.settings.noModelConfigured.title/)).toBeInTheDocument()
	})

	it("displays error message when only model is missing", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				provider: "openrouter",
				model: undefined,
			},
		})

		expect(screen.getByText(/kilocode:ghost.settings.noModelConfigured.title/)).toBeInTheDocument()
	})

	it("displays no credits message when kilocode profile exists but has no balance", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				provider: undefined,
				model: undefined,
				hasKilocodeProfileWithNoBalance: true,
			},
		})

		expect(screen.getByText(/kilocode:ghost.settings.noCredits.title/)).toBeInTheDocument()
		expect(screen.getByText(/kilocode:ghost.settings.noCredits.description/)).toBeInTheDocument()
		expect(screen.getByText(/kilocode:ghost.settings.noCredits.buyCredits/)).toBeInTheDocument()
	})

	it("displays provider and model info even when hasKilocodeProfileWithNoBalance is true but model is configured", () => {
		renderComponent({
			ghostServiceSettings: {
				...defaultGhostServiceSettings,
				provider: "openrouter",
				model: "openai/gpt-4o-mini",
				hasKilocodeProfileWithNoBalance: true,
			},
		})

		// Should show provider/model info, not the no credits message
		expect(screen.getByText(/openrouter/)).toBeInTheDocument()
		expect(screen.getByText(/openai\/gpt-4o-mini/)).toBeInTheDocument()
		expect(screen.queryByText(/kilocode:ghost.settings.noCredits.title/)).not.toBeInTheDocument()
	})

	describe("snooze status refresh", () => {
		it("updates snooze status when timer fires and snooze expires", () => {
			const now = Date.now()
			vi.setSystemTime(now)

			// Snooze expires in 15 seconds (less than the 30 second refresh interval)
			const snoozeUntil = now + 15_000

			const { rerender } = render(
				<GhostServiceSettingsView
					ghostServiceSettings={{
						...defaultGhostServiceSettings,
						enableAutoTrigger: true,
						snoozeUntil,
					}}
					onGhostServiceSettingsChange={vi.fn()}
				/>,
			)

			// Initially should show snoozed state
			expect(screen.getByText(/kilocode:ghost.settings.snooze.currentlySnoozed/)).toBeInTheDocument()

			// Advance time past the snooze expiration and past the 30 second refresh interval
			act(() => {
				vi.advanceTimersByTime(30_000)
			})

			// Force a rerender to pick up the state change from the interval
			rerender(
				<GhostServiceSettingsView
					ghostServiceSettings={{
						...defaultGhostServiceSettings,
						enableAutoTrigger: true,
						snoozeUntil,
					}}
					onGhostServiceSettingsChange={vi.fn()}
				/>,
			)

			// Now should show the snooze button (not snoozed state)
			expect(screen.getByText(/kilocode:ghost.settings.snooze.button/)).toBeInTheDocument()
			expect(screen.queryByText(/kilocode:ghost.settings.snooze.currentlySnoozed/)).not.toBeInTheDocument()
		})

		it("cleans up interval on unmount", () => {
			const clearIntervalSpy = vi.spyOn(global, "clearInterval")

			const { unmount } = render(
				<GhostServiceSettingsView
					ghostServiceSettings={defaultGhostServiceSettings}
					onGhostServiceSettingsChange={vi.fn()}
				/>,
			)

			unmount()

			expect(clearIntervalSpy).toHaveBeenCalled()
		})
	})
})

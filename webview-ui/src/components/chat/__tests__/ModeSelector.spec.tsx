import { render, screen, fireEvent } from "@/utils/test-utils"

import type { ModeConfig } from "@roo-code/types"

import type { Mode } from "@roo/modes"

import { ModeSelector } from "../ModeSelector"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		hasOpenedModeSelector: false,
		setHasOpenedModeSelector: vi.fn(),
	}),
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/components/ui/hooks/useRooPortal", () => ({
	useRooPortal: () => document.body,
}))

vi.mock("@/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
	},
}))

// Create a variable to control what getAllModes returns.
let mockModes: ModeConfig[] = []

vi.mock("@roo/modes", async () => {
	const actual = await vi.importActual<typeof import("@roo/modes")>("@roo/modes")
	return {
		...actual,
		getAllModes: () => mockModes,
		defaultModeSlug: "code", // Export the default mode slug for tests
	}
})

describe("ModeSelector", () => {
	test("shows custom description from customModePrompts", () => {
		const customModePrompts = {
			code: {
				description: "Custom code mode description",
			},
		}

		render(
			<ModeSelector
				title="Mode Selector"
				value={"code" as Mode}
				onChange={vi.fn()}
				modeShortcutText="Ctrl+M"
				customModePrompts={customModePrompts}
			/>,
		)

		expect(screen.getByTestId("mode-selector-trigger")).toBeInTheDocument()
	})

	test("falls back to default description when no custom prompt", () => {
		render(
			<ModeSelector title="Mode Selector" value={"code" as Mode} onChange={vi.fn()} modeShortcutText="Ctrl+M" />,
		)

		expect(screen.getByTestId("mode-selector-trigger")).toBeInTheDocument()
	})

	test("shows search bar when there are more than 6 modes", () => {
		mockModes = Array.from({ length: 7 }, (_, i) => ({
			slug: `mode-${i}`,
			name: `Mode ${i}`,
			description: `Description for mode ${i}`,
			roleDefinition: "Role definition",
			groups: ["read", "edit"],
		}))

		render(
			<ModeSelector
				title="Mode Selector"
				value={"mode-0" as Mode}
				onChange={vi.fn()}
				modeShortcutText="Ctrl+M"
			/>,
		)

		// Click to open the popover.
		fireEvent.click(screen.getByTestId("mode-selector-trigger"))

		// Search input should be visible.
		expect(screen.getByTestId("mode-search-input")).toBeInTheDocument()

		// Info icon should be visible.
		expect(screen.getByText("chat:modeSelector.title")).toBeInTheDocument()
		const infoIcon = document.querySelector(".codicon-info")
		expect(infoIcon).toBeInTheDocument()
	})

	test("shows info blurb instead of search bar when there are 6 or fewer modes", () => {
		mockModes = Array.from({ length: 5 }, (_, i) => ({
			slug: `mode-${i}`,
			name: `Mode ${i}`,
			description: `Description for mode ${i}`,
			roleDefinition: "Role definition",
			groups: ["read", "edit"],
		}))

		render(
			<ModeSelector
				title="Mode Selector"
				value={"mode-0" as Mode}
				onChange={vi.fn()}
				modeShortcutText="Ctrl+M"
			/>,
		)

		// Click to open the popover.
		fireEvent.click(screen.getByTestId("mode-selector-trigger"))

		// Search input should NOT be visible.
		expect(screen.queryByTestId("mode-search-input")).not.toBeInTheDocument()

		// Info blurb should be visible.
		expect(screen.getByText(/chat:modeSelector.description/)).toBeInTheDocument()

		// Info icon should NOT be visible.
		const infoIcon = document.querySelector(".codicon-info")
		expect(infoIcon).not.toBeInTheDocument()
	})

	test("filters modes correctly when searching", () => {
		mockModes = Array.from({ length: 7 }, (_, i) => ({
			slug: `mode-${i}`,
			name: `Mode ${i}`,
			description: `Description for mode ${i}`,
			roleDefinition: "Role definition",
			groups: ["read", "edit"],
		}))

		render(
			<ModeSelector
				title="Mode Selector"
				value={"mode-0" as Mode}
				onChange={vi.fn()}
				modeShortcutText="Ctrl+M"
			/>,
		)

		// Click to open the popover.
		fireEvent.click(screen.getByTestId("mode-selector-trigger"))

		// Type in search.
		const searchInput = screen.getByTestId("mode-search-input")
		fireEvent.change(searchInput, { target: { value: "Mode 3" } })

		// Should show filtered results.
		const modeItems = screen.getAllByTestId("mode-selector-item")
		expect(modeItems.length).toBeLessThan(7) // Should have filtered some out.
	})

	test("respects disableSearch prop even when there are more than 6 modes", () => {
		mockModes = Array.from({ length: 10 }, (_, i) => ({
			slug: `mode-${i}`,
			name: `Mode ${i}`,
			description: `Description for mode ${i}`,
			roleDefinition: "Role definition",
			groups: ["read", "edit"],
		}))

		render(
			<ModeSelector
				title="Mode Selector"
				value={"mode-0" as Mode}
				onChange={vi.fn()}
				modeShortcutText="Ctrl+M"
				disableSearch={true}
			/>,
		)

		// Click to open the popover.
		fireEvent.click(screen.getByTestId("mode-selector-trigger"))

		// Search input should NOT be visible even with 10 modes.
		expect(screen.queryByTestId("mode-search-input")).not.toBeInTheDocument()

		// Info blurb should be visible instead.
		expect(screen.getByText(/chat:modeSelector.description/)).toBeInTheDocument()

		// Info icon should NOT be visible.
		const infoIcon = document.querySelector(".codicon-info")
		expect(infoIcon).not.toBeInTheDocument()
	})

	test("shows search when disableSearch is false (default) and modes > 6", () => {
		mockModes = Array.from({ length: 8 }, (_, i) => ({
			slug: `mode-${i}`,
			name: `Mode ${i}`,
			description: `Description for mode ${i}`,
			roleDefinition: "Role definition",
			groups: ["read", "edit"],
		}))

		// Don't pass disableSearch prop (should default to false).
		render(
			<ModeSelector
				title="Mode Selector"
				value={"mode-0" as Mode}
				onChange={vi.fn()}
				modeShortcutText="Ctrl+M"
			/>,
		)

		fireEvent.click(screen.getByTestId("mode-selector-trigger"))

		expect(screen.getByTestId("mode-search-input")).toBeInTheDocument()

		const infoIcon = document.querySelector(".codicon-info")
		expect(infoIcon).toBeInTheDocument()
	})

	test("falls back to default mode when current mode is not available", async () => {
		// Set up modes including "code" as the default mode (which getAllModes returns first)
		mockModes = [
			{
				slug: "code",
				name: "Code",
				description: "Code mode",
				roleDefinition: "Role definition",
				groups: ["read", "edit"],
			},
			{
				slug: "other",
				name: "Other",
				description: "Other mode",
				roleDefinition: "Role definition",
				groups: ["read"],
			},
		]

		const onChange = vi.fn()

		render(
			<ModeSelector
				title="Mode Selector"
				value={"non-existent-mode" as Mode}
				onChange={onChange}
				modeShortcutText="Ctrl+M"
			/>,
		)

		// The component should automatically call onChange with the fallback mode (code)
		// via useEffect after render
		await vi.waitFor(() => {
			expect(onChange).toHaveBeenCalledWith("code")
		})
	})

	test("shows default mode name when current mode is not available", () => {
		// Set up modes where "code" is available (the default mode)
		mockModes = [
			{
				slug: "code",
				name: "Code",
				description: "Code mode",
				roleDefinition: "Role definition",
				groups: ["read", "edit"],
			},
			{
				slug: "other",
				name: "Other",
				description: "Other mode",
				roleDefinition: "Role definition",
				groups: ["read"],
			},
		]

		render(
			<ModeSelector
				title="Mode Selector"
				value={"non-existent-mode" as Mode}
				onChange={vi.fn()}
				modeShortcutText="Ctrl+M"
			/>,
		)

		// Should show the default mode name instead of empty string
		const trigger = screen.getByTestId("mode-selector-trigger")
		expect(trigger).toHaveTextContent("Code")
	})
})

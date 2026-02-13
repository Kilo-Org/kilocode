import React from "react"
import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import { ContextManagementSettings } from "../ContextManagementSettings"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/components/ui", () => ({
	Slider: ({ value, onValueChange, "data-testid": dataTestId, disabled, min, max, step }: any) => (
		<input
			type="range"
			value={value?.[0] ?? 0}
			min={min}
			max={max}
			step={step ?? 1}
			onChange={(e) => onValueChange([parseFloat(e.target.value)])}
			data-testid={dataTestId}
			disabled={disabled}
		/>
	),
	Input: ({ value, onChange, "data-testid": dataTestId, disabled, ...props }: any) => (
		<input value={value} onChange={onChange} data-testid={dataTestId} disabled={disabled} {...props} />
	),
	Button: ({ children, onClick, disabled, ...props }: any) => (
		<button onClick={onClick} disabled={disabled} {...props}>
			{children}
		</button>
	),
	Select: ({ value, onValueChange, disabled, "data-testid": dataTestId }: any) => (
		<select
			role="combobox"
			value={value}
			onChange={(e) => onValueChange?.(e.target.value)}
			disabled={disabled}
			data-testid={dataTestId}>
			<option value="percent">percent</option>
			<option value="tokens">tokens</option>
		</select>
	),
	SelectTrigger: ({ children }: any) => <>{children}</>,
	SelectValue: () => null,
	SelectContent: ({ children }: any) => <>{children}</>,
	SelectItem: () => null,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, onChange, children, "data-testid": dataTestId, ...props }: any) => (
		<label data-testid={dataTestId} {...props}>
			<input
				type="checkbox"
				checked={checked || false}
				onChange={(e: any) => onChange?.({ target: { checked: e.target.checked } })}
			/>
			{children}
		</label>
	),
}))

type ProfileCondenseOverrideValue = {
	enabled: boolean
	mode: "percent" | "tokens"
	percent: number
	tokens: number
}

const CURRENT_PROFILE_ID = "profile-default"

const createProps = (overrides: Partial<React.ComponentProps<typeof ContextManagementSettings>> = {}) => ({
	autoCondenseContext: true,
	autoCondenseContextPercent: 80,
	maxOpenTabsContext: 20,
	maxWorkspaceFiles: 200,
	showRooIgnoredFiles: false,
	enableSubfolderRules: false,
	maxReadFileLine: 500,
	maxImageFileSize: 5,
	maxTotalImageSize: 20,
	maxConcurrentFileReads: 5,
	allowVeryLargeReads: false,
	profileCondenseOverrides: {} as Record<string, ProfileCondenseOverrideValue>,
	currentProfileName: "Default",
	currentProfileId: CURRENT_PROFILE_ID,
	condenseEffectiveBudgetTokens: 10_000,
	includeDiagnosticMessages: true,
	maxDiagnosticMessages: 50,
	writeDelayMs: 1000,
	includeCurrentTime: true,
	includeCurrentCost: true,
	maxGitStatusFiles: 0,
	setCachedStateField: vi.fn(),
	...overrides,
})

const renderWithState = (overrides: Partial<React.ComponentProps<typeof ContextManagementSettings>> = {}) => {
	const setCachedStateFieldSpy = vi.fn()

	const Stateful = () => {
		const [profileCondenseOverrides, setProfileCondenseOverrides] = React.useState<
			Record<string, ProfileCondenseOverrideValue>
		>((overrides.profileCondenseOverrides as Record<string, ProfileCondenseOverrideValue>) ?? {})

		const mergedProps = createProps({
			...overrides,
			profileCondenseOverrides,
			setCachedStateField: ((field: string, value: unknown) => {
				setCachedStateFieldSpy(field, value)
				if (field === "profileCondenseOverrides") {
					setProfileCondenseOverrides(value as Record<string, ProfileCondenseOverrideValue>)
				}
			}) as any,
		})

		return <ContextManagementSettings {...mergedProps} />
	}

	render(<Stateful />)

	return { setCachedStateFieldSpy }
}

describe("ContextManagementSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("hides condensing threshold controls when auto-condense is disabled", () => {
		render(<ContextManagementSettings {...createProps({ autoCondenseContext: false })} />)

		expect(screen.queryByTestId("condense-threshold-slider")).not.toBeInTheDocument()
	})

	it("disables current-profile override controls when override is off", () => {
		render(<ContextManagementSettings {...createProps()} />)

		expect(screen.getByTestId("condense-current-profile-override-checkbox").querySelector("input")).not.toBeChecked()
		expect(screen.getByTestId("condense-threshold-mode-select")).toBeDisabled()
		expect(screen.getByTestId("condense-profile-percent-slider")).toBeDisabled()
	})

	it("enables override and updates profile override state in percent mode", async () => {
		const { setCachedStateFieldSpy } = renderWithState()

		fireEvent.click(screen.getByTestId("condense-current-profile-override-checkbox"))

		await waitFor(() => {
			expect(setCachedStateFieldSpy).toHaveBeenCalledWith(
				"profileCondenseOverrides",
				expect.objectContaining({
					[CURRENT_PROFILE_ID]: expect.objectContaining({
						enabled: true,
						mode: "percent",
					}),
				}),
			)
		})

		expect(screen.getByTestId("condense-threshold-mode-select")).not.toBeDisabled()
		expect(screen.getByTestId("condense-profile-percent-slider")).not.toBeDisabled()
		expect(
			screen.getByText("settings:contextManagement.condensingThreshold.percentEquivalent"),
		).toBeInTheDocument()
	})

	it("supports token mode and clamps typed token value to effective budget", async () => {
		const { setCachedStateFieldSpy } = renderWithState({
			profileCondenseOverrides: {
				[CURRENT_PROFILE_ID]: {
					enabled: true,
					mode: "percent",
					percent: 70,
					tokens: 7000,
				},
			},
			condenseEffectiveBudgetTokens: 5000,
		})

		fireEvent.change(screen.getByTestId("condense-threshold-mode-select"), {
			target: { value: "tokens" },
		})

		await waitFor(() => {
			expect(setCachedStateFieldSpy).toHaveBeenCalledWith(
				"profileCondenseOverrides",
				expect.objectContaining({
					[CURRENT_PROFILE_ID]: expect.objectContaining({
						mode: "tokens",
					}),
				}),
			)
		})

		const tokenInput = await screen.findByTestId("condense-profile-token-input")
		fireEvent.change(tokenInput, { target: { value: "9000" } })

		await waitFor(() => {
			expect(setCachedStateFieldSpy).toHaveBeenCalledWith(
				"profileCondenseOverrides",
				expect.objectContaining({
					[CURRENT_PROFILE_ID]: expect.objectContaining({
						mode: "tokens",
						tokens: 5000,
					}),
				}),
			)
		})
	})

	it("auto-clamps saved token override on model cap reduction and shows inline notice", async () => {
		const setCachedStateField = vi.fn()
		const initial = createProps({
			profileCondenseOverrides: {
				[CURRENT_PROFILE_ID]: {
					enabled: true,
					mode: "tokens",
					percent: 80,
					tokens: 9000,
				},
			},
			condenseEffectiveBudgetTokens: 9000,
			setCachedStateField,
		})

		const { rerender } = render(<ContextManagementSettings {...initial} />)

		rerender(
			<ContextManagementSettings
				{...initial}
				condenseEffectiveBudgetTokens={5000}
				setCachedStateField={setCachedStateField}
			/>,
		)

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith(
				"profileCondenseOverrides",
				expect.objectContaining({
					[CURRENT_PROFILE_ID]: expect.objectContaining({
						tokens: 5000,
					}),
				}),
			)
		})

		expect(screen.getByTestId("condense-token-clamp-notice")).toBeInTheDocument()
	})

	it("does not render legacy profile selector inside condense threshold section", () => {
		render(<ContextManagementSettings {...createProps()} />)

		expect(
			screen.queryByText("settings:contextManagement.condensingThreshold.selectProfileLabel"),
		).not.toBeInTheDocument()
	})

	it("still updates global percent slider independently of profile override", async () => {
		const setCachedStateField = vi.fn()
		render(<ContextManagementSettings {...createProps({ setCachedStateField })} />)

		fireEvent.change(screen.getByTestId("condense-threshold-slider"), { target: { value: "65" } })

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoCondenseContextPercent", 65)
		})
	})

	it("keeps diagnostic include toggle behavior unchanged", async () => {
		const setCachedStateField = vi.fn()
		render(
			<ContextManagementSettings
				{...createProps({
					includeDiagnosticMessages: true,
					setCachedStateField,
				})}
			/>,
		)

		fireEvent.click(screen.getByTestId("include-diagnostic-messages-checkbox"))

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("includeDiagnosticMessages", false)
		})
	})

	it("keeps diagnostic max slider unlimited mapping unchanged", async () => {
		const setCachedStateField = vi.fn()
		render(<ContextManagementSettings {...createProps({ setCachedStateField })} />)

		fireEvent.change(screen.getByTestId("max-diagnostic-messages-slider"), { target: { value: "100" } })

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("maxDiagnosticMessages", -1)
		})
	})

	it("keeps max-read-file controls behavior unchanged", async () => {
		const setCachedStateField = vi.fn()
		render(<ContextManagementSettings {...createProps({ maxReadFileLine: 500, setCachedStateField })} />)

		fireEvent.change(screen.getByTestId("max-read-file-line-input"), { target: { value: "1000" } })
		fireEvent.click(screen.getByTestId("max-read-file-always-full-checkbox"))

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("maxReadFileLine", 1000)
		})

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("maxReadFileLine", -1)
		})
	})
})

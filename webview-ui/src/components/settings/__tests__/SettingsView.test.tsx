import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { vscode } from "@/utils/vscode"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

import SettingsView from "../SettingsView"

// Mock vscode API
jest.mock("@src/utils/vscode", () => ({ vscode: { postMessage: jest.fn() } }))

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn()

// kilocode_change start
// Mock the validate functions to prevent validation errors
jest.mock("@src/utils/validate", () => ({
	validateApiConfiguration: jest.fn().mockReturnValue(undefined),
	validateModelId: jest.fn().mockReturnValue(undefined),
}))
// kilocode_change end

// Mock all lucide-react icons with a proxy to handle any icon requested
jest.mock("lucide-react", () => {
	return new Proxy(
		{},
		{
			get: function (_obj, prop) {
				// Return a component factory for any icon that's requested
				if (prop === "__esModule") {
					return true
				}
				return () => <div data-testid={`${String(prop)}-icon`}>{String(prop)}</div>
			},
		},
	)
})

// Mock ApiConfigManager component
jest.mock("../ApiConfigManager", () => ({
	__esModule: true,
	default: ({ currentApiConfigName }: any) => (
		<div data-testid="api-config-management">
			<span>Current config: {currentApiConfigName}</span>
		</div>
	),
}))

// Mock ApiOptions component with the checkbox
jest.mock("../ApiOptions", () => {
	const React = jest.requireActual("react")
	const originalModule = jest.requireActual("@src/context/ExtensionStateContext")
	const { VSCodeCheckbox } = jest.requireMock("@vscode/webview-ui-toolkit/react")

	return {
		__esModule: true,
		default: function ApiOptions({
			apiConfiguration: _apiConfiguration,
			setApiConfigurationField: _setApiConfigurationField,
		}: any) {
			const { useSameProviderForAllModes } = originalModule.useExtensionState()

			const handleChange = () => {
				jest.requireMock("@src/utils/vscode").vscode.postMessage({ type: "toggleUseSameProviderForAllModes" })
			}

			return (
				<div data-testid="api-options">
					<div>API Provider Options</div>
					<VSCodeCheckbox
						checked={!!useSameProviderForAllModes}
						onChange={handleChange}
						data-testid="use-same-provider-for-all-modes-checkbox">
						Use same provider for all modes
					</VSCodeCheckbox>
				</div>
			)
		},
	}
})

// Mock VSCode components
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick, appearance, "data-testid": dataTestId }: any) =>
		appearance === "icon" ? (
			<button
				onClick={onClick}
				className="codicon codicon-close"
				aria-label="Remove command"
				data-testid={dataTestId}>
				<span className="codicon codicon-close" />
			</button>
		) : (
			<button onClick={onClick} data-appearance={appearance} data-testid={dataTestId}>
				{children}
			</button>
		),
	VSCodeCheckbox: ({ children, onChange, onClick, checked, "data-testid": dataTestId }: any) => {
		const [isChecked, setIsChecked] = React.useState(checked)
		React.useEffect(() => {
			setIsChecked(checked)
		}, [checked])

		const handleChange = (e: any) => {
			setIsChecked(e.target.checked)
			if (onChange) {
				onChange(e)
			}
		}

		const handleClick = () => {
			if (onClick) {
				onClick()
			}
		}

		return (
			<label onClick={handleClick}>
				<input
					type="checkbox"
					checked={isChecked}
					onChange={handleChange}
					aria-label={typeof children === "string" ? children : undefined}
					data-testid={dataTestId}
				/>
				{children}
			</label>
		)
	},
	VSCodeTextField: ({ value, onInput, placeholder, "data-testid": dataTestId }: any) => (
		<input
			type="text"
			value={value}
			onChange={(e) => onInput({ target: { value: e.target.value } })}
			placeholder={placeholder}
			data-testid={dataTestId}
		/>
	),
	VSCodeLink: ({ children, href }: any) => <a href={href || "#"}>{children}</a>,
	VSCodeRadio: ({ value, checked, onChange }: any) => (
		<input type="radio" value={value} checked={checked} onChange={onChange} />
	),
	VSCodeRadioGroup: ({ children, onChange }: any) => <div onChange={onChange}>{children}</div>,
}))

// Mock Tab components
jest.mock("../../../components/common/Tab", () => ({
	...jest.requireActual("../../../components/common/Tab"),
	Tab: ({ children }: any) => <div data-testid="tab-container">{children}</div>,
	TabHeader: ({ children }: any) => <div data-testid="tab-header">{children}</div>,
	TabContent: ({ children }: any) => <div data-testid="tab-content">{children}</div>,
	TabList: ({ children, value, onValueChange, "data-testid": dataTestId }: any) => {
		// Store onValueChange in a global variable so TabTrigger can access it
		;(window as any).__onValueChange = onValueChange
		return (
			<div data-testid={dataTestId} data-value={value}>
				{children}
			</div>
		)
	},
	TabTrigger: React.forwardRef(
		({ children, value, "data-testid": dataTestId, onClick, isSelected }: any, ref: any) => {
			// This function simulates clicking on a tab and making its content visible
			const handleClick = () => {
				if (onClick) onClick()
				// Access onValueChange from the global variable
				const onValueChange = (window as any).__onValueChange
				if (onValueChange) onValueChange(value)
				// Make all tab contents invisible
				document.querySelectorAll("[data-tab-content]").forEach((el) => {
					;(el as HTMLElement).style.display = "none"
				})
				// Make this tab's content visible
				const tabContent = document.querySelector(`[data-tab-content="${value}"]`)
				if (tabContent) {
					;(tabContent as HTMLElement).style.display = "block"
				}
			}

			return (
				<button
					ref={ref}
					data-testid={dataTestId}
					data-value={value}
					data-selected={isSelected}
					onClick={handleClick}>
					{children}
				</button>
			)
		},
	),
}))

// Mock Slider component
jest.mock("@/components/ui", () => ({
	...jest.requireActual("@/components/ui"),
	Slider: ({ value, onValueChange, "data-testid": dataTestId }: any) => (
		<input
			type="range"
			value={value[0]}
			onChange={(e) => onValueChange([parseFloat(e.target.value)])}
			data-testid={dataTestId}
		/>
	),
	DropdownMenu: ({ children }: any) => <div data-testid="dropdown-menu">{children}</div>,
	DropdownMenuTrigger: ({ children }: any) => <div data-testid="dropdown-menu-trigger">{children}</div>,
	DropdownMenuContent: ({ children }: any) => <div data-testid="dropdown-menu-content">{children}</div>,
	DropdownMenuItem: ({ children, onClick }: any) => (
		<div data-testid="dropdown-menu-item" onClick={onClick}>
			{children}
		</div>
	),
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: any) => {
	window.postMessage(
		{
			type: "state",
			state: {
				version: "1.0.0",
				clineMessages: [],
				taskHistory: [],
				shouldShowAnnouncement: false,
				allowedCommands: [],
				alwaysAllowExecute: false,
				ttsEnabled: false,
				ttsSpeed: 1,
				soundEnabled: false,
				soundVolume: 0.5,
				...state,
			},
		},
		"*",
	)
}

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

global.ResizeObserver = MockResizeObserver

const renderSettingsView = (initialState = {}) => {
	const onDone = jest.fn()
	const queryClient = new QueryClient()

	const result = render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<SettingsView onDone={onDone} />
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)

	// Hydrate initial state.
	mockPostMessage(initialState)

	// Helper function to activate a tab and ensure its content is visible
	const activateTab = (tabId: string) => {
		const tab = screen.getByTestId(`tab-${tabId}`)
		fireEvent.click(tab)
	}

	return {
		onDone,
		activateTab,
		result,
		rerender: (newState: any) => {
			result.rerender(
				<ExtensionStateContextProvider>
					<QueryClientProvider client={queryClient}>
						<SettingsView onDone={onDone} />
					</QueryClientProvider>
				</ExtensionStateContextProvider>,
			)
			mockPostMessage(newState)
		},
	}
}

describe("SettingsView - Sound Settings", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("initializes with tts disabled by default", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const ttsCheckbox = screen.getByTestId("tts-enabled-checkbox")
		expect(ttsCheckbox).not.toBeChecked()

		// Speed slider should not be visible when tts is disabled
		expect(screen.queryByTestId("tts-speed-slider")).not.toBeInTheDocument()
	})

	it("initializes with sound disabled by default", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const soundCheckbox = screen.getByTestId("sound-enabled-checkbox")
		expect(soundCheckbox).not.toBeChecked()

		// Volume slider should not be visible when sound is disabled
		expect(screen.queryByTestId("sound-volume-slider")).not.toBeInTheDocument()
	})

	it("toggles tts setting and sends message to VSCode", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const ttsCheckbox = screen.getByTestId("tts-enabled-checkbox")

		// Enable tts
		fireEvent.click(ttsCheckbox)
		expect(ttsCheckbox).toBeChecked()

		// Click Save to save settings
		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "ttsEnabled",
				bool: true,
			}),
		)
	})

	it("toggles sound setting and sends message to VSCode", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const soundCheckbox = screen.getByTestId("sound-enabled-checkbox")

		// Enable sound
		fireEvent.click(soundCheckbox)
		expect(soundCheckbox).toBeChecked()

		// Click Save to save settings
		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "soundEnabled",
				bool: true,
			}),
		)
	})

	it("shows tts slider when sound is enabled", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		// Enable tts
		const ttsCheckbox = screen.getByTestId("tts-enabled-checkbox")
		fireEvent.click(ttsCheckbox)

		// Speed slider should be visible
		const speedSlider = screen.getByTestId("tts-speed-slider")
		expect(speedSlider).toBeInTheDocument()
		expect(speedSlider).toHaveValue("1")
	})

	it("shows volume slider when sound is enabled", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		// Enable sound
		const soundCheckbox = screen.getByTestId("sound-enabled-checkbox")
		fireEvent.click(soundCheckbox)

		// Volume slider should be visible
		const volumeSlider = screen.getByTestId("sound-volume-slider")
		expect(volumeSlider).toBeInTheDocument()
		expect(volumeSlider).toHaveValue("0.5")
	})

	it("updates speed and sends message to VSCode when slider changes", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		// Enable tts
		const ttsCheckbox = screen.getByTestId("tts-enabled-checkbox")
		fireEvent.click(ttsCheckbox)

		// Change speed
		const speedSlider = screen.getByTestId("tts-speed-slider")
		fireEvent.change(speedSlider, { target: { value: "0.75" } })

		// Click Save to save settings
		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		// Verify message sent to VSCode
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "ttsSpeed",
			value: 0.75,
		})
	})

	it("updates volume and sends message to VSCode when slider changes", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		// Enable sound
		const soundCheckbox = screen.getByTestId("sound-enabled-checkbox")
		fireEvent.click(soundCheckbox)

		// Change volume
		const volumeSlider = screen.getByTestId("sound-volume-slider")
		fireEvent.change(volumeSlider, { target: { value: "0.75" } })

		// Click Save to save settings - use getAllByTestId to handle multiple elements
		const saveButtons = screen.getAllByTestId("save-button")
		fireEvent.click(saveButtons[0])

		// Verify message sent to VSCode
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "soundVolume",
			value: 0.75,
		})
	})
})

describe("SettingsView - API Configuration", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders ApiConfigManagement with correct props", () => {
		renderSettingsView()

		expect(screen.getByTestId("api-config-management")).toBeInTheDocument()
	})
})

describe("SettingsView - Allowed Commands", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("shows allowed commands section when alwaysAllowExecute is enabled", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		// Enable always allow execute
		const executeCheckbox = screen.getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)
		// Verify allowed commands section appears
		expect(screen.getByTestId("allowed-commands-heading")).toBeInTheDocument()
		expect(screen.getByTestId("command-input")).toBeInTheDocument()
	})

	it("adds new command to the list", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		// Enable always allow execute
		const executeCheckbox = screen.getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)

		// Add a new command
		const input = screen.getByTestId("command-input")
		fireEvent.change(input, { target: { value: "npm test" } })

		const addButton = screen.getByTestId("add-command-button")
		fireEvent.click(addButton)

		// Verify command was added
		expect(screen.getByText("npm test")).toBeInTheDocument()

		// Verify VSCode message was sent
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "allowedCommands",
			commands: ["npm test"],
		})
	})

	it("removes command from the list", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		// Enable always allow execute
		const executeCheckbox = screen.getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)

		// Add a command
		const input = screen.getByTestId("command-input")
		fireEvent.change(input, { target: { value: "npm test" } })
		const addButton = screen.getByTestId("add-command-button")
		fireEvent.click(addButton)

		// Remove the command
		const removeButton = screen.getByTestId("remove-command-0")
		fireEvent.click(removeButton)

		// Verify command was removed
		expect(screen.queryByText("npm test")).not.toBeInTheDocument()

		// Verify VSCode message was sent
		expect(vscode.postMessage).toHaveBeenLastCalledWith({
			type: "allowedCommands",
			commands: [],
		})
	})

	describe("SettingsView - Tab Navigation", () => {
		beforeEach(() => {
			jest.clearAllMocks()
		})

		it("renders with providers tab active by default", () => {
			renderSettingsView()

			// Check that the tab list is rendered
			const tabList = screen.getByTestId("settings-tab-list")
			expect(tabList).toBeInTheDocument()

			// Check that providers content is visible
			expect(screen.getByTestId("api-config-management")).toBeInTheDocument()
		})

		it("shows unsaved changes dialog when clicking Done with unsaved changes", () => {
			// Render once and get the activateTab helper
			const { activateTab } = renderSettingsView()

			// Activate the notifications tab
			activateTab("notifications")

			// Make a change to create unsaved changes
			const soundCheckbox = screen.getByTestId("sound-enabled-checkbox")
			fireEvent.click(soundCheckbox)

			// Click the Done button
			const doneButton = screen.getByText("settings:common.done")
			fireEvent.click(doneButton)

			// Check that unsaved changes dialog is shown
			expect(screen.getByText("settings:unsavedChangesDialog.title")).toBeInTheDocument()
		})

		it("renders with targetSection prop", () => {
			// Render with a specific target section
			render(
				<ExtensionStateContextProvider>
					<QueryClientProvider client={new QueryClient()}>
						<SettingsView onDone={jest.fn()} targetSection="browser" />
					</QueryClientProvider>
				</ExtensionStateContextProvider>,
			)

			// Hydrate initial state
			mockPostMessage({})

			// Verify browser-related content is visible and API config is not
			expect(screen.queryByTestId("api-config-management")).not.toBeInTheDocument()
		})

		it("shows unsaved changes dialog when switching tabs and clicking Done", () => {
			// Render once and get the activateTab helper
			const { activateTab } = renderSettingsView()

			// Activate the notifications tab and make a change
			activateTab("notifications")
			const soundCheckbox = screen.getByTestId("sound-enabled-checkbox")
			fireEvent.click(soundCheckbox)

			// Switch to another tab
			activateTab("autoApprove")

			// Click the Done button
			const doneButton = screen.getByText("settings:common.done")
			fireEvent.click(doneButton)

			// Check that unsaved changes dialog is shown
			expect(screen.getByText("settings:unsavedChangesDialog.title")).toBeInTheDocument()
		})

		it("calls onDone directly when no changes are made", () => {
			const { onDone } = renderSettingsView()
			const doneButton = screen.getByText("settings:common.done")
			fireEvent.click(doneButton)
			expect(onDone).toHaveBeenCalled()
		})

		it("disables Save button when no changes are made", () => {
			renderSettingsView()
			const saveButton = screen.getByTestId("save-button")
			expect(saveButton).toBeDisabled()
		})
	})
})

describe("SettingsView - Use Same Provider For All Modes", () => {
	it("should toggle the setting and update state", async () => {
		const { activateTab } = renderSettingsView({
			useSameProviderForAllModes: false,
		})

		// The checkbox is in the providers tab, so we need to make sure it's active
		activateTab("providers")

		const checkbox = screen.getByTestId("use-same-provider-for-all-modes-checkbox")
		expect(checkbox).not.toBeChecked()

		// Click the checkbox
		fireEvent.click(checkbox)

		// Verify the message was sent
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "toggleUseSameProviderForAllModes",
		})

		// Simulate the backend responding with updated state
		// This is what would happen in the real app after the backend processes the toggle
		mockPostMessage({
			useSameProviderForAllModes: true,
		})

		// Wait for the state to update
		await screen.findByTestId("use-same-provider-for-all-modes-checkbox")

		// The checkbox should now be checked
		const updatedCheckbox = screen.getByTestId("use-same-provider-for-all-modes-checkbox")
		expect(updatedCheckbox).toBeChecked()
	})
})

describe("SettingsView - Duplicate Commands", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("prevents duplicate commands", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		// Enable always allow execute
		const executeCheckbox = screen.getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)

		// Add a command twice
		const input = screen.getByTestId("command-input")
		const addButton = screen.getByTestId("add-command-button")

		// First addition
		fireEvent.change(input, { target: { value: "npm test" } })
		fireEvent.click(addButton)

		// Second addition attempt
		fireEvent.change(input, { target: { value: "npm test" } })
		fireEvent.click(addButton)

		// Verify command appears only once
		const commands = screen.getAllByText("npm test")
		expect(commands).toHaveLength(1)
	})

	it("saves allowed commands when clicking Save", () => {
		// Render once and get the activateTab helper
		const { activateTab } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		// Enable always allow execute
		const executeCheckbox = screen.getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)

		// Add a command
		const input = screen.getByTestId("command-input")
		fireEvent.change(input, { target: { value: "npm test" } })
		const addButton = screen.getByTestId("add-command-button")
		fireEvent.click(addButton)

		// Click Save - use getAllByTestId to handle multiple elements
		const saveButtons = screen.getAllByTestId("save-button")
		fireEvent.click(saveButtons[0])

		// Verify VSCode messages were sent
		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "allowedCommands",
				commands: ["npm test"],
			}),
		)
	})
})

describe("SettingsView - General", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders correctly with default state", () => {
		renderSettingsView()
		expect(screen.getByTestId("settings-tab-list")).toBeInTheDocument()
		// Check that the default tab (providers) is active.
		expect(screen.getByTestId("api-config-management")).toBeInTheDocument()
	})
})

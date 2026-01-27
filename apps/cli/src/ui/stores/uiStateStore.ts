import { create } from "zustand"
import type { AutocompletePickerState } from "../components/autocomplete/types.js"

/**
 * UI-specific state that doesn't need to persist across task switches.
 * This separates UI state from task/message state in the main CLI store.
 */
interface UIState {
	// Exit handling state
	showExitHint: boolean
	pendingExit: boolean

	// Countdown timer for auto-accepting followup questions
	countdownSeconds: number | null

	// Custom input mode for followup questions
	showCustomInput: boolean
	isTransitioningToCustomInput: boolean

	// Focus management for scroll area vs input
	manualFocus: "scroll" | "input" | null

	// TODO viewer overlay
	showTodoViewer: boolean

	// Autocomplete picker state
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pickerState: AutocompletePickerState<any>
}

interface UIActions {
	// Exit handling actions
	setShowExitHint: (show: boolean) => void
	setPendingExit: (pending: boolean) => void

	// Countdown timer actions
	setCountdownSeconds: (seconds: number | null) => void

	// Custom input mode actions
	setShowCustomInput: (show: boolean) => void
	setIsTransitioningToCustomInput: (transitioning: boolean) => void

	// Focus management actions
	setManualFocus: (focus: "scroll" | "input" | null) => void

	// TODO viewer actions
	setShowTodoViewer: (show: boolean) => void

	// Picker state actions
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	setPickerState: (state: AutocompletePickerState<any>) => void

	// Reset all UI state to defaults
	resetUIState: () => void
}

const initialState: UIState = {
	showExitHint: false,
	pendingExit: false,
	countdownSeconds: null,
	showCustomInput: false,
	isTransitioningToCustomInput: false,
	manualFocus: null,
	showTodoViewer: false,
	pickerState: {
		activeTrigger: null,
		results: [],
		selectedIndex: 0,
		isOpen: false,
		isLoading: false,
		triggerInfo: null,
	},
}

export const useUIStateStore = create<UIState & UIActions>((set) => ({
	...initialState,

	setShowExitHint: (show) => set({ showExitHint: show }),
	setPendingExit: (pending) => set({ pendingExit: pending }),
	setCountdownSeconds: (seconds) => set({ countdownSeconds: seconds }),
	setShowCustomInput: (show) => set({ showCustomInput: show }),
	setIsTransitioningToCustomInput: (transitioning) => set({ isTransitioningToCustomInput: transitioning }),
	setManualFocus: (focus) => set({ manualFocus: focus }),
	setShowTodoViewer: (show) => set({ showTodoViewer: show }),
	setPickerState: (state) => set({ pickerState: state }),
	resetUIState: () => set(initialState),
}))

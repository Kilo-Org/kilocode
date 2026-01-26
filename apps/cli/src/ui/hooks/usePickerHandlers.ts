import { useCallback } from "react"
import type { WebviewMessage } from "@roo-code/types"

import type {
	AutocompletePickerState,
	AutocompleteInputHandle,
	ModeResult,
	HistoryResult,
} from "../components/autocomplete/index.js"
import { useCLIStore } from "../store.js"
import { useUIStateStore } from "../stores/uiStateStore.js"

export interface UsePickerHandlersOptions {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	autocompleteRef: React.RefObject<AutocompleteInputHandle<any>>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	followupAutocompleteRef: React.RefObject<AutocompleteInputHandle<any>>
	sendToExtension: ((msg: WebviewMessage) => void) | null
	showInfo: (msg: string, duration?: number) => void
	seenMessageIds: React.MutableRefObject<Set<string>>
	firstTextMessageSkipped: React.MutableRefObject<boolean>
}

export interface UsePickerHandlersReturn {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	handlePickerStateChange: (state: AutocompletePickerState<any>) => void
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	handlePickerSelect: (item: any) => void
	handlePickerClose: () => void
	handlePickerIndexChange: (index: number) => void
}

/**
 * Hook to handle autocomplete picker interactions.
 *
 * Responsibilities:
 * - Handle picker state changes from AutocompleteInput
 * - Handle item selection (special handling for modes and history items)
 * - Handle mode switching via picker
 * - Handle task switching via history picker
 * - Handle picker close and index change
 */
export function usePickerHandlers({
	autocompleteRef,
	followupAutocompleteRef,
	sendToExtension,
	showInfo,
	seenMessageIds,
	firstTextMessageSkipped,
}: UsePickerHandlersOptions): UsePickerHandlersReturn {
	const { isLoading, currentTaskId, setCurrentTaskId } = useCLIStore()
	const { pickerState, setPickerState } = useUIStateStore()

	/**
	 * Handle picker state changes from AutocompleteInput
	 */
	const handlePickerStateChange = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(state: AutocompletePickerState<any>) => {
			setPickerState(state)
		},
		[setPickerState],
	)

	/**
	 * Handle item selection from external PickerSelect
	 */
	const handlePickerSelect = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(item: any) => {
			// Check if this is a mode selection.
			if (pickerState.activeTrigger?.id === "mode" && item && typeof item === "object" && "slug" in item) {
				const modeItem = item as ModeResult

				if (sendToExtension) {
					sendToExtension({ type: "mode", text: modeItem.slug })
				}

				autocompleteRef.current?.closePicker()
				followupAutocompleteRef.current?.closePicker()
			}
			// Check if this is a history item selection.
			else if (pickerState.activeTrigger?.id === "history" && item && typeof item === "object" && "id" in item) {
				const historyItem = item as HistoryResult

				// Don't allow task switching while a task is in progress (loading).
				if (isLoading) {
					showInfo("Cannot switch tasks while task is in progress", 2000)
					autocompleteRef.current?.closePicker()
					followupAutocompleteRef.current?.closePicker()
					return
				}

				// If selecting the same task that's already loaded, just close the picker.
				if (historyItem.id === currentTaskId) {
					autocompleteRef.current?.closePicker()
					followupAutocompleteRef.current?.closePicker()
					return
				}

				// Send showTaskWithId message to extension to resume the task
				if (sendToExtension) {
					// Use selective reset that preserves global state (taskHistory, modes, commands)
					useCLIStore.getState().resetForTaskSwitch()
					// Set the resuming flag so message handlers know we're resuming
					// This prevents skipping the first text message (which is historical)
					useCLIStore.getState().setIsResumingTask(true)
					// Track which task we're switching to
					setCurrentTaskId(historyItem.id)
					// Reset refs to avoid stale state across task switches
					seenMessageIds.current.clear()
					firstTextMessageSkipped.current = false

					// Send message to resume the selected task
					// This triggers createTaskWithHistoryItem -> postStateToWebview
					// which includes clineMessages and handles mode restoration
					sendToExtension({ type: "showTaskWithId", text: historyItem.id })
				}

				// Close the picker
				autocompleteRef.current?.closePicker()
				followupAutocompleteRef.current?.closePicker()
			} else {
				// Handle other item selections normally
				autocompleteRef.current?.handleItemSelect(item)
				followupAutocompleteRef.current?.handleItemSelect(item)
			}
		},
		[
			pickerState.activeTrigger,
			isLoading,
			showInfo,
			currentTaskId,
			setCurrentTaskId,
			sendToExtension,
			autocompleteRef,
			followupAutocompleteRef,
			seenMessageIds,
			firstTextMessageSkipped,
		],
	)

	/**
	 * Handle picker close from external PickerSelect
	 */
	const handlePickerClose = useCallback(() => {
		autocompleteRef.current?.closePicker()
		followupAutocompleteRef.current?.closePicker()
	}, [autocompleteRef, followupAutocompleteRef])

	/**
	 * Handle picker index change from external PickerSelect
	 */
	const handlePickerIndexChange = useCallback(
		(index: number) => {
			autocompleteRef.current?.handleIndexChange(index)
			followupAutocompleteRef.current?.handleIndexChange(index)
		},
		[autocompleteRef, followupAutocompleteRef],
	)

	return {
		handlePickerStateChange,
		handlePickerSelect,
		handlePickerClose,
		handlePickerIndexChange,
	}
}

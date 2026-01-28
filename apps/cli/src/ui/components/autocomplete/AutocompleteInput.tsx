import { useInput } from "ink"
import { useState, useCallback, useEffect, useImperativeHandle, forwardRef, useRef, type Ref } from "react"

import { useInputHistory } from "../../hooks/useInputHistory.js"
import { useTerminalSize } from "../../hooks/TerminalSizeContext.js"
import { MultilineTextInput } from "../MultilineTextInput.js"

import type { AutocompleteItem, AutocompleteTrigger, AutocompletePickerState } from "./types.js"
import { useAutocompletePicker } from "./useAutocompletePicker.js"

export interface AutocompleteInputProps<T extends AutocompleteItem = AutocompleteItem> {
	/** Placeholder text when input is empty */
	placeholder?: string
	/** Called when user submits text (Enter without picker open) */
	onSubmit: (value: string) => void
	/** Whether the input is active/focused */
	isActive?: boolean
	/** Array of autocomplete triggers to enable */
	triggers: AutocompleteTrigger<T>[]
	/** Called when an item is selected from the picker */
	onSelect?: (item: T) => void
	/** Called when picker state changes - use this to render PickerSelect externally */
	onPickerStateChange?: (state: AutocompletePickerState<T>) => void
	/** Prompt character for the first line (default: "> ") */
	prompt?: string
}

/**
 * Ref handle for AutocompleteInput - allows parent to access picker state and actions
 */
export interface AutocompleteInputHandle<T extends AutocompleteItem = AutocompleteItem> {
	/** Current picker state */
	pickerState: AutocompletePickerState<T>
	/** Handle item selection from external picker */
	handleItemSelect: (item: T) => void
	/** Handle index change from external picker */
	handleIndexChange: (index: number) => void
	/** Close the picker */
	closePicker: () => void
	/** Force refresh search results (used when async data arrives after initial search) */
	refreshSearch: () => void
}

/**
 * Inner component implementation
 */
function AutocompleteInputInner<T extends AutocompleteItem>(
	{
		placeholder = "Type your message...",
		onSubmit,
		isActive = true,
		triggers,
		onSelect,
		onPickerStateChange,
		prompt = "> ",
	}: AutocompleteInputProps<T>,
	ref: Ref<AutocompleteInputHandle<T>>,
) {
	const [inputValue, setInputValue] = useState("")

	// Counter to force re-mount of MultilineTextInput to move cursor to end
	const [inputKeyCounter, setInputKeyCounter] = useState(0)

	// Get terminal size for proper line wrapping
	const { columns } = useTerminalSize()

	// Autocomplete picker state
	const [pickerState, pickerActions] = useAutocompletePicker(triggers)

	// Input history
	const { addEntry, historyValue, isBrowsing, resetBrowsing, history, draft, setDraft, navigateUp, navigateDown } =
		useInputHistory({
			isActive: isActive && !pickerState.isOpen,
			getCurrentInput: () => inputValue,
		})

	const [wasBrowsing, setWasBrowsing] = useState(false)

	// Track previous picker state values to avoid unnecessary parent updates
	const prevPickerStateRef = useRef({
		isOpen: pickerState.isOpen,
		resultsLength: pickerState.results.length,
		selectedIndex: pickerState.selectedIndex,
		isLoading: pickerState.isLoading,
	})

	// Notify parent of picker state changes only when relevant properties change
	// This prevents double renders from cascading state updates
	useEffect(() => {
		const prev = prevPickerStateRef.current
		const curr = {
			isOpen: pickerState.isOpen,
			resultsLength: pickerState.results.length,
			selectedIndex: pickerState.selectedIndex,
			isLoading: pickerState.isLoading,
		}

		// Only notify if something visually relevant changed
		if (
			prev.isOpen !== curr.isOpen ||
			prev.resultsLength !== curr.resultsLength ||
			prev.selectedIndex !== curr.selectedIndex ||
			prev.isLoading !== curr.isLoading
		) {
			prevPickerStateRef.current = curr
			onPickerStateChange?.(pickerState)
		}
	}, [pickerState, onPickerStateChange])

	// Handle history navigation
	useEffect(() => {
		if (isBrowsing && !wasBrowsing) {
			if (historyValue !== null) {
				setInputValue(historyValue)
			}
		} else if (!isBrowsing && wasBrowsing) {
			setInputValue(draft)
		} else if (isBrowsing && historyValue !== null && historyValue !== inputValue) {
			setInputValue(historyValue)
		}

		setWasBrowsing(isBrowsing)
	}, [isBrowsing, wasBrowsing, historyValue, draft, inputValue])

	/**
	 * Get the last line from input value
	 */
	const getLastLine = useCallback((value: string): string => {
		const lines = value.split("\n")
		return lines[lines.length - 1] || ""
	}, [])

	/**
	 * Handle input value changes
	 */
	const handleChange = useCallback(
		(value: string) => {
			// Check for trigger activation
			const lastLine = getLastLine(value)
			const result = pickerActions.handleInputChange(value, lastLine)

			// If trigger consumes its character, use the consumed value instead
			const effectiveValue = result.consumedValue ?? value

			setInputValue(effectiveValue)

			// If user types while browsing history, exit browsing mode
			// This prevents the history effect from overwriting their edits
			if (isBrowsing) {
				resetBrowsing(effectiveValue)
			} else {
				setDraft(effectiveValue)
			}
		},
		[pickerActions, isBrowsing, setDraft, getLastLine, resetBrowsing],
	)

	/**
	 * Handle item selection from picker
	 */
	const handleItemSelect = useCallback(
		(item: T) => {
			const lastLine = getLastLine(inputValue)
			const newValue = pickerActions.handleSelect(item, inputValue, lastLine)

			setInputValue(newValue)
			setDraft(newValue)
			// Increment counter to force re-mount and move cursor to end
			setInputKeyCounter((c) => c + 1)

			// Notify parent
			onSelect?.(item)
		},
		[inputValue, pickerActions, setDraft, getLastLine, onSelect],
	)

	/**
	 * Handle form submission
	 */
	const handleSubmit = useCallback(
		async (text: string) => {
			const trimmed = text.trim()

			if (!trimmed) {
				return
			}

			// Don't submit if picker is open
			if (pickerState.isOpen) {
				return
			}

			await addEntry(trimmed)

			resetBrowsing("")
			setInputValue("")

			onSubmit(trimmed)
		},
		[pickerState.isOpen, addEntry, resetBrowsing, onSubmit],
	)

	/**
	 * Handle escape key
	 */
	const handleEscape = useCallback(() => {
		// If picker is open, close it without clearing text
		if (pickerState.isOpen) {
			pickerActions.handleClose()
			return
		}

		// Clear all input on Escape when picker is not open
		setInputValue("")
		setDraft("")
		resetBrowsing("")
	}, [pickerState.isOpen, pickerActions, setDraft, resetBrowsing])

	// Handle picker selection with Enter or Tab
	useInput(
		(_input, key) => {
			if (!isActive || !pickerState.isOpen) {
				return
			}

			// Select current item on Enter or Tab
			if (key.return || key.tab) {
				const selected = pickerState.results[pickerState.selectedIndex]

				if (selected) {
					handleItemSelect(selected)
				}
			}
		},
		{ isActive: isActive && pickerState.isOpen },
	)

	// Expose handle to parent via ref
	useImperativeHandle(
		ref,
		() => ({
			pickerState,
			handleItemSelect,
			handleIndexChange: pickerActions.handleIndexChange,
			closePicker: pickerActions.handleClose,
			refreshSearch: pickerActions.forceRefresh,
		}),
		[
			pickerState,
			handleItemSelect,
			pickerActions.handleIndexChange,
			pickerActions.handleClose,
			pickerActions.forceRefresh,
		],
	)

	return (
		<MultilineTextInput
			key={`autocomplete-input-${history.length}-${inputKeyCounter}`}
			value={inputValue}
			onChange={handleChange}
			onSubmit={handleSubmit}
			onEscape={handleEscape}
			onUpAtFirstLine={navigateUp}
			onDownAtLastLine={navigateDown}
			placeholder={placeholder}
			isActive={isActive}
			showCursor={true}
			prompt={prompt}
			columns={columns}
		/>
	)
}

/**
 * A multiline text input with autocomplete support.
 *
 * Features:
 * - Multiline text editing with history
 * - Trigger-based autocomplete (e.g., @ for files, / for commands)
 * - Keyboard navigation in picker
 * - Exposes picker state via ref for external picker rendering
 *
 * @template T - The type of autocomplete items
 *
 * @example
 * ```tsx
 * const inputRef = useRef<AutocompleteInputHandle<MyItem>>(null)
 *
 * <AutocompleteInput
 *   ref={inputRef}
 *   triggers={myTriggers}
 *   onSubmit={handleSubmit}
 *   onPickerStateChange={(state) => setPickerState(state)}
 * />
 *
 * {pickerState.isOpen && (
 *   <PickerSelect
 *     results={pickerState.results}
 *     selectedIndex={pickerState.selectedIndex}
 *     onSelect={inputRef.current?.handleItemSelect}
 *     // ...
 *   />
 * )}
 * ```
 */
export const AutocompleteInput = forwardRef(AutocompleteInputInner) as <T extends AutocompleteItem>(
	props: AutocompleteInputProps<T> & { ref?: Ref<AutocompleteInputHandle<T>> },
) => ReturnType<typeof AutocompleteInputInner>

/**
 * Re-export types and hook for convenience
 */
export { useAutocompletePicker } from "./useAutocompletePicker.js"
export type {
	AutocompleteItem,
	AutocompleteTrigger,
	AutocompletePickerState,
	AutocompletePickerActions,
	TriggerDetectionResult,
} from "./types.js"

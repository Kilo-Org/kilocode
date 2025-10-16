/**
 * Jotai atoms for centralized keyboard event state management
 */

import { atom } from "jotai"
import type { Key, KeypressHandler } from "../../types/keyboard.js"
import type { CommandSuggestion, ArgumentSuggestion } from "../../services/autocomplete.js"
import { TextBuffer } from "../../ui/utils/textBuffer.js"
import {
	inputValueAtom,
	clearInputAtom,
	showAutocompleteAtom,
	suggestionsAtom,
	argumentSuggestionsAtom,
	selectedIndexAtom,
	followupSuggestionsAtom,
	showFollowupSuggestionsAtom,
	clearFollowupSuggestionsAtom,
	textBufferAtom,
	cursorPositionAtom,
	inputModeAtom,
	type InputMode,
} from "./ui.js"
import {
	isApprovalPendingAtom,
	approvalOptionsAtom,
	selectedApprovalOptionAtom,
	approveAtom,
	rejectAtom,
	executeSelectedAtom,
} from "./approval.js"

// ============================================================================
// Core State Atoms
// ============================================================================

/**
 * Set of all active keyboard event subscribers
 */
export const keyboardSubscribersAtom = atom<Set<KeypressHandler>>(new Set<KeypressHandler>())

/**
 * Whether raw mode is currently enabled for stdin
 */
export const rawModeEnabledAtom = atom<boolean>(false)

/**
 * Whether Kitty keyboard protocol is enabled
 */
export const kittyProtocolEnabledAtom = atom<boolean>(false)

/**
 * Debug mode for logging keystrokes
 */
export const debugKeystrokeLoggingAtom = atom<boolean>(false)

// ============================================================================
// Buffer Atoms
// ============================================================================

/**
 * Buffer for accumulating pasted text
 */
export const pasteBufferAtom = atom<string>("")

/**
 * Buffer for drag-and-drop text (e.g., file paths)
 */
export const dragBufferAtom = atom<string>("")

/**
 * Buffer for incomplete Kitty protocol sequences
 */
export const kittySequenceBufferAtom = atom<string>("")

/**
 * Buffer for detecting backslash+enter combination
 */
export const backslashBufferAtom = atom<boolean>(false)

// ============================================================================
// Mode Atoms
// ============================================================================

/**
 * Whether we're currently in paste mode (between paste brackets)
 */
export const isPasteModeAtom = atom<boolean>(false)

/**
 * Whether we're currently dragging text (started with quote)
 */
export const isDragModeAtom = atom<boolean>(false)

/**
 * Whether we're waiting for Enter after backslash
 */
export const waitingForEnterAfterBackslashAtom = atom<boolean>(false)

// ============================================================================
// Event Atoms
// ============================================================================

/**
 * The most recent key event (for debugging/display)
 */
export const currentKeyEventAtom = atom<Key | null>(null)

/**
 * History of recent key events (for debugging)
 */
export const keyEventHistoryAtom = atom<Key[]>([])

/**
 * Maximum number of key events to keep in history
 */
export const MAX_KEY_EVENT_HISTORY = 50

// ============================================================================
// Derived Atoms
// ============================================================================

/**
 * Number of active subscribers
 */
export const subscriberCountAtom = atom<number>((get) => {
	return get(keyboardSubscribersAtom).size
})

/**
 * Whether any subscribers are active
 */
export const hasSubscribersAtom = atom<boolean>((get) => {
	return get(subscriberCountAtom) > 0
})

// ============================================================================
// Action Atoms
// ============================================================================

/**
 * Subscribe to keypress events
 * Returns an unsubscribe function
 */
export const subscribeToKeyboardAtom = atom(null, (get, set, handler: KeypressHandler) => {
	const subscribers = new Set(get(keyboardSubscribersAtom))
	subscribers.add(handler)
	set(keyboardSubscribersAtom, subscribers)

	// Return unsubscribe function
	return () => {
		const subs = new Set(get(keyboardSubscribersAtom))
		subs.delete(handler)
		set(keyboardSubscribersAtom, subs)
	}
})

/**
 * Unsubscribe from keypress events
 */
export const unsubscribeFromKeyboardAtom = atom(null, (get, set, handler: KeypressHandler) => {
	const subscribers = new Set(get(keyboardSubscribersAtom))
	subscribers.delete(handler)
	set(keyboardSubscribersAtom, subscribers)
})

/**
 * Broadcast a key event to all subscribers
 */
export const broadcastKeyEventAtom = atom(null, (get, set, key: Key) => {
	// Update current key event
	set(currentKeyEventAtom, key)

	// Add to history (with limit)
	const history = get(keyEventHistoryAtom)
	const newHistory = [...history, key].slice(-MAX_KEY_EVENT_HISTORY)
	set(keyEventHistoryAtom, newHistory)

	// Broadcast to all subscribers
	const subscribers = get(keyboardSubscribersAtom)
	subscribers.forEach((handler) => {
		try {
			handler(key)
		} catch (error) {
			console.error("Error in keypress handler:", error)
		}
	})
})

/**
 * Clear all keypress buffers
 */
export const clearBuffersAtom = atom(null, (get, set) => {
	set(pasteBufferAtom, "")
	set(dragBufferAtom, "")
	set(kittySequenceBufferAtom, "")
	set(backslashBufferAtom, false)
	set(isPasteModeAtom, false)
	set(isDragModeAtom, false)
	set(waitingForEnterAfterBackslashAtom, false)
})

/**
 * Set paste mode
 */
export const setPasteModeAtom = atom(null, (get, set, isPaste: boolean) => {
	set(isPasteModeAtom, isPaste)
	if (!isPaste) {
		// Clear paste buffer when exiting paste mode
		set(pasteBufferAtom, "")
	}
})

/**
 * Append to paste buffer
 */
export const appendToPasteBufferAtom = atom(null, (get, set, text: string) => {
	const current = get(pasteBufferAtom)
	set(pasteBufferAtom, current + text)
})

/**
 * Set drag mode
 */
export const setDragModeAtom = atom(null, (get, set, isDrag: boolean) => {
	set(isDragModeAtom, isDrag)
	if (!isDrag) {
		// Clear drag buffer when exiting drag mode
		set(dragBufferAtom, "")
	}
})

/**
 * Append to drag buffer
 */
export const appendToDragBufferAtom = atom(null, (get, set, text: string) => {
	const current = get(dragBufferAtom)
	set(dragBufferAtom, current + text)
})

/**
 * Append to Kitty sequence buffer
 */
export const appendToKittyBufferAtom = atom(null, (get, set, text: string) => {
	const current = get(kittySequenceBufferAtom)
	set(kittySequenceBufferAtom, current + text)
})

/**
 * Clear Kitty sequence buffer
 */
export const clearKittyBufferAtom = atom(null, (get, set) => {
	set(kittySequenceBufferAtom, "")
})

/**
 * Clear key event history
 */
export const clearKeyEventHistoryAtom = atom(null, (get, set) => {
	set(keyEventHistoryAtom, [])
	set(currentKeyEventAtom, null)
})

/**
 * Enable/disable debug logging
 */
export const setDebugLoggingAtom = atom(null, (get, set, enabled: boolean) => {
	set(debugKeystrokeLoggingAtom, enabled)
})

/**
 * Enable/disable Kitty protocol
 */
export const setKittyProtocolAtom = atom(null, (get, set, enabled: boolean) => {
	set(kittyProtocolEnabledAtom, enabled)
	if (!enabled) {
		// Clear Kitty buffer when disabling
		set(kittySequenceBufferAtom, "")
	}
})

// ============================================================================
// Input Submission System
// ============================================================================

/**
 * Atom to store the submission callback
 * Components set this to their onSubmit handler
 * This is a regular read-write atom, not a write-only action atom
 *
 * IMPORTANT: We wrap this in an object to prevent Jotai from treating
 * the function as an updater function when setting the atom value
 */
export const submissionCallbackAtom = atom<{ callback: ((text: string) => void) | null }>({ callback: null })

/**
 * Atom to handle input submission
 * This is called when the user presses Enter to submit input
 */
export const submitInputAtom = atom(null, (get, set, text: string | Buffer) => {
	// Get the submission callback
	const callbackWrapper = get(submissionCallbackAtom)
	const callback = callbackWrapper.callback

	// Convert Buffer to string if needed
	const textStr = typeof text === "string" ? text : text.toString()

	if (callback && typeof callback === "function" && textStr && textStr.trim()) {
		// Call the submission callback
		callback(textStr)

		// Clear input and related state
		set(clearInputAtom)
		set(clearFollowupSuggestionsAtom)
	}
})

// ============================================================================
// Keyboard Handler System
// ============================================================================

/**
 * Helper function to get the completion text (only the missing part to append)
 */
function getCompletionText(currentInput: string, suggestion: CommandSuggestion | ArgumentSuggestion): string {
	if ("command" in suggestion) {
		// CommandSuggestion - complete the command name
		const commandName = suggestion.command.name
		const currentText = currentInput.startsWith("/") ? currentInput.slice(1) : currentInput

		// If the command name starts with what user typed, return only the missing part
		if (commandName.toLowerCase().startsWith(currentText.toLowerCase())) {
			return commandName.slice(currentText.length)
		}

		// Otherwise return the full command (shouldn't happen in normal flow)
		return commandName
	} else {
		// ArgumentSuggestion - complete the last argument
		const parts = currentInput.split(" ")
		const lastPart = parts[parts.length - 1] || ""
		const suggestionValue = suggestion.value

		// If suggestion starts with what user typed, return only the missing part
		if (suggestionValue.toLowerCase().startsWith(lastPart.toLowerCase())) {
			return suggestionValue.slice(lastPart.length)
		}

		// Otherwise return the full value
		return suggestionValue
	}
}

/**
 * Helper function to format autocomplete suggestions for display/submission
 */
function formatSuggestion(suggestion: CommandSuggestion | ArgumentSuggestion, currentInput: string): string {
	if ("command" in suggestion) {
		// CommandSuggestion - return full command with slash
		return `/${suggestion.command.name}`
	} else {
		// ArgumentSuggestion - replace last part with suggestion value
		const parts = currentInput.split(" ")
		parts[parts.length - 1] = suggestion.value
		return parts.join(" ")
	}
}

/**
 * Approval mode keyboard handler
 */
function handleApprovalKeys(get: any, set: any, key: Key) {
	const selectedIndex = get(selectedIndexAtom)
	const options = get(approvalOptionsAtom)

	switch (key.name) {
		case "down":
			set(selectedIndexAtom, (selectedIndex + 1) % options.length)
			return

		case "up":
			set(selectedIndexAtom, selectedIndex === 0 ? options.length - 1 : selectedIndex - 1)
			return

		case "y": {
			// Approve action
			set(approveAtom)
			return
		}

		case "n": {
			// Reject action
			set(rejectAtom)
			return
		}

		case "return": {
			// Execute selected option
			set(executeSelectedAtom)
			return
		}

		case "escape": {
			// Reject on escape
			set(rejectAtom)
			return
		}

		default:
			return
	}
}

/**
 * Followup mode keyboard handler
 */
function handleFollowupKeys(get: any, set: any, key: Key): void {
	const selectedIndex = get(selectedIndexAtom)
	const suggestions = get(followupSuggestionsAtom)

	switch (key.name) {
		case "down":
			// -1 means no selection (user can type custom)
			if (selectedIndex < suggestions.length - 1) {
				set(selectedIndexAtom, selectedIndex + 1)
			} else {
				set(selectedIndexAtom, -1)
			}
			return

		case "up":
			if (selectedIndex === -1) {
				set(selectedIndexAtom, suggestions.length - 1)
			} else if (selectedIndex === 0) {
				set(selectedIndexAtom, -1)
			} else {
				set(selectedIndexAtom, selectedIndex - 1)
			}
			return

		case "tab":
			if (selectedIndex >= 0) {
				const suggestion = suggestions[selectedIndex]
				if (suggestion) {
					const buffer = get(textBufferAtom)
					buffer.setText(suggestion.answer)
					set(textBufferAtom, buffer)
					set(cursorPositionAtom, { row: buffer.cursor.row, col: buffer.cursor.column })
					set(selectedIndexAtom, -1)
				}
			}
			return

		case "return":
			if (!key.shift && !key.meta) {
				if (selectedIndex >= 0) {
					const suggestion = suggestions[selectedIndex]
					if (suggestion) {
						// Submit the selected suggestion
						set(submitInputAtom, suggestion.answer)
					}
				} else {
					// Submit current input
					set(submitInputAtom, get(inputValueAtom))
				}
				return
			}
			break
	}

	// Fall through to normal text handling
	handleTextInputKeys(get, set, key)
}

/**
 * Autocomplete mode keyboard handler
 */
function handleAutocompleteKeys(get: any, set: any, key: Key): void {
	const selectedIndex = get(selectedIndexAtom)
	const commandSuggestions = get(suggestionsAtom)
	const argumentSuggestions = get(argumentSuggestionsAtom)
	const allSuggestions = [...commandSuggestions, ...argumentSuggestions]

	switch (key.name) {
		case "down":
			set(selectedIndexAtom, (selectedIndex + 1) % allSuggestions.length)
			return

		case "up":
			set(selectedIndexAtom, selectedIndex === 0 ? allSuggestions.length - 1 : selectedIndex - 1)
			return

		case "tab":
			if (allSuggestions[selectedIndex]) {
				const suggestion = allSuggestions[selectedIndex]
				const buffer = get(textBufferAtom)

				// Get only the missing part to append
				const completionText = getCompletionText(buffer.text, suggestion)

				// Create new buffer and append the completion
				const newBuffer = new TextBuffer(buffer.text)
				newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
				newBuffer.insertText(completionText)

				set(textBufferAtom, newBuffer)
				set(cursorPositionAtom, { row: newBuffer.cursor.row, col: newBuffer.cursor.column })
			}
			return

		case "return":
			if (!key.shift && !key.meta && allSuggestions[selectedIndex]) {
				const suggestion = allSuggestions[selectedIndex]
				const buffer = get(textBufferAtom)
				const newText = formatSuggestion(suggestion, buffer.text)
				set(submitInputAtom, newText)
				return
			}
			break

		case "escape":
			set(clearInputAtom)
			return
	}

	handleTextInputKeys(get, set, key)
}

/**
 * Unified text input keyboard handler
 * Handles both normal (single-line) and multiline text input
 */
function handleTextInputKeys(get: any, set: any, key: Key) {
	const buffer = get(textBufferAtom)

	// Helper to update buffer state
	// Create a new TextBuffer instance to ensure Jotai detects the change
	const updateBuffer = (newBuffer: TextBuffer) => {
		set(textBufferAtom, newBuffer)
		set(cursorPositionAtom, { row: newBuffer.cursor.row, col: newBuffer.cursor.column })
	}

	switch (key.name) {
		// Navigation keys (multiline only)
		case "up": {
			const newBuffer = new TextBuffer(buffer.text)
			newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
			if (newBuffer.moveUp()) {
				updateBuffer(newBuffer)
			}
			return
		}

		case "down": {
			const newBuffer = new TextBuffer(buffer.text)
			newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
			if (newBuffer.moveDown()) {
				updateBuffer(newBuffer)
			}
			return
		}

		case "left": {
			const newBuffer = new TextBuffer(buffer.text)
			newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
			if (newBuffer.moveLeft()) {
				updateBuffer(newBuffer)
			}
			return
		}

		case "right": {
			const newBuffer = new TextBuffer(buffer.text)
			newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
			if (newBuffer.moveRight()) {
				updateBuffer(newBuffer)
			}
			return
		}

		// Enter/Return
		case "return":
			if (key.shift || key.meta) {
				// Shift+Enter or Meta+Enter: insert newline
				const newBuffer = new TextBuffer(buffer.text)
				newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
				newBuffer.insertNewline()
				updateBuffer(newBuffer)
			} else {
				// Plain Enter: submit
				// Get the current buffer text (not the stale buffer variable)
				const currentBuffer = get(textBufferAtom)
				set(submitInputAtom, currentBuffer.text)
			}
			return

		// Backspace
		case "backspace": {
			const newBuffer = new TextBuffer(buffer.text)
			newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
			if (key.meta) {
				newBuffer.deleteWord()
			} else {
				newBuffer.backspace()
			}
			updateBuffer(newBuffer)
			return
		}

		// Escape
		case "escape":
			set(clearInputAtom)
			return

		// Emacs-style operations (multiline only)
		case "a":
			if (key.ctrl) {
				const newBuffer = new TextBuffer(buffer.text)
				newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
				newBuffer.moveToLineStart()
				updateBuffer(newBuffer)
				return
			}
			break

		case "e":
			if (key.ctrl) {
				const newBuffer = new TextBuffer(buffer.text)
				newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
				newBuffer.moveToLineEnd()
				updateBuffer(newBuffer)
				return
			}
			break

		case "k":
			if (key.ctrl) {
				const newBuffer = new TextBuffer(buffer.text)
				newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
				newBuffer.killLine()
				updateBuffer(newBuffer)
				return
			}
			break

		case "u":
			if (key.ctrl) {
				const newBuffer = new TextBuffer(buffer.text)
				newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
				newBuffer.killLineLeft()
				updateBuffer(newBuffer)
				return
			}
			break
	}

	// Character input
	if (!key.ctrl && !key.meta && key.sequence.length === 1) {
		const newBuffer = new TextBuffer(buffer.text)
		newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
		newBuffer.insertChar(key.sequence)
		updateBuffer(newBuffer)

		// Auto-detect mode changes
		if (newBuffer.text.startsWith("/")) {
			set(showAutocompleteAtom, true)
			set(inputModeAtom, "autocomplete")
		}

		return
	}

	// Paste
	if (key.paste) {
		const newBuffer = new TextBuffer(buffer.text)
		newBuffer.moveTo(buffer.cursor.row, buffer.cursor.column)
		newBuffer.insertText(key.sequence)
		updateBuffer(newBuffer)
		return
	}

	return
}

/**
 * Main keyboard handler that routes based on mode
 * This is the central keyboard handling atom that all key events go through
 */
export const keyboardHandlerAtom = atom(null, (get, set, key: Key) => {
	// Determine current mode
	const isApprovalPending = get(isApprovalPendingAtom)
	const isFollowupVisible = get(showFollowupSuggestionsAtom)
	const isAutocompleteVisible = get(showAutocompleteAtom)
	const text = get(inputValueAtom)

	// Mode priority: approval > followup > autocomplete > normal
	let mode: InputMode = "normal"
	if (isApprovalPending) mode = "approval"
	else if (isFollowupVisible) mode = "followup"
	else if (isAutocompleteVisible) mode = "autocomplete"

	// Update mode atom
	set(inputModeAtom, mode)

	// Route to appropriate handler
	switch (mode) {
		case "approval":
			return handleApprovalKeys(get, set, key)
		case "followup":
			return handleFollowupKeys(get, set, key)
		case "autocomplete":
			return handleAutocompleteKeys(get, set, key)
		default:
			return handleTextInputKeys(get, set, key)
	}
})

/**
 * Setup atom that connects keyboard events to the centralized handler
 * Returns an unsubscribe function for cleanup
 */
export const setupKeyboardAtom = atom(null, (get, set) => {
	const unsubscribe = set(subscribeToKeyboardAtom, (key: Key) => {
		// Send ALL keys to the centralized handler
		set(keyboardHandlerAtom, key)
	})

	return unsubscribe
})

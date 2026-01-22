/**
 * Jotai atoms for centralized keyboard event state management
 */

import { atom, Getter, Setter, type Getter as _Getter, type Setter as _Setter } from "jotai"
import type { Key, KeypressHandler } from "../../types/keyboard.js"
import type { CommandSuggestion, ArgumentSuggestion, FileMentionSuggestion } from "../../services/autocomplete.js"
import {
	clearTextBufferAtom,
	showAutocompleteAtom,
	suggestionsAtom,
	argumentSuggestionsAtom,
	fileMentionSuggestionsAtom,
	fileMentionContextAtom,
	selectedIndexAtom,
	followupSuggestionsAtom,
	followupSuggestionsMenuVisibleAtom,
	clearFollowupSuggestionsAtom,
	inputModeAtom,
	type InputMode,
	isStreamingAtom,
	isCancellingAtom,
} from "./ui.js"
import {
	textBufferStringAtom,
	textBufferIsEmptyAtom,
	moveUpAtom,
	moveDownAtom,
	moveLeftAtom,
	moveRightAtom,
	moveToLineStartAtom,
	moveToLineEndAtom,
	moveToAtom,
	moveToPreviousWordAtom,
	moveToNextWordAtom,
	insertCharAtom,
	insertTextAtom,
	insertNewlineAtom,
	backspaceAtom,
	deleteCharAtom,
	deleteWordAtom,
	killLineAtom,
	killLineLeftAtom,
	setTextAtom,
} from "./textBuffer.js"
import { isApprovalPendingAtom, approvalOptionsAtom, approveAtom, rejectAtom, executeSelectedAtom } from "./approval.js"
import { hasResumeTaskAtom } from "./extension.js"
import { cancelTaskAtom, resumeTaskAtom, toggleYoloModeAtom, cycleNextModeAtom } from "./actions.js"
import {
	historyModeAtom,
	historyEntriesAtom,
	enterHistoryModeAtom,
	exitHistoryModeAtom,
	navigateHistoryUpAtom,
	navigateHistoryDownAtom,
} from "./history.js"
import {
	shellModeActiveAtom,
	toggleShellModeAtom,
	navigateShellHistoryUpAtom,
	navigateShellHistoryDownAtom,
	executeShellCommandAtom,
} from "./shell.js"
import { saveClipboardImage, clipboardHasImage, cleanupOldClipboardImages } from "../../media/clipboard.js"
import { logs } from "../../services/logs.js"

// Export shell atoms for backward compatibility
export {
	shellModeActiveAtom,
	toggleShellModeAtom,
	navigateShellHistoryUpAtom,
	navigateShellHistoryDownAtom,
	executeShellCommandAtom,
}

// ============================================================================
// Clipboard Image Atoms
// ============================================================================

/**
 * Map of image reference numbers to file paths for current message
 * e.g., { 1: "/tmp/kilocode-clipboard/clipboard-xxx.png", 2: "/tmp/..." }
 */
export const imageReferencesAtom = atom<Map<number, string>>(new Map())

/**
 * Current image reference counter (increments with each paste)
 */
export const imageReferenceCounterAtom = atom<number>(0)

/**
 * Add a clipboard image and get its reference number
 * Returns the reference number assigned to this image
 */
export const addImageReferenceAtom = atom(null, (get, set, filePath: string): number => {
	const counter = get(imageReferenceCounterAtom) + 1
	set(imageReferenceCounterAtom, counter)

	const refs = new Map(get(imageReferencesAtom))
	refs.set(counter, filePath)
	set(imageReferencesAtom, refs)

	return counter
})

/**
 * Clear image references (after message is sent)
 */
export const clearImageReferencesAtom = atom(null, (_get, set) => {
	set(imageReferencesAtom, new Map())
	set(imageReferenceCounterAtom, 0)
})

/**
 * Get all image references as an object for easier consumption
 */
export const getImageReferencesAtom = atom((get) => {
	return Object.fromEntries(get(imageReferencesAtom))
})

/**
 * Status message for clipboard operations
 */
export const clipboardStatusAtom = atom<string | null>(null)
let clipboardStatusTimer: NodeJS.Timeout | null = null

/**
 * Tracks the number of image paste operations currently in progress.
 * When > 0, input should be disabled and a loader should be shown.
 * Uses a counter instead of boolean to support multiple concurrent pastes.
 */
export const pendingImagePastesAtom = atom<number>(0)

/**
 * Tracks the number of text paste operations currently in progress.
 * When > 0, input should be disabled and a loader should be shown.
 * Uses a counter instead of boolean to support multiple concurrent pastes.
 */
export const pendingTextPastesAtom = atom<number>(0)

function setClipboardStatusWithTimeout(set: Setter, message: string, timeoutMs: number): void {
	if (clipboardStatusTimer) {
		clearTimeout(clipboardStatusTimer)
	}
	set(clipboardStatusAtom, message)
	clipboardStatusTimer = setTimeout(() => set(clipboardStatusAtom, null), timeoutMs)
}

// ============================================================================
// Pasted Text Reference Atoms
// ============================================================================

/**
 * Threshold for when to abbreviate pasted text (number of lines)
 * Pastes with this many lines or more will be abbreviated
 */
export const PASTE_LINE_THRESHOLD = 10

/**
 * Map of pasted text reference numbers to full text content for current message
 * e.g., { 1: "line1\nline2\n...", 2: "another\npaste..." }
 */
export const pastedTextReferencesAtom = atom<Map<number, string>>(new Map())

/**
 * Current pasted text reference counter (increments with each large paste)
 */
export const pastedTextReferenceCounterAtom = atom<number>(0)

/**
 * Format a pasted text reference for display
 * @param refNumber - The reference number
 * @param lineCount - Number of lines in the paste
 * @returns Formatted reference string like "[Pasted text #1 +25 lines]"
 */
export function formatPastedTextReference(refNumber: number, lineCount: number): string {
	return `[Pasted text #${refNumber} +${lineCount} lines]`
}

export const addPastedTextReferenceAtom = atom(null, (get, set, text: string): number => {
	const counter = get(pastedTextReferenceCounterAtom) + 1
	set(pastedTextReferenceCounterAtom, counter)

	const refs = new Map(get(pastedTextReferencesAtom))
	refs.set(counter, text)
	set(pastedTextReferencesAtom, refs)

	return counter
})

/**
 * Clear pasted text references (after message is sent)
 */
export const clearPastedTextReferencesAtom = atom(null, (_get, set) => {
	set(pastedTextReferencesAtom, new Map())
	set(pastedTextReferenceCounterAtom, 0)
})

/**
 * Get all pasted text references as an object for easier consumption
 */
export const getPastedTextReferencesAtom = atom((get) => {
	return Object.fromEntries(get(pastedTextReferencesAtom))
})

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
// Exit Confirmation State
// ============================================================================

const EXIT_CONFIRMATION_WINDOW_MS = 2000

type ExitPromptTimeout = ReturnType<typeof setTimeout>

export const exitPromptVisibleAtom = atom<boolean>(false)
const exitPromptTimeoutAtom = atom<ExitPromptTimeout | null>(null)
export const exitRequestCounterAtom = atom<number>(0)

export const triggerExitConfirmationAtom = atom(null, (get, set) => {
	const exitPromptVisible = get(exitPromptVisibleAtom)
	const existingTimeout = get(exitPromptTimeoutAtom)

	if (existingTimeout) {
		clearTimeout(existingTimeout)
		set(exitPromptTimeoutAtom, null)
	}

	if (exitPromptVisible) {
		set(exitPromptVisibleAtom, false)
		set(exitRequestCounterAtom, (count) => count + 1)
		return
	}

	set(exitPromptVisibleAtom, true)
	const timeout = setTimeout(() => {
		set(exitPromptVisibleAtom, false)
		set(exitPromptTimeoutAtom, null)
	}, EXIT_CONFIRMATION_WINDOW_MS)
	set(exitPromptTimeoutAtom, timeout)
})

// ============================================================================
// Buffer Atoms
// ============================================================================

/**
 * Buffer for accumulating pasted text
 */
export const pasteBufferAtom = atom<string>("")

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
	set(kittySequenceBufferAtom, "")
	set(backslashBufferAtom, false)
	set(isPasteModeAtom, false)
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
	const trimmedText = textStr.trim()
	const hasFollowupSuggestions = get(followupSuggestionsAtom).length > 0
	const isSlashCommand = trimmedText.startsWith("/")
	const slashCommandName = isSlashCommand ? (trimmedText.match(/^\/([^\s]+)/)?.[1]?.toLowerCase() ?? "") : ""
	const shouldDismissFollowupOnSlashCommand = new Set(["clear", "c", "cls", "new", "n", "start", "exit", "q", "quit"])

	if (callback && typeof callback === "function" && trimmedText) {
		// Call the submission callback
		callback(textStr)

		// Clear input and related state
		set(clearTextBufferAtom)
		// If the user runs a slash command while a followup question is active,
		// keep the followup question/suggestions so they can answer after the command runs.
		if (hasFollowupSuggestions && isSlashCommand) {
			if (slashCommandName && shouldDismissFollowupOnSlashCommand.has(slashCommandName)) {
				set(clearFollowupSuggestionsAtom)
			} else {
				// Ensure followup stays in "no selection" mode after executing a slash command.
				set(selectedIndexAtom, -1)
			}
		} else {
			set(clearFollowupSuggestionsAtom)
		}
	}
})

// ============================================================================
// Keyboard Handler System
// ============================================================================

/**
 * Calculate row and column position from an absolute character position in text
 * @param text - The text to calculate position in
 * @param absolutePosition - The absolute character position (0-indexed)
 * @returns Object with row and column (both 0-indexed)
 */
function calculateRowColumnFromPosition(text: string, absolutePosition: number): { row: number; column: number } {
	const lines = text.split("\n")
	let pos = 0
	let row = 0
	let col = 0

	for (let i = 0; i < lines.length; i++) {
		const lineLength = lines[i]?.length || 0
		if (pos + lineLength >= absolutePosition) {
			row = i
			col = absolutePosition - pos
			break
		}
		pos += lineLength + 1 // +1 for newline
	}

	return { row, column: col }
}

/**
 * Helper function to format autocomplete suggestions for display/submission
 */
function formatSuggestion(
	suggestion: CommandSuggestion | ArgumentSuggestion | FileMentionSuggestion,
	currentInput: string,
	fileMentionContext?: { mentionStart: number; query: string } | null,
): string {
	if ("command" in suggestion) {
		// CommandSuggestion - return full command with slash
		return `/${suggestion.command.name}`
	} else if ("type" in suggestion && (suggestion.type === "file" || suggestion.type === "folder")) {
		// FileMentionSuggestion - insert file path at @ position with proper escaping
		const fileSuggestion = suggestion as FileMentionSuggestion

		if (!fileMentionContext) {
			return currentInput
		}

		// Escape spaces in file path
		const escapedPath = fileSuggestion.value.replace(/ /g, "\\ ")

		// Replace from @ to cursor with the file path
		const beforeMention = currentInput.slice(0, fileMentionContext.mentionStart)
		const afterMention = currentInput.slice(fileMentionContext.mentionStart + 1 + fileMentionContext.query.length)

		return beforeMention + "@" + escapedPath + " " + afterMention
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
function handleApprovalKeys(get: Getter, set: Setter, key: Key) {
	const selectedIndex = get(selectedIndexAtom)
	const options = get(approvalOptionsAtom)

	// Guard against empty options array to prevent NaN from modulo 0
	if (options.length === 0) return

	// Check if the key matches any option's hotkey (for number keys 1, 2, 3, etc.)
	const hotkeyIndex = options.findIndex((opt) => opt.hotkey === key.name)
	if (hotkeyIndex !== -1) {
		set(selectedIndexAtom, hotkeyIndex)
		set(executeSelectedAtom)
		return
	}

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
function handleFollowupKeys(get: Getter, set: Setter, key: Key): void {
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
					set(setTextAtom, suggestion.answer)
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
					set(submitInputAtom, get(textBufferStringAtom))
				}
				return
			}
			break
	}

	if (isKeyModifyBuffer(key)) {
		// If modifying buffer, unselect any suggestion
		set(selectedIndexAtom, -1)
	}

	// Fall through to normal text handling
	handleTextInputKeys(get, set, key)
}

/**
 * Autocomplete mode keyboard handler
 */
function handleAutocompleteKeys(get: Getter, set: Setter, key: Key): void {
	const selectedIndex = get(selectedIndexAtom)
	const commandSuggestions = get(suggestionsAtom)
	const argumentSuggestions = get(argumentSuggestionsAtom)
	const fileMentionSuggestions = get(fileMentionSuggestionsAtom)
	const fileMentionContext = get(fileMentionContextAtom)
	const allSuggestions = [...fileMentionSuggestions, ...commandSuggestions, ...argumentSuggestions]

	switch (key.name) {
		case "down":
			// Guard against empty suggestions array to prevent NaN from modulo 0
			if (allSuggestions.length === 0) return
			set(selectedIndexAtom, (selectedIndex + 1) % allSuggestions.length)
			return

		case "up":
			// Guard against empty suggestions array to prevent NaN from modulo 0
			if (allSuggestions.length === 0) return
			set(selectedIndexAtom, selectedIndex === 0 ? allSuggestions.length - 1 : selectedIndex - 1)
			return

		case "tab":
			if (allSuggestions[selectedIndex]) {
				const suggestion = allSuggestions[selectedIndex]
				const currentText = get(textBufferStringAtom)

				// Format the suggestion (handles commands, arguments, and file mentions)
				const newText = formatSuggestion(suggestion, currentText, fileMentionContext)
				set(setTextAtom, newText)

				// For file mentions, set cursor after the inserted path + space
				if (
					"type" in suggestion &&
					(suggestion.type === "file" || suggestion.type === "folder") &&
					fileMentionContext
				) {
					const fileSuggestion = suggestion as FileMentionSuggestion
					const escapedPath = fileSuggestion.value.replace(/ /g, "\\ ")
					const cursorPosition = fileMentionContext.mentionStart + 1 + escapedPath.length + 1 // @ + path + space

					// Calculate row and column from absolute position and set cursor
					const { row, column } = calculateRowColumnFromPosition(newText, cursorPosition)
					set(moveToAtom, { row, column })
				}
			}
			return

		case "return":
			if (!key.shift && !key.meta && allSuggestions[selectedIndex]) {
				const suggestion = allSuggestions[selectedIndex]
				const currentText = get(textBufferStringAtom)

				// For file mentions, Enter should insert (like Tab), not submit
				if ("type" in suggestion && (suggestion.type === "file" || suggestion.type === "folder")) {
					// Format the suggestion
					const newText = formatSuggestion(suggestion, currentText, fileMentionContext)
					set(setTextAtom, newText)

					// Set cursor after the inserted path + space
					if (fileMentionContext) {
						const fileSuggestion = suggestion as FileMentionSuggestion
						const escapedPath = fileSuggestion.value.replace(/ /g, "\\ ")
						const cursorPosition = fileMentionContext.mentionStart + 1 + escapedPath.length + 1 // @ + path + space

						// Calculate row and column from absolute position and set cursor
						const { row, column } = calculateRowColumnFromPosition(newText, cursorPosition)
						set(moveToAtom, { row, column })
					}
					return
				}

				// For commands and arguments, Enter submits
				const newText = formatSuggestion(suggestion, currentText, fileMentionContext)
				set(submitInputAtom, newText)
				return
			}
			break

		case "escape":
			// For file mentions, clear suggestions and add a space, but keep the buffer
			if (fileMentionSuggestions.length > 0) {
				// Clear file mention suggestions
				set(fileMentionSuggestionsAtom, [])
				// Add a space to the buffer
				set(insertCharAtom, " ")
				return
			}
			set(clearTextBufferAtom)
			return
	}

	handleTextInputKeys(get, set, key)
}

/**
 * History mode keyboard handler
 * Handles navigation through command history
 */
function handleHistoryKeys(get: Getter, set: Setter, key: Key): void {
	switch (key.name) {
		case "up": {
			// Navigate to older command
			const command = set(navigateHistoryUpAtom)
			if (command !== null) {
				set(setTextAtom, command)
			}
			return
		}

		case "down": {
			// Navigate to newer command
			const command = set(navigateHistoryDownAtom)
			if (command !== null) {
				set(setTextAtom, command)
			}
			return
		}

		default:
			// Any other key exits history mode
			set(exitHistoryModeAtom)
			// Fall through to normal text handling
			handleTextInputKeys(get, set, key)
			return
	}
}

/**
 * Shell mode keyboard handler
 * Handles shell command input and execution using existing text buffer
 */
async function handleShellKeys(get: Getter, set: Setter, key: Key): Promise<void> {
	const currentInput = get(textBufferStringAtom)

	switch (key.name) {
		case "up": {
			// Navigate shell history up
			set(navigateShellHistoryUpAtom)
			return
		}

		case "down": {
			// Navigate shell history down
			set(navigateShellHistoryDownAtom)
			return
		}

		case "return":
			if (!key.shift && !key.meta) {
				// Execute shell command
				set(executeShellCommandAtom, currentInput)
				return
			}
			break

		case "escape":
			// Exit shell mode
			set(toggleShellModeAtom)
			return

		default:
			// Character input - let the default text input handlers deal with it
			handleTextInputKeys(get, set, key)
			return
	}
}

/**
 * Unified text input keyboard handler
 * Handles both normal (single-line) and multiline text input
 */
function handleTextInputKeys(get: Getter, set: Setter, key: Key): void {
	// Check if we should enter history mode
	const isEmpty = get(textBufferIsEmptyAtom)
	const isInHistoryMode = get(historyModeAtom)

	// Enter history mode on up/down when input is empty and not already in history mode
	if (isEmpty && !isInHistoryMode && (key.name === "up" || key.name === "down")) {
		const entered = set(enterHistoryModeAtom, "")
		if (entered) {
			// Successfully entered history mode
			// Get the current entry (most recent) and display it
			const entries = get(historyEntriesAtom)
			if (entries.length > 0) {
				const mostRecent = entries[entries.length - 1]
				if (mostRecent) {
					set(setTextAtom, mostRecent.prompt)
				}
			}
			return
		}
		// If couldn't enter history mode (no history), fall through to normal handling
	}

	switch (key.name) {
		// Navigation keys (multiline only)
		case "up":
			set(moveUpAtom)
			return

		case "down":
			set(moveDownAtom)
			return

		case "left":
			if (key.meta) {
				set(moveToPreviousWordAtom)
			} else {
				set(moveLeftAtom)
			}
			return

		case "right":
			if (key.meta) {
				set(moveToNextWordAtom)
			} else {
				set(moveRightAtom)
			}
			return

		// Enter/Return
		case "return":
			if (key.shift || key.meta) {
				// Shift+Enter or Meta+Enter: insert newline
				set(insertNewlineAtom)
			} else {
				// Plain Enter: submit
				const currentText = get(textBufferStringAtom)
				set(submitInputAtom, currentText)
			}
			return

		// Backspace
		case "backspace":
			if (key.meta) {
				set(deleteWordAtom)
			} else {
				set(backspaceAtom)
			}
			return

		// Delete
		case "delete":
			set(deleteCharAtom)
			return

		// Escape
		case "escape":
			set(clearTextBufferAtom)
			return

		// Emacs-style operations (multiline only)
		case "a":
			if (key.ctrl) {
				set(moveToLineStartAtom)
				return
			}
			break

		case "e":
			if (key.ctrl) {
				set(moveToLineEndAtom)
				return
			}
			break

		case "k":
			if (key.ctrl) {
				set(killLineAtom)
				return
			}
			break

		case "u":
			if (key.ctrl) {
				set(killLineLeftAtom)
				return
			}
			break

		// Word navigation (Meta/Alt key)
		case "b":
			if (key.meta) {
				set(moveToPreviousWordAtom)
				return
			}
			break

		case "f":
			if (key.meta) {
				set(moveToNextWordAtom)
				return
			}
			break
	}

	// Character input
	if (!key.ctrl && !key.meta && key.sequence.length === 1) {
		set(insertCharAtom, key.sequence)
		return
	}

	if (key.paste) {
		// Fire-and-forget async paste with error handling
		handlePaste(set, key.sequence).catch((err) =>
			logs.error("Unhandled text paste error", "clipboard", { error: err }),
		)
		return
	}

	return
}

async function handlePaste(set: Setter, text: string): Promise<void> {
	// Quick line count check - avoid processing large text unnecessarily
	let lineCount = 0
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") lineCount++
		if (lineCount >= PASTE_LINE_THRESHOLD) break
	}
	lineCount++ // Account for last line (no trailing newline)

	const isLargePaste = lineCount >= PASTE_LINE_THRESHOLD

	// For large pastes, show loader and block input
	if (isLargePaste) {
		set(pendingTextPastesAtom, (count) => count + 1)
		// Allow React to render the loader before processing
		await new Promise((resolve) => setTimeout(resolve, 0))
	}

	try {
		if (isLargePaste) {
			// Store original text - normalize tabs only when expanding
			const actualLineCount = text.split("\n").length
			const refNumber = set(addPastedTextReferenceAtom, text)
			const reference = formatPastedTextReference(refNumber, actualLineCount)
			set(insertTextAtom, reference + " ")
		} else {
			// Small paste - normalize tabs to prevent border corruption
			const normalizedText = text.replace(/\t/g, "  ")
			set(insertTextAtom, normalizedText)
		}
	} finally {
		if (isLargePaste) {
			set(pendingTextPastesAtom, (count) => Math.max(0, count - 1))
		}
	}
}

function handleGlobalHotkeys(get: Getter, set: Setter, key: Key): boolean {
	// Debug logging for key detection (Ctrl or Meta/Cmd keys)
	if (key.ctrl || key.meta || key.sequence === "\x16") {
		logs.debug(
			`Key detected: name=${key.name}, ctrl=${key.ctrl}, meta=${key.meta}, shift=${key.shift}, paste=${key.paste}, sequence=${JSON.stringify(key.sequence)}`,
			"clipboard",
		)
	}

	// Check for Ctrl+V by sequence first (ASCII 0x16 = SYN character)
	// This is how Ctrl+V appears in most terminals
	if (key.sequence === "\x16") {
		logs.debug("Detected Ctrl+V via sequence \\x16", "clipboard")
		handleClipboardImagePaste(get, set).catch((err) =>
			logs.error("Unhandled clipboard paste error", "clipboard", { error: err }),
		)
		return true
	}

	switch (key.name) {
		case "c":
			if (key.ctrl) {
				set(triggerExitConfirmationAtom)
				set(clearTextBufferAtom)
				return true
			}
			break
		case "v":
			// Ctrl+V or Cmd+V (macOS) - check for clipboard image
			if (key.ctrl || key.meta) {
				logs.debug(`Detected ${key.meta ? "Cmd" : "Ctrl"}+V via key.name`, "clipboard")
				// Handle clipboard image paste asynchronously
				handleClipboardImagePaste(get, set).catch((err) =>
					logs.error("Unhandled clipboard paste error", "clipboard", { error: err }),
				)
				return true
			}
			break
		case "x":
			if (key.ctrl) {
				const isStreaming = get(isStreamingAtom)
				if (isStreaming) {
					set(isCancellingAtom, true)
					set(cancelTaskAtom)
					return true
				}
			}
			break
		case "escape": {
			const isStreaming = get(isStreamingAtom)
			if (isStreaming) {
				set(isCancellingAtom, true)
				set(cancelTaskAtom)
				return true
			}
			break
		}
		case "r":
			if (key.ctrl) {
				const hasResumeTask = get(hasResumeTaskAtom)
				if (hasResumeTask) {
					set(resumeTaskAtom)
				}
				return true
			}
			break
		case "y":
			// Toggle YOLO mode with Ctrl+Y
			if (key.ctrl) {
				set(toggleYoloModeAtom)
				return true
			}
			break
		case "tab":
			// Cycle through modes with Shift+Tab
			if (key.shift) {
				set(cycleNextModeAtom)
				return true
			}
			break
		case "shift-1": {
			// Toggle shell mode with Shift+1 or Shift+! only if input is empty
			const isEmpty = get(textBufferIsEmptyAtom)
			if (isEmpty) {
				// Input is empty, toggle shell mode
				set(toggleShellModeAtom)
				return true
			}
			// Input has text, don't consume the key - let it be inserted as "!"
			return false
		}
	}
	return false
}

/**
 * Atom to trigger clipboard image paste from external components (e.g., KeyboardProvider)
 * This is used when a paste timeout occurs (e.g., Cmd+V with image in clipboard)
 */
export const triggerClipboardImagePasteAtom = atom(null, async (get, set, fallbackText?: string) => {
	await handleClipboardImagePaste(get, set, fallbackText)
})

/**
 * Handle clipboard image paste (Ctrl+V or Cmd+V on macOS)
 * Saves clipboard image to a temp file and inserts @path reference into text buffer
 * If fallbackText is provided and no image is found, broadcasts the fallback text as a paste event
 */
async function handleClipboardImagePaste(get: Getter, set: Setter, fallbackText?: string): Promise<void> {
	logs.debug("handleClipboardImagePaste called", "clipboard")

	// Increment pending paste counter to show loader and block input
	// Using a counter allows multiple concurrent pastes - loader only hides when all complete
	set(pendingImagePastesAtom, (count) => count + 1)

	try {
		// Check if clipboard has an image
		logs.debug("Checking clipboard for image...", "clipboard")
		const hasImage = await clipboardHasImage()
		logs.debug(`clipboardHasImage returned: ${hasImage}`, "clipboard")
		if (!hasImage) {
			logs.debug("No image in clipboard", "clipboard")
			// If fallback text provided, broadcast it as paste event
			if (fallbackText) {
				logs.debug("Using fallback text for paste", "clipboard")
				set(broadcastKeyEventAtom, {
					name: "",
					ctrl: false,
					meta: false,
					shift: false,
					paste: true,
					sequence: fallbackText,
				})
			}
			return
		}

		// Save the image to a file in temp directory
		const result = await saveClipboardImage()
		if (result.success && result.filePath) {
			// Add image to references and get its number
			const refNumber = set(addImageReferenceAtom, result.filePath)

			// Build the [Image #N] reference to insert
			// Add space before and after if needed
			const currentText = get(textBufferStringAtom)
			let insertText = `[Image #${refNumber}]`

			// Check if we need spaces around the insertion
			const charBefore = currentText.length > 0 ? currentText[currentText.length - 1] : ""
			if (charBefore && charBefore !== " " && charBefore !== "\n") {
				insertText = " " + insertText
			}
			insertText = insertText + " "

			// Insert at current cursor position
			set(insertTextAtom, insertText)

			setClipboardStatusWithTimeout(set, `Image #${refNumber} attached`, 2000)
			logs.debug(`Inserted clipboard image #${refNumber}: ${result.filePath}`, "clipboard")

			// Clean up old clipboard images in the background
			cleanupOldClipboardImages().catch((cleanupError) => {
				logs.debug("Clipboard cleanup failed", "clipboard", {
					error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
				})
			})
		} else {
			setClipboardStatusWithTimeout(set, result.error || "Failed to save clipboard image", 3000)
		}
	} catch (error) {
		setClipboardStatusWithTimeout(
			set,
			`Clipboard error: ${error instanceof Error ? error.message : String(error)}`,
			3000,
		)
	} finally {
		// Decrement pending paste counter when done
		// Loader only hides when all concurrent pastes complete (counter reaches 0)
		set(pendingImagePastesAtom, (count) => Math.max(0, count - 1))
	}
}

/**
 * Main keyboard handler that routes based on mode
 * This is the central keyboard handling atom that all key events go through
 */
export const keyboardHandlerAtom = atom(null, async (get, set, key: Key) => {
	// Priority 1: Handle global hotkeys first (these work in all modes)
	if (handleGlobalHotkeys(get, set, key)) {
		return
	}

	// Priority 2: Block input while pasting images or text
	// This prevents user input during async paste processing
	// Uses counters to support multiple concurrent pastes
	if (get(pendingImagePastesAtom) > 0 || get(pendingTextPastesAtom) > 0) {
		return
	}

	// Priority 3: Determine current mode and route to mode-specific handler
	const isApprovalPending = get(isApprovalPendingAtom)
	const isFollowupVisible = get(followupSuggestionsMenuVisibleAtom)
	const isAutocompleteVisible = get(showAutocompleteAtom)
	const fileMentionSuggestions = get(fileMentionSuggestionsAtom)
	const isInHistoryMode = get(historyModeAtom)
	const isShellModeActive = get(shellModeActiveAtom)

	// Check if we have file mention suggestions (this means we're in file mention mode)
	const hasFileMentions = fileMentionSuggestions.length > 0

	// Mode priority: shell > approval > followup > history > autocomplete (including file mentions) > normal
	// History has higher priority than autocomplete because when navigating history,
	// the text buffer may contain commands that start with "/" which would trigger autocomplete
	let mode: InputMode = "normal"
	if (isShellModeActive) mode = "shell"
	else if (isApprovalPending) mode = "approval"
	else if (isFollowupVisible) mode = "followup"
	else if (isInHistoryMode) mode = "history"
	else if (hasFileMentions || isAutocompleteVisible) mode = "autocomplete"

	// Update mode atom
	set(inputModeAtom, mode)

	// Route to appropriate handler
	switch (mode) {
		case "shell":
			return await handleShellKeys(get, set, key)
		case "approval":
			return handleApprovalKeys(get, set, key)
		case "followup":
			return handleFollowupKeys(get, set, key)
		case "autocomplete":
			return handleAutocompleteKeys(get, set, key)
		case "history":
			return handleHistoryKeys(get, set, key)
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

/**
 * Utility Keys Functions
 */

const isKeyModifyBuffer = (key: Key): boolean => {
	return (
		!key.ctrl &&
		!key.meta &&
		!key.paste &&
		key.name !== "return" &&
		key.name !== "escape" &&
		key.sequence.length === 1
	)
}

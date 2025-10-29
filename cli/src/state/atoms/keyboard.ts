/**
 * Jotai atoms for centralized keyboard event state management
 */

import { atom } from "jotai"
import type { Key, KeypressHandler } from "../../types/keyboard.js"
import type { CommandSuggestion, ArgumentSuggestion } from "../../services/autocomplete.js"
import {
	clearTextBufferAtom,
	showAutocompleteAtom,
	suggestionsAtom,
	argumentSuggestionsAtom,
	selectedIndexAtom,
	followupSuggestionsAtom,
	showFollowupSuggestionsAtom,
	clearFollowupSuggestionsAtom,
	inputModeAtom,
	type InputMode,
	isStreamingAtom,
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
import { cancelTaskAtom, resumeTaskAtom } from "./actions.js"
import {
	historyModeAtom,
	historyEntriesAtom,
	enterHistoryModeAtom,
	exitHistoryModeAtom,
	navigateHistoryUpAtom,
	navigateHistoryDownAtom,
} from "./history.js"

// ============================================================================
// Shell Mode Atoms
// ============================================================================

/**
 * Whether shell mode is currently active
 */
export const shellModeActiveAtom = atom<boolean>(false)

/**
 * Shell command history
 */
export const shellHistoryAtom = atom<string[]>([])

/**
 * Current shell history index (for navigation)
 */
export const shellHistoryIndexAtom = atom<number>(-1)

/**
 * Action atom to toggle shell mode
 */
export const toggleShellModeAtom = atom(null, async (get, set) => {
	const isCurrentlyActive = get(shellModeActiveAtom)
	set(shellModeActiveAtom, !isCurrentlyActive)

	if (!isCurrentlyActive) {
		// Entering shell mode
		set(inputModeAtom, "shell" as InputMode)
		set(shellHistoryIndexAtom, -1)
		// Clear text buffer when entering shell mode
		const { clearTextAtom } = await import("./textBuffer.js")
		set(clearTextAtom)
	} else {
		// Exiting shell mode
		set(inputModeAtom, "normal" as InputMode)
		set(shellHistoryIndexAtom, -1)
		// Clear text buffer when exiting shell mode
		const { clearTextAtom } = await import("./textBuffer.js")
		set(clearTextAtom)
	}
})

/**
 * Action atom to add command to shell history
 */
export const addToShellHistoryAtom = atom(null, (get, set, command: string) => {
	const history = get(shellHistoryAtom)
	const newHistory = [...history, command]
	// Keep only last 100 commands
	set(shellHistoryAtom, newHistory.slice(-100))
})

/**
 * Action atom to navigate shell history up
 */
export const navigateShellHistoryUpAtom = atom(null, async (get, set) => {
	const history = get(shellHistoryAtom)
	const currentIndex = get(shellHistoryIndexAtom)

	if (history.length === 0) return

	let newIndex: number
	if (currentIndex === -1) {
		// First time going up - go to most recent command
		newIndex = history.length - 1
	} else if (currentIndex > 0) {
		// Go to older command
		newIndex = currentIndex - 1
	} else {
		// Already at oldest command
		return
	}

	set(shellHistoryIndexAtom, newIndex)

	// Set the text buffer to the history command
	const { setTextAtom } = await import("./textBuffer.js")
	set(setTextAtom, history[newIndex] || "")
})

/**
 * Action atom to navigate shell history down
 */
export const navigateShellHistoryDownAtom = atom(null, async (get, set) => {
	const history = get(shellHistoryAtom)
	const currentIndex = get(shellHistoryIndexAtom)

	if (currentIndex === -1) return

	let newIndex: number
	if (currentIndex === history.length - 1) {
		// At most recent command - clear input
		newIndex = -1
	} else {
		// Go to newer command
		newIndex = currentIndex + 1
	}

	set(shellHistoryIndexAtom, newIndex)

	// Set the text buffer to the history command or clear it
	const { setTextAtom, clearTextAtom } = await import("./textBuffer.js")
	if (newIndex === -1) {
		set(clearTextAtom)
	} else {
		set(setTextAtom, history[newIndex] || "")
	}
})

/**
 * Action atom to execute shell command
 */
export const executeShellCommandAtom = atom(null, async (get, set, command: string) => {
	if (!command.trim()) return

	// Add to history
	set(addToShellHistoryAtom, command.trim())

	// Clear the text buffer immediately for better UX
	const { clearTextAtom } = await import("./textBuffer.js")
	set(clearTextAtom)

	// Execute the command immediately (no approval needed)
	try {
		const { exec } = await import("child_process")

		// Execute command and capture output
		const childProcess = exec(command, {
			cwd: process.cwd(),
			timeout: 30000, // 30 second timeout
		})

		let stdout = ""
		let stderr = ""

		// Collect output
		childProcess.stdout?.on("data", (data) => {
			stdout += data.toString()
		})

		childProcess.stderr?.on("data", (data) => {
			stderr += data.toString()
		})

		// Wait for completion
		await new Promise<void>((resolve, reject) => {
			childProcess.on("close", (code) => {
				if (code === 0) {
					resolve()
				} else {
					reject(new Error(`Command exited with code ${code}`))
				}
			})

			childProcess.on("error", (error) => {
				reject(error)
			})
		})

		const output = stdout || stderr || "Command executed successfully"

		// Add the command and its output to both the message system and chat context
		const { addMessageAtom } = await import("./ui.js")
		const { chatMessagesAtom } = await import("./extension.js")

		// Display as system message for visibility
		const systemMessage = {
			id: `shell-${Date.now()}`,
			type: "system" as const,
			ts: Date.now(),
			content: `$ ${command}\n${output}`,
			partial: false,
		}
		set(addMessageAtom, systemMessage)

		// Add to chat messages for agent context
		const chatMessage = {
			ts: Date.now(),
			type: "say" as const,
			say: "shell_command",
			text: `Shell command executed:\n$ ${command}\n${output}`,
			partial: false,
		}

		const currentMessages = get(chatMessagesAtom)
		set(chatMessagesAtom, [...currentMessages, chatMessage])
	} catch (error: any) {
		// Handle errors and display them in the message system
		const { addMessageAtom } = await import("./ui.js")
		const { chatMessagesAtom } = await import("./extension.js")

		const errorOutput = `❌ Error: ${error.message}`

		// Display as error message for visibility
		const errorMessage = {
			id: `shell-error-${Date.now()}`,
			type: "error" as const,
			ts: Date.now(),
			content: `$ ${command}\n${errorOutput}`,
			partial: false,
		}
		set(addMessageAtom, errorMessage)

		// Add to chat messages for agent context
		const chatErrorMessage = {
			ts: Date.now(),
			type: "say" as const,
			say: "shell_command_error",
			text: `Shell command failed:\n$ ${command}\n${errorOutput}`,
			partial: false,
		}

		const currentMessages = get(chatMessagesAtom)
		set(chatMessagesAtom, [...currentMessages, chatErrorMessage])
	}

	// Reset history navigation
	set(shellHistoryIndexAtom, -1)
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

	if (callback && typeof callback === "function" && textStr && textStr.trim()) {
		// Call the submission callback
		callback(textStr)

		// Clear input and related state
		set(clearTextBufferAtom)
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

	// Guard against empty options array to prevent NaN from modulo 0
	if (options.length === 0) return

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

				// Get only the missing part to append
				const completionText = getCompletionText(currentText, suggestion)

				// Insert the completion text
				set(insertTextAtom, completionText)
			}
			return

		case "return":
			if (!key.shift && !key.meta && allSuggestions[selectedIndex]) {
				const suggestion = allSuggestions[selectedIndex]
				const currentText = get(textBufferStringAtom)
				const newText = formatSuggestion(suggestion, currentText)
				set(submitInputAtom, newText)
				return
			}
			break

		case "escape":
			set(clearTextBufferAtom)
			return
	}

	handleTextInputKeys(get, set, key)
}

/**
 * History mode keyboard handler
 * Handles navigation through command history
 */
function handleHistoryKeys(get: any, set: any, key: Key): void {
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
async function handleShellKeys(get: any, set: any, key: Key): Promise<void> {
	const { textBufferStringAtom } = await import("./textBuffer.js")
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

		case "backspace":
		case "delete":
		case "left":
		case "right":
			// Let the default text input handlers deal with these
			handleTextInputKeys(get, set, key)
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
function handleTextInputKeys(get: any, set: any, key: Key) {
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
			set(moveLeftAtom)
			return

		case "right":
			set(moveRightAtom)
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
	}

	// Character input
	if (!key.ctrl && !key.meta && key.sequence.length === 1) {
		set(insertCharAtom, key.sequence)
		return
	}

	// Paste
	if (key.paste) {
		// Convert tabs to 2 spaces to prevent border corruption
		// Tabs have variable display widths in terminals which breaks layout
		const normalizedText = key.sequence.replace(/\t/g, "  ")
		set(insertTextAtom, normalizedText)
		return
	}

	return
}

function handleGlobalHotkeys(get: any, set: any, key: Key): boolean {
	switch (key.name) {
		case "c":
			if (key.ctrl) {
				process.exit(0)
			}
			break
		case "x":
			if (key.ctrl) {
				const isStreaming = get(isStreamingAtom)
				if (isStreaming) {
					set(cancelTaskAtom)
				}
				return true
			}
			break
		case "r":
			if (key.ctrl) {
				const hasResumeTask = get(hasResumeTaskAtom)
				if (hasResumeTask) {
					set(resumeTaskAtom)
				}
				return true
			}
			break
		case "shift-1":
			// Toggle shell mode with Shift+1 or Shift+!
			set(toggleShellModeAtom)
			return true
	}
	return false
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

	// Priority 2: Determine current mode and route to mode-specific handler
	const isApprovalPending = get(isApprovalPendingAtom)
	const isFollowupVisible = get(showFollowupSuggestionsAtom)
	const isAutocompleteVisible = get(showAutocompleteAtom)
	const isInHistoryMode = get(historyModeAtom)
	const isShellModeActive = get(shellModeActiveAtom)

	// Mode priority: shell > approval > followup > history > autocomplete > normal
	// History has higher priority than autocomplete because when navigating history,
	// the text buffer may contain commands that start with "/" which would trigger autocomplete
	let mode: InputMode = "normal"
	if (isShellModeActive) mode = "shell"
	else if (isApprovalPending) mode = "approval"
	else if (isFollowupVisible) mode = "followup"
	else if (isInHistoryMode) mode = "history"
	else if (isAutocompleteVisible) mode = "autocomplete"

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

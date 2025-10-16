/**
 * Jotai atoms for centralized keyboard event state management
 */

import { atom } from "jotai"
import type { Key, KeypressHandler } from "../../types/keyboard.js"

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

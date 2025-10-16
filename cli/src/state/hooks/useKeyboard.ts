/**
 * Hook for consuming keyboard events from the centralized KeyboardProvider
 * Simplified API using hotkey definitions
 */

import { useEffect, useRef } from "react"
import { useSetAtom } from "jotai"
import { subscribeToKeyboardAtom } from "../atoms/keypress.js"
import type { Key, KeypressHandler } from "../../types/keyboard.js"
import type { HotkeyDefinition } from "../../constants/keyboard/hotkeys.js"
import { matchesHotkey, isPrintableInput } from "../../utils/hotkey-matcher.js"

/**
 * Handler function for hotkey events
 */
export type HotkeyHandler = () => void

/**
 * Handler function for generic character input
 */
export type InputHandler = (char: string) => void

/**
 * Handler function for paste events
 */
export type PasteHandler = (text: string) => void

/**
 * Hotkey handler entry - maps a hotkey definition to a handler function
 */
export interface HotkeyHandlerEntry {
	hotkey: HotkeyDefinition
	handler: HotkeyHandler
}

/**
 * Hotkey handlers configuration
 */
export interface UseKeyboardHandlers {
	/** Array of hotkey-to-handler mappings */
	hotkeys: HotkeyHandlerEntry[]
	/** Handler for generic character input (printable characters) */
	onInput?: InputHandler
	/** Handler for paste events */
	onPaste?: PasteHandler
}

/**
 * Options for the useKeyboard hook
 */
export interface UseKeyboardOptions {
	/** Whether the hook should be active (default: true) */
	active?: boolean
}

/**
 * Hook for handling keyboard input with hotkey definitions
 *
 * @example
 * ```tsx
 * import { HOTKEYS } from '../../constants/keyboard'
 *
 * function MyComponent() {
 *   const [text, setText] = useState('')
 *
 *   useKeyboard({
 *     hotkeys: [
 *       { hotkey: HOTKEYS.SUBMIT, handler: () => handleSubmit() },
 *       { hotkey: HOTKEYS.NEW_LINE, handler: () => insertNewline() },
 *       { hotkey: HOTKEYS.ESCAPE, handler: () => handleCancel() },
 *     ],
 *     onInput: (char) => setText(prev => prev + char),
 *     onPaste: (text) => setText(prev => prev + text)
 *   }, { active: true })
 * }
 * ```
 */
export function useKeyboard(handlers: UseKeyboardHandlers, options?: UseKeyboardOptions) {
	const subscribe = useSetAtom(subscribeToKeyboardAtom)

	// Use refs to avoid stale closures
	const handlersRef = useRef<UseKeyboardHandlers>(handlers)

	// Update ref when handlers change
	useEffect(() => {
		handlersRef.current = handlers
	}, [handlers])

	// Determine if active
	const isActive = options?.active ?? true

	useEffect(() => {
		if (!isActive) return

		const keyHandler: KeypressHandler = (key: Key) => {
			const currentHandlers = handlersRef.current

			// Priority 1: Handle paste events
			if (key.paste && currentHandlers.onPaste) {
				currentHandlers.onPaste(key.sequence)
				return
			}

			// Priority 2: Check if any hotkey matches
			let hotkeyMatched = false
			for (const entry of currentHandlers.hotkeys) {
				if (matchesHotkey(key, entry.hotkey)) {
					entry.handler()
					hotkeyMatched = true
					break
				}
			}

			// If a hotkey matched, don't process as input
			if (hotkeyMatched) {
				return
			}

			// Priority 3: Handle generic character input
			if (currentHandlers.onInput && isPrintableInput(key)) {
				currentHandlers.onInput(key.sequence)
			}
		}

		// Subscribe to keyboard events
		const unsubscribe = subscribe(keyHandler)
		return unsubscribe
	}, [isActive, subscribe])
}

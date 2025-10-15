/**
 * Key event types and interfaces for the keypress system
 */

/**
 * Represents a parsed key event with all relevant information
 */
export interface Key {
	/** Key name (e.g., 'a', 'return', 'escape', 'up', 'down') */
	name: string
	/** Whether Ctrl modifier is pressed */
	ctrl: boolean
	/** Whether Alt/Meta modifier is pressed */
	meta: boolean
	/** Whether Shift modifier is pressed */
	shift: boolean
	/** Whether this is a paste event containing multiple characters */
	paste: boolean
	/** Raw key sequence as received from terminal */
	sequence: string
	/** Whether this was parsed using Kitty keyboard protocol */
	kittyProtocol?: boolean
}

/**
 * Handler function type for key events
 */
export type KeypressHandler = (key: Key) => void

/**
 * Options for the useKeypress hook
 */
export interface UseKeypressOptions {
	/** Whether the hook should be active (default: true) */
	isActive?: boolean
	/** General key handler for all keys */
	onKey?: KeypressHandler
	/** Handler for Ctrl+C */
	onCtrlC?: () => void
	/** Handler for Ctrl+Return */
	onCtrlReturn?: () => void
	/** Handler for Shift+Enter */
	onShiftEnter?: () => void
	/** Handler for Alt+Enter */
	onAltEnter?: () => void
	/** Handler for Escape key */
	onEscape?: () => void
	/** Handler for paste events */
	onPaste?: (text: string) => void
	/** Handler for Tab key */
	onTab?: () => void
	/** Handler for Shift+Tab */
	onShiftTab?: () => void
	/** Handler for arrow keys */
	onArrowUp?: () => void
	onArrowDown?: () => void
	onArrowLeft?: () => void
	onArrowRight?: () => void
	/** Handler for Enter key (without modifiers) */
	onEnter?: () => void
	/** Handler for Backspace */
	onBackspace?: () => void
	/** Handler for Delete */
	onDelete?: () => void
}

/**
 * Configuration for the KeyboardProvider
 */
export interface KeyboardProviderConfig {
	/** Enable debug logging for keystrokes */
	debugKeystrokeLogging?: boolean
	/** Custom escape code timeout (ms) */
	escapeCodeTimeout?: number
}

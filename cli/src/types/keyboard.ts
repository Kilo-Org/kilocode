/**
 * Key event types and interfaces for the keyboard system
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
 * Represents a key object from Node's readline keypress event
 */
export interface ReadlineKey {
	name?: string
	sequence: string
	ctrl?: boolean
	meta?: boolean
	shift?: boolean
}

/**
 * Handler function type for key events
 */
export type KeypressHandler = (key: Key) => void

/**
 * Configuration for the KeyboardProvider
 */
export interface KeyboardProviderConfig {
	/** Enable debug logging for keystrokes */
	debugKeystrokeLogging?: boolean
	/** Custom escape code timeout (ms) */
	escapeCodeTimeout?: number
}

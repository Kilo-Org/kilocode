import { z } from "zod"

/**
 * Represents a parsed key event with all relevant information
 */
export const keySchema = z.object({
	/** Key name (e.g., 'a', 'return', 'escape', 'up', 'down') */
	name: z.string(),
	/** Whether Ctrl modifier is pressed */
	ctrl: z.boolean(),
	/** Whether Alt/Meta modifier is pressed */
	meta: z.boolean(),
	/** Whether Shift modifier is pressed */
	shift: z.boolean(),
	/** Whether this is a paste event containing multiple characters */
	paste: z.boolean(),
	/** Raw key sequence as received from terminal */
	sequence: z.string(),
	/** Whether this was parsed using Kitty keyboard protocol */
	kittyProtocol: z.boolean().optional(),
})

/**
 * Represents a key object from Node's readline keypress event
 */
export const readlineKeySchema = z.object({
	name: z.string().optional(),
	sequence: z.string(),
	ctrl: z.boolean().optional(),
	meta: z.boolean().optional(),
	shift: z.boolean().optional(),
})

/**
 * Configuration for the KeyboardProvider
 */
export const keyboardProviderConfigSchema = z.object({
	/** Enable debug logging for keystrokes */
	debugKeystrokeLogging: z.boolean().optional(),
	/** Custom escape code timeout (ms) */
	escapeCodeTimeout: z.number().optional(),
})

// Inferred types
export type Key = z.infer<typeof keySchema>
export type ReadlineKey = z.infer<typeof readlineKeySchema>
export type KeyboardProviderConfig = z.infer<typeof keyboardProviderConfigSchema>

/**
 * Handler function type for key events
 */
export type KeypressHandler = (key: Key) => void

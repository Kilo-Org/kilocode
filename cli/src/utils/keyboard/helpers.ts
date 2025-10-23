/**
 * Helper functions for keyboard event handling
 */

import type { Key } from "../../types/keyboard.js"
import { NAVIGATION_KEYS, FALLBACK_PASTE_TIMING } from "../../constants/keyboard/index.js"

/**
 * Check if a key is a navigation key that should never trigger paste detection
 */
export function isNavigationKey(keyName: string | undefined): boolean {
	if (!keyName) return false
	return NAVIGATION_KEYS.includes(keyName as any)
}

/**
 * Check if a key is a newline/return key
 */
export function isNewlineKey(parsedKey: Key): boolean {
	return (
		parsedKey.name === "return" ||
		parsedKey.sequence === "\n" ||
		parsedKey.sequence === "\r" ||
		parsedKey.sequence === "\r\n"
	)
}

/**
 * Check if timing indicates rapid input (likely paste)
 */
export function isRapidInput(timeSinceLastKey: number): boolean {
	return timeSinceLastKey <= FALLBACK_PASTE_TIMING.RAPID_INPUT_THRESHOLD_MS
}

/**
 * Normalize line endings in pasted text
 * Converts \r\n and \r to \n for consistent handling
 */
export function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

/**
 * Check if a sequence is a Shift+Enter escape sequence
 * Some terminals send ESC + Enter for Shift+Enter
 */
export function isShiftEnterSequence(sequence: string): boolean {
	return sequence === "\u001B\r" || sequence === "\u001B\n"
}

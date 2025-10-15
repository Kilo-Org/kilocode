/**
 * Hotkey matching utilities
 *
 * Provides functions to match Key events against HotkeyDefinitions
 */

import type { Key } from "../types/keypress.js"
import type { HotkeyDefinition, KeyCombination } from "../constants/keyboard/hotkeys.js"

/**
 * Checks if a Key matches a single KeyCombination
 *
 * @param key - The key event to check
 * @param combo - The key combination to match against
 * @returns true if the key matches the combination
 */
function matchesKeyCombination(key: Key, combo: KeyCombination): boolean {
	// Key name must match exactly
	if (combo.name !== key.name) {
		return false
	}

	// Check modifiers - undefined means "don't care", true/false means "must match exactly"
	if (combo.ctrl !== undefined && combo.ctrl !== key.ctrl) {
		return false
	}

	if (combo.meta !== undefined && combo.meta !== key.meta) {
		return false
	}

	if (combo.shift !== undefined && combo.shift !== key.shift) {
		return false
	}

	return true
}

/**
 * Checks if a Key matches any combination in a HotkeyDefinition
 *
 * A HotkeyDefinition is an array of KeyCombinations with OR logic:
 * if any combination matches, the hotkey is considered matched.
 *
 * @param key - The key event to check
 * @param hotkey - The hotkey definition to match against
 * @returns true if the key matches any combination in the hotkey
 */
export function matchesHotkey(key: Key, hotkey: HotkeyDefinition): boolean {
	return hotkey.some((combo) => matchesKeyCombination(key, combo))
}

/**
 * Checks if a Key represents a printable character input
 * (not a special key, not a paste event, not a modifier combination)
 *
 * @param key - The key event to check
 * @returns true if this is a regular character input
 */
export function isPrintableInput(key: Key): boolean {
	// Not a paste event
	if (key.paste) {
		return false
	}

	// Not a modifier combination (except shift for uppercase)
	if (key.ctrl || key.meta) {
		return false
	}

	// Must be a single character
	if (key.sequence.length !== 1) {
		return false
	}

	// Not a special key name (special keys have names like 'return', 'escape', etc.)
	// Regular characters typically have single-letter names or the character itself
	// Note: 'space' is NOT in this list because space is a printable character
	const specialKeys = [
		"return",
		"enter",
		"tab",
		"backspace",
		"delete",
		"escape",
		"up",
		"down",
		"left",
		"right",
		"home",
		"end",
		"pageup",
		"pagedown",
		"insert",
	]

	// Check if it's a function key (f1-f12)
	if (key.name.match(/^f\d+$/)) {
		return false
	}

	// If it's a special key, it's not printable input
	if (specialKeys.includes(key.name)) {
		return false
	}

	return true
}

/**
 * Key parsing utilities for terminal input
 * Handles Kitty protocol, legacy ANSI sequences, and special key combinations
 */

import type { Key } from "../../types/keypress.js"
import {
	ESC,
	CSI,
	ALT_KEY_CHARACTER_MAP,
	KITTY_MODIFIER_BASE,
	KITTY_MODIFIER_EVENT_TYPES_OFFSET,
	MODIFIER_SHIFT_BIT,
	MODIFIER_ALT_BIT,
	MODIFIER_CTRL_BIT,
	CHAR_CODE_ESC,
	KITTY_KEYCODE_TAB,
	KITTY_KEYCODE_BACKSPACE,
	KITTY_KEYCODE_ENTER,
	KITTY_KEYCODE_NUMPAD_ENTER,
	KITTY_CSI_U_TERMINATOR,
	KITTY_CSI_TILDE_TERMINATOR,
	PASTE_MODE_PREFIX,
	PASTE_MODE_SUFFIX,
	FOCUS_IN,
	FOCUS_OUT,
} from "../../constants/keyboard/index.js"

/**
 * Result of parsing a key sequence
 */
export interface ParseResult {
	key: Key | null
	consumedLength: number
}

/**
 * Parse a single complete Kitty sequence from the buffer
 * Returns the parsed key and number of characters consumed
 */
export function parseKittySequence(buffer: string): ParseResult {
	// Handle empty buffer
	if (!buffer || buffer.length === 0) {
		return { key: null, consumedLength: 0 }
	}

	// Skip non-CSI sequences
	if (!buffer.startsWith(CSI)) {
		return { key: null, consumedLength: 0 }
	}

	// 1) Reverse Tab (legacy): ESC [ Z
	const revTabLegacy = new RegExp(`^${ESC}\\[Z`)
	let match = buffer.match(revTabLegacy)
	if (match) {
		return {
			key: {
				name: "tab",
				ctrl: false,
				meta: false,
				shift: true,
				paste: false,
				sequence: buffer.slice(0, match[0].length),
				kittyProtocol: true,
			},
			consumedLength: match[0].length,
		}
	}

	// 2) Reverse Tab (parameterized): ESC [ 1 ; <mods> Z
	const revTabParam = new RegExp(`^${ESC}\\[1;(\\d+)Z`)
	match = buffer.match(revTabParam)
	if (match && match[1]) {
		let mods = parseInt(match[1], 10)
		if (mods >= KITTY_MODIFIER_EVENT_TYPES_OFFSET) {
			mods -= KITTY_MODIFIER_EVENT_TYPES_OFFSET
		}
		const bits = mods - KITTY_MODIFIER_BASE
		const alt = (bits & MODIFIER_ALT_BIT) === MODIFIER_ALT_BIT
		const ctrl = (bits & MODIFIER_CTRL_BIT) === MODIFIER_CTRL_BIT
		return {
			key: {
				name: "tab",
				ctrl,
				meta: alt,
				shift: true, // Reverse tab always has shift
				paste: false,
				sequence: buffer.slice(0, match[0].length),
				kittyProtocol: true,
			},
			consumedLength: match[0].length,
		}
	}

	// 3) Parameterized functional keys: ESC [ 1 ; <mods> (A|B|C|D|H|F|P|Q|R|S)
	const arrowPrefix = new RegExp(`^${ESC}\\[1;(\\d+)([ABCDHFPQRS])`)
	match = buffer.match(arrowPrefix)
	if (match && match[1] && match[2]) {
		let mods = parseInt(match[1], 10)
		if (mods >= KITTY_MODIFIER_EVENT_TYPES_OFFSET) {
			mods -= KITTY_MODIFIER_EVENT_TYPES_OFFSET
		}
		const bits = mods - KITTY_MODIFIER_BASE
		const shift = (bits & MODIFIER_SHIFT_BIT) === MODIFIER_SHIFT_BIT
		const alt = (bits & MODIFIER_ALT_BIT) === MODIFIER_ALT_BIT
		const ctrl = (bits & MODIFIER_CTRL_BIT) === MODIFIER_CTRL_BIT
		const sym = match[2]

		const symbolToName: Record<string, string> = {
			A: "up",
			B: "down",
			C: "right",
			D: "left",
			H: "home",
			F: "end",
			P: "f1",
			Q: "f2",
			R: "f3",
			S: "f4",
		}

		const name = symbolToName[sym]
		if (!name) return { key: null, consumedLength: 0 }

		return {
			key: {
				name,
				ctrl,
				meta: alt,
				shift,
				paste: false,
				sequence: buffer.slice(0, match[0].length),
				kittyProtocol: true,
			},
			consumedLength: match[0].length,
		}
	}

	// 4) CSI-u and tilde-coded functional keys: ESC [ <code> ; <mods> (u|~)
	const csiUPrefix = new RegExp(`^${ESC}\\[(\\d+)(;(\\d+))?([u~])`)
	match = buffer.match(csiUPrefix)
	if (match && match[1]) {
		const keyCode = parseInt(match[1], 10)
		let modifiers = match[3] ? parseInt(match[3], 10) : KITTY_MODIFIER_BASE
		if (modifiers >= KITTY_MODIFIER_EVENT_TYPES_OFFSET) {
			modifiers -= KITTY_MODIFIER_EVENT_TYPES_OFFSET
		}
		const modifierBits = modifiers - KITTY_MODIFIER_BASE
		const shift = (modifierBits & MODIFIER_SHIFT_BIT) === MODIFIER_SHIFT_BIT
		const alt = (modifierBits & MODIFIER_ALT_BIT) === MODIFIER_ALT_BIT
		const ctrl = (modifierBits & MODIFIER_CTRL_BIT) === MODIFIER_CTRL_BIT
		const terminator = match[4]

		// Handle tilde-coded functional keys
		if (terminator === KITTY_CSI_TILDE_TERMINATOR) {
			let name: string | null = null
			switch (keyCode) {
				case 1:
					name = "home"
					break
				case 2:
					name = "insert"
					break
				case 3:
					name = "delete"
					break
				case 4:
					name = "end"
					break
				case 5:
					name = "pageup"
					break
				case 6:
					name = "pagedown"
					break
			}
			if (name) {
				return {
					key: {
						name,
						ctrl,
						meta: alt,
						shift,
						paste: false,
						sequence: buffer.slice(0, match[0].length),
						kittyProtocol: true,
					},
					consumedLength: match[0].length,
				}
			}
		}

		// Handle CSI-u format
		if (terminator === KITTY_CSI_U_TERMINATOR) {
			const kittyKeyCodeToName: Record<number, string> = {
				[CHAR_CODE_ESC]: "escape",
				[KITTY_KEYCODE_TAB]: "tab",
				[KITTY_KEYCODE_BACKSPACE]: "backspace",
				[KITTY_KEYCODE_ENTER]: "return",
				// KITTY_KEYCODE_NUMPAD_ENTER has same value as ENTER, so commented out
			}

			const name = kittyKeyCodeToName[keyCode]
			if (name) {
				return {
					key: {
						name,
						ctrl,
						meta: alt,
						shift,
						paste: false,
						sequence: buffer.slice(0, match[0].length),
						kittyProtocol: true,
					},
					consumedLength: match[0].length,
				}
			}

			// Special handling for Enter with modifiers (keyCode 13)
			if (keyCode === 13) {
				return {
					key: {
						name: "return",
						ctrl,
						meta: alt,
						shift,
						paste: false,
						sequence: buffer.slice(0, match[0].length),
						kittyProtocol: true,
					},
					consumedLength: match[0].length,
				}
			}

			// Handle Ctrl/Alt + letters
			if ((ctrl || alt) && keyCode >= "a".charCodeAt(0) && keyCode <= "z".charCodeAt(0)) {
				const letter = String.fromCharCode(keyCode)
				return {
					key: {
						name: letter,
						ctrl,
						meta: alt,
						shift,
						paste: false,
						sequence: buffer.slice(0, match[0].length),
						kittyProtocol: true,
					},
					consumedLength: match[0].length,
				}
			}
		}
	}

	// 5) Legacy function keys (no parameters): ESC [ (A|B|C|D|H|F)
	const legacyFuncKey = new RegExp(`^${ESC}\\[([ABCDHF])`)
	match = buffer.match(legacyFuncKey)
	if (match && match[1]) {
		const sym = match[1]
		const nameMap: Record<string, string> = {
			A: "up",
			B: "down",
			C: "right",
			D: "left",
			H: "home",
			F: "end",
		}
		const name = nameMap[sym] || ""
		if (name) {
			return {
				key: {
					name,
					ctrl: false,
					meta: false,
					shift: false,
					paste: false,
					sequence: buffer.slice(0, match[0].length),
					kittyProtocol: true,
				},
				consumedLength: match[0].length,
			}
		}
	}

	return { key: null, consumedLength: 0 }
}

/**
 * Parse legacy ANSI escape sequences
 */
export function parseLegacySequence(sequence: string): Key | null {
	// Handle arrow keys
	if (sequence === `${ESC}[A`) return { name: "up", ctrl: false, meta: false, shift: false, paste: false, sequence }
	if (sequence === `${ESC}[B`) return { name: "down", ctrl: false, meta: false, shift: false, paste: false, sequence }
	if (sequence === `${ESC}[C`)
		return { name: "right", ctrl: false, meta: false, shift: false, paste: false, sequence }
	if (sequence === `${ESC}[D`) return { name: "left", ctrl: false, meta: false, shift: false, paste: false, sequence }

	// Handle Home/End
	if (sequence === `${ESC}[H`) return { name: "home", ctrl: false, meta: false, shift: false, paste: false, sequence }
	if (sequence === `${ESC}[F`) return { name: "end", ctrl: false, meta: false, shift: false, paste: false, sequence }

	// Handle Page Up/Down
	if (sequence === `${ESC}[5~`)
		return { name: "pageup", ctrl: false, meta: false, shift: false, paste: false, sequence }
	if (sequence === `${ESC}[6~`)
		return { name: "pagedown", ctrl: false, meta: false, shift: false, paste: false, sequence }

	// Handle Delete
	if (sequence === `${ESC}[3~`)
		return { name: "delete", ctrl: false, meta: false, shift: false, paste: false, sequence }

	return null
}

/**
 * Check if a sequence is a paste mode boundary
 */
export function isPasteModeBoundary(sequence: string): {
	isStart: boolean
	isEnd: boolean
} {
	return {
		isStart: sequence === PASTE_MODE_PREFIX,
		isEnd: sequence === PASTE_MODE_SUFFIX,
	}
}

/**
 * Check if a sequence is a focus event
 */
export function isFocusEvent(sequence: string): {
	isFocusIn: boolean
	isFocusOut: boolean
} {
	return {
		isFocusIn: sequence === FOCUS_IN,
		isFocusOut: sequence === FOCUS_OUT,
	}
}

/**
 * Map macOS Alt key characters to their corresponding letters
 */
export function mapAltKeyCharacter(char: string): string | null {
	return ALT_KEY_CHARACTER_MAP[char] || null
}

/**
 * Detect if a character sequence looks like the start of a drag operation
 */
export function isDragStart(sequence: string): boolean {
	return sequence === '"' || sequence === "'"
}

/**
 * Parse a simple key from readline's keypress event
 */
export function parseReadlineKey(key: any): Key {
	// Handle the key object from readline
	return {
		name: key.name || (key.sequence.length === 1 ? key.sequence : ""),
		ctrl: key.ctrl || false,
		meta: key.meta || false,
		shift: key.shift || false,
		paste: false,
		sequence: key.sequence || "",
	}
}

/**
 * Create a paste event key
 */
export function createPasteKey(text: string): Key {
	return {
		name: "",
		ctrl: false,
		meta: false,
		shift: false,
		paste: true,
		sequence: text,
	}
}

/**
 * Create a special event key (for internal use)
 */
export function createSpecialKey(name: string, sequence: string = ""): Key {
	return {
		name,
		ctrl: false,
		meta: false,
		shift: false,
		paste: false,
		sequence,
	}
}

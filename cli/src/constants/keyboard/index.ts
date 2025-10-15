/**
 * Main exports for keypress constants
 */

export * from "./keyCodes.js"
export * from "./sequences.js"
export * from "./kittyProtocol.js"
export * from "./hotkeys.js"

// Alt key character mapping for macOS
// These are the characters produced when Alt is held on macOS
export const ALT_KEY_CHARACTER_MAP: Record<string, string> = {
	"\u00E5": "a", // å
	"\u222B": "b", // ∫
	"\u00E7": "c", // ç
	"\u2202": "d", // ∂
	"\u00B4": "e", // ´
	"\u0192": "f", // ƒ
	"\u00A9": "g", // ©
	"\u02D9": "h", // ˙
	"\u02C6": "i", // ˆ
	"\u2206": "j", // ∆
	"\u02DA": "k", // ˚
	"\u00AC": "l", // ¬
	"\u00B5": "m", // µ
	"\u02DC": "n", // ˜
	"\u00F8": "o", // ø
	"\u03C0": "p", // π
	"\u0153": "q", // œ
	"\u00AE": "r", // ®
	"\u00DF": "s", // ß
	"\u2020": "t", // †
	"\u00A8": "u", // ¨
	"\u221A": "v", // √
	"\u2211": "w", // ∑
	"\u2248": "x", // ≈
	"\u00A5": "y", // ¥
	"\u03A9": "z", // Ω
}

// Common key names used across the system
export const KEY_NAMES = {
	RETURN: "return",
	ENTER: "enter",
	TAB: "tab",
	BACKSPACE: "backspace",
	DELETE: "delete",
	ESCAPE: "escape",
	SPACE: "space",
	UP: "up",
	DOWN: "down",
	LEFT: "left",
	RIGHT: "right",
	HOME: "home",
	END: "end",
	PAGEUP: "pageup",
	PAGEDOWN: "pagedown",
	INSERT: "insert",
	F1: "f1",
	F2: "f2",
	F3: "f3",
	F4: "f4",
	F5: "f5",
	F6: "f6",
	F7: "f7",
	F8: "f8",
	F9: "f9",
	F10: "f10",
	F11: "f11",
	F12: "f12",
} as const

export type KeyName = (typeof KEY_NAMES)[keyof typeof KEY_NAMES]

/**
 * Key code constants for terminal input handling
 */

// ASCII and Unicode key codes
export const CHAR_CODE_NULL = 0
export const CHAR_CODE_CTRL_C = 3
export const CHAR_CODE_BACKSPACE = 8
export const CHAR_CODE_TAB = 9
export const CHAR_CODE_ENTER = 13
export const CHAR_CODE_CTRL_U = 21
export const CHAR_CODE_ESC = 27
export const CHAR_CODE_SPACE = 32
export const CHAR_CODE_EXCLAMATION = 33 // ! character
export const CHAR_CODE_DIGIT_1 = 49 // 1 character
export const CHAR_CODE_DELETE = 127

// Kitty protocol specific key codes
export const KITTY_KEYCODE_TAB = 9
export const KITTY_KEYCODE_BACKSPACE = 127
export const KITTY_KEYCODE_ENTER = 13
export const KITTY_KEYCODE_ESCAPE = 27
export const KITTY_KEYCODE_INSERT = 2
export const KITTY_KEYCODE_DELETE = 3
export const KITTY_KEYCODE_HOME = 1
export const KITTY_KEYCODE_END = 4
export const KITTY_KEYCODE_PAGEUP = 5
export const KITTY_KEYCODE_PAGEDOWN = 6

// Function key codes for Kitty protocol
export const KITTY_KEYCODE_F1 = 11
export const KITTY_KEYCODE_F2 = 12
export const KITTY_KEYCODE_F3 = 13
export const KITTY_KEYCODE_F4 = 14
export const KITTY_KEYCODE_F5 = 15
export const KITTY_KEYCODE_F6 = 17
export const KITTY_KEYCODE_F7 = 18
export const KITTY_KEYCODE_F8 = 19
export const KITTY_KEYCODE_F9 = 20
export const KITTY_KEYCODE_F10 = 21
export const KITTY_KEYCODE_F11 = 23
export const KITTY_KEYCODE_F12 = 24

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

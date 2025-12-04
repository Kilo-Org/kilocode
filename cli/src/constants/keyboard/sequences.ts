/**
 * Escape sequences and special characters for terminal input
 */

// Basic escape sequences
export const ESC = "\u001B"
export const CSI = `${ESC}[`
export const SS3 = `${ESC}O`

// Paste mode sequences (bracketed paste)
export const PASTE_MODE_PREFIX = `${ESC}[200~`
export const PASTE_MODE_SUFFIX = `${ESC}[201~`

// Focus sequences
export const FOCUS_IN = `${ESC}[I`
export const FOCUS_OUT = `${ESC}[O`

// Special characters
export const SINGLE_QUOTE = "'"
export const DOUBLE_QUOTE = '"'
export const BACKSLASH = "\\"

// Control characters
export const CTRL_C = "\u0003"
export const CTRL_D = "\u0004"
export const CTRL_Z = "\u001A"

// Common ANSI escape sequences
export const CURSOR_UP = `${CSI}A`
export const CURSOR_DOWN = `${CSI}B`
export const CURSOR_RIGHT = `${CSI}C`
export const CURSOR_LEFT = `${CSI}D`
export const CURSOR_HOME = `${CSI}H`
export const CURSOR_END = `${CSI}F`

// Delete sequences
export const DELETE_CHAR = `${CSI}3~`
export const DELETE_LINE = `${CSI}2K`

// Page navigation
export const PAGE_UP = `${CSI}5~`
export const PAGE_DOWN = `${CSI}6~`

// Function keys (legacy)
export const F1 = `${SS3}P`
export const F2 = `${SS3}Q`
export const F3 = `${SS3}R`
export const F4 = `${SS3}S`

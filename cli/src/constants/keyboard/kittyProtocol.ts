/**
 * Kitty keyboard protocol constants
 * Based on: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 */

// Kitty protocol modifier constants
export const KITTY_MODIFIER_BASE = 1
export const KITTY_MODIFIER_EVENT_TYPES_OFFSET = 128

// Modifier bit flags
export const MODIFIER_SHIFT_BIT = 1
export const MODIFIER_ALT_BIT = 2
export const MODIFIER_CTRL_BIT = 4
export const MODIFIER_SUPER_BIT = 8
export const MODIFIER_HYPER_BIT = 16
export const MODIFIER_META_BIT = 32
export const MODIFIER_CAPS_LOCK_BIT = 64
export const MODIFIER_NUM_LOCK_BIT = 128

// Event type flags (added to modifier value)
export const EVENT_TYPE_PRESS = 1
export const EVENT_TYPE_REPEAT = 2
export const EVENT_TYPE_RELEASE = 3

// Timing constants
export const BACKSLASH_ENTER_DETECTION_WINDOW_MS = 50
export const PASTE_DETECTION_TIMEOUT_MS = 10
export const MAX_KITTY_SEQUENCE_LENGTH = 32
export const KITTY_SEQUENCE_OVERFLOW_THRESHOLD = 64

// Special Kitty sequences
export const KITTY_CTRL_C = "\u0003"

// Kitty CSI-u format markers
export const KITTY_CSI_U_TERMINATOR = "u"
export const KITTY_CSI_TILDE_TERMINATOR = "~"

// Kitty protocol version
export const KITTY_PROTOCOL_VERSION = 1

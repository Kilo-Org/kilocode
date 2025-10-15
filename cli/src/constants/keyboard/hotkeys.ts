/**
 * Hotkey definitions for the keyboard system
 *
 * This file contains predefined hotkey combinations that can be used throughout the application.
 * Each hotkey is defined as an array of key combinations (OR logic - any match triggers the hotkey).
 */

/**
 * Represents a single key combination with optional modifiers
 */
export interface KeyCombination {
	/** Key name (e.g., 'return', 'a', 'escape') */
	name: string
	/** Ctrl modifier (undefined = don't care, true/false = must match exactly) */
	ctrl?: boolean
	/** Alt/Meta modifier (undefined = don't care, true/false = must match exactly) */
	meta?: boolean
	/** Shift modifier (undefined = don't care, true/false = must match exactly) */
	shift?: boolean
}

/**
 * A hotkey definition is an array of key combinations.
 * If any combination matches, the hotkey is triggered (OR logic).
 */
export type HotkeyDefinition = KeyCombination[]

/**
 * Predefined hotkeys used throughout the application
 */
export const HOTKEYS = {
	// ============================================================================
	// Submit Actions
	// ============================================================================

	/** Plain Enter key (no modifiers) - typically used for single-line submit */
	SEND: [{ name: "return", ctrl: false, meta: false, shift: false }] as HotkeyDefinition,

	/** Shift+Enter or Alt+Enter - typically used for newline in multiline input */
	NEW_LINE: [
		{ name: "return", shift: true },
		{ name: "return", meta: true },
	] as HotkeyDefinition,

	// ============================================================================
	// Navigation Keys
	// ============================================================================

	/** Up arrow key */
	ARROW_UP: [{ name: "up" }] as HotkeyDefinition,

	/** Down arrow key */
	ARROW_DOWN: [{ name: "down" }] as HotkeyDefinition,

	/** Left arrow key */
	ARROW_LEFT: [{ name: "left" }] as HotkeyDefinition,

	/** Right arrow key */
	ARROW_RIGHT: [{ name: "right" }] as HotkeyDefinition,

	// ============================================================================
	// Text Editing
	// ============================================================================

	/** Backspace key */
	BACKSPACE: [{ name: "backspace" }] as HotkeyDefinition,

	/** Delete key */
	DELETE: [{ name: "delete" }] as HotkeyDefinition,

	/** Delete word - Ctrl+W or Alt+Backspace (macOS style) */
	DELETE_WORD: [
		{ name: "w", ctrl: true },
		{ name: "backspace", meta: true },
	] as HotkeyDefinition,

	// ============================================================================
	// Line Operations (Emacs-style)
	// ============================================================================

	/** Move to line start - Ctrl+A */
	LINE_START: [{ name: "a", ctrl: true }] as HotkeyDefinition,

	/** Move to line end - Ctrl+E */
	LINE_END: [{ name: "e", ctrl: true }] as HotkeyDefinition,

	/** Kill line from cursor to end - Ctrl+K */
	KILL_LINE: [{ name: "k", ctrl: true }] as HotkeyDefinition,

	/** Kill line from start to cursor - Ctrl+U */
	KILL_LINE_LEFT: [{ name: "u", ctrl: true }] as HotkeyDefinition,

	// ============================================================================
	// General Actions
	// ============================================================================

	/** Escape key - typically used for cancel/clear */
	ESCAPE: [{ name: "escape" }] as HotkeyDefinition,

	/** Cancel task - Ctrl+X */
	CANCEL_TASK: [{ name: "x", ctrl: true }] as HotkeyDefinition,

	/** Resume task - Ctrl+R */
	RESUME_TASK: [{ name: "r", ctrl: true }] as HotkeyDefinition,

	/** Tab key (without shift) */
	TAB: [{ name: "tab", shift: false }] as HotkeyDefinition,

	/** Shift+Tab */
	SHIFT_TAB: [{ name: "tab", shift: true }] as HotkeyDefinition,

	// ============================================================================
	// Approval Shortcuts
	// ============================================================================

	/** Approve with 'y' key */
	APPROVE_YES: [{ name: "y" }] as HotkeyDefinition,

	/** Reject with 'n' key */
	APPROVE_NO: [{ name: "n" }] as HotkeyDefinition,

	// ============================================================================
	// Control Characters
	// ============================================================================

	/** Ctrl+C - typically used for interrupt/cancel */
	EXIT: [{ name: "c", ctrl: true }] as HotkeyDefinition,
} as const

/**
 * Type representing all available hotkey names
 */
export type HotkeyName = keyof typeof HOTKEYS

/**
 * Terminal type constants and capabilities
 */

// Terminal type identifiers
export const TERMINAL_TYPES = {
	ITERM2: "iterm2",
	TERMINAL_APP: "terminal.app",
	VSCODE: "vscode",
	GHOSTTY: "ghostty",
	KITTY: "kitty",
	ALACRITTY: "alacritty",
	WEZTERM: "wezterm",
	XTERM: "xterm",
	UNKNOWN: "unknown",
} as const

export type TerminalType = (typeof TERMINAL_TYPES)[keyof typeof TERMINAL_TYPES]

// Terminals that support Kitty keyboard protocol
export const KITTY_PROTOCOL_SUPPORTED_TERMINALS: readonly TerminalType[] = [
	TERMINAL_TYPES.KITTY,
	TERMINAL_TYPES.WEZTERM,
	TERMINAL_TYPES.ALACRITTY,
	TERMINAL_TYPES.GHOSTTY,
] as const

// Terminals that require fallback paste detection
export const FALLBACK_PASTE_REQUIRED_TERMINALS: readonly TerminalType[] = [TERMINAL_TYPES.VSCODE] as const

// Navigation keys that should never trigger paste detection
export const NAVIGATION_KEYS = [
	"up",
	"down",
	"left",
	"right",
	"home",
	"end",
	"pageup",
	"pagedown",
	"tab",
	"escape",
	"backspace",
	"delete",
	"f1",
	"f2",
	"f3",
	"f4",
	"f5",
	"f6",
	"f7",
	"f8",
	"f9",
	"f10",
	"f11",
	"f12",
] as const

export type NavigationKey = (typeof NAVIGATION_KEYS)[number]

// Timing constants for paste detection
export const FALLBACK_PASTE_TIMING = {
	/** Maximum time between keypresses to consider as paste (ms) */
	RAPID_INPUT_THRESHOLD_MS: 20,
	/** Timeout to complete paste after input stops (ms) */
	COMPLETION_TIMEOUT_MS: 100,
} as const

// Minimum Node.js version for proper paste support
export const MIN_NODE_VERSION_FOR_PASTE = 20

/**
 * Terminal capability detection utilities
 * Detects support for Kitty keyboard protocol and other advanced features
 */

import {
	TERMINAL_TYPES,
	KITTY_PROTOCOL_SUPPORTED_TERMINALS,
	FALLBACK_PASTE_REQUIRED_TERMINALS,
	MIN_NODE_VERSION_FOR_PASTE,
	type TerminalType,
} from "../../constants/keyboard/index.js"

/**
 * Detect terminal type from environment variables
 */
export function detectTerminalType(): TerminalType {
	const term = process.env.TERM || ""
	const termProgram = process.env.TERM_PROGRAM || ""

	if (termProgram.includes("iTerm")) return TERMINAL_TYPES.ITERM2
	if (termProgram.includes("Apple_Terminal")) return TERMINAL_TYPES.TERMINAL_APP
	if (termProgram.includes("vscode")) return TERMINAL_TYPES.VSCODE
	if (termProgram.includes("ghostty")) return TERMINAL_TYPES.GHOSTTY
	if (term.includes("kitty")) return TERMINAL_TYPES.KITTY
	if (term.includes("alacritty")) return TERMINAL_TYPES.ALACRITTY
	if (term.includes("wezterm")) return TERMINAL_TYPES.WEZTERM
	if (term.includes("xterm")) return TERMINAL_TYPES.XTERM

	return TERMINAL_TYPES.UNKNOWN
}

/**
 * Get the major version of Node.js
 */
function getNodeMajorVersion(): number {
	const versionParts = process.versions.node.split(".")
	return versionParts[0] ? parseInt(versionParts[0], 10) : MIN_NODE_VERSION_FOR_PASTE
}

/**
 * Check if terminal likely requires fallback support
 */
export function detectFallbackSupport(): boolean {
	const nodeMajorVersion = getNodeMajorVersion()
	const termType = detectTerminalType()

	return FALLBACK_PASTE_REQUIRED_TERMINALS.includes(termType) || nodeMajorVersion < MIN_NODE_VERSION_FOR_PASTE
}

/**
 * Check if terminal is likely to support Kitty protocol based on type
 */
export function detectKittyProtocolSupport(): boolean {
	const termType = detectTerminalType()
	return KITTY_PROTOCOL_SUPPORTED_TERMINALS.includes(termType)
}

/**
 * Auto-detect and enable Kitty protocol if supported
 * Returns true if enabled, false otherwise
 */
export function autoEnableKittyProtocol(): boolean {
	const isSupported = detectKittyProtocolSupport()

	if (isSupported) {
		enableKittyProtocol()
		return true
	}

	return false
}

/**
 * Enable Kitty keyboard protocol
 */
function enableKittyProtocol(): void {
	// CSI > 1 u - Enable disambiguate escape codes
	process.stdout.write("\x1b[>1u")
	// CSI = 1 ; 1 u - Push keyboard flags, enable disambiguate
	process.stdout.write("\x1b[=1;1u")
}

/**
 * Disable Kitty keyboard protocol
 */
export function disableKittyProtocol(): void {
	// CSI < 1 u - Pop keyboard flags (disable)
	process.stdout.write("\x1b[<1u")
}

/**
 * Terminal capability detection utilities
 * Detects support for Kitty keyboard protocol and other advanced features
 */

const TERMINALS = {
	ITERM2: "iterm2",
	TERMINAL_APP: "terminal.app",
	VSCODE: "vscode",
	GHOSTTY: "ghostty",
	KITTY: "kitty",
	ALACRITTY: "alacritty",
	WEZTERM: "wezterm",
	XTERM: "xterm",
	UNKNOWN: "unknown",
}

const TERMINALS_WITH_KITTY_PROTOCOL_SUPPORT = [
	TERMINALS.KITTY,
	TERMINALS.WEZTERM,
	TERMINALS.ALACRITTY,
	TERMINALS.GHOSTTY,
]

const TERMINALS_REQUIRING_PASTE_FALLBACK = [TERMINALS.VSCODE]

/**
 * Detect terminal type from environment variables
 */
export function detectTerminalType(): string {
	const term = process.env.TERM || ""
	const termProgram = process.env.TERM_PROGRAM || ""

	if (termProgram.includes("iTerm")) return "iterm2"
	if (termProgram.includes("Apple_Terminal")) return "terminal.app"
	if (termProgram.includes("vscode")) return "vscode"
	if (termProgram.includes("ghostty")) return "ghostty"
	if (term.includes("kitty")) return "kitty"
	if (term.includes("alacritty")) return "alacritty"
	if (term.includes("wezterm")) return "wezterm"
	if (term.includes("xterm")) return "xterm"

	return "unknown"
}

/**
 * Check if terminal likely requires fallback support
 */
export function detectFallbackSupport(): boolean {
	const nodeVersionParts = process.versions.node.split(".")
	const nodeMajorVersion = nodeVersionParts[0] ? parseInt(nodeVersionParts[0], 10) : 20
	const termType = detectTerminalType()
	return TERMINALS_REQUIRING_PASTE_FALLBACK.includes(termType) || nodeMajorVersion < 20
}

/**
 * Check if terminal is likely to support Kitty protocol based on type
 */
export function detectKittyProtocolSupport(): boolean {
	const termType = detectTerminalType()
	return TERMINALS_WITH_KITTY_PROTOCOL_SUPPORT.includes(termType)
}

/**
 * Auto-detect and enable Kitty protocol if supported
 * Returns true if enabled, false otherwise
 */
export function autoEnableKittyProtocol(): boolean {
	// Query terminal for actual support
	const isSupported = detectKittyProtocolSupport()

	if (isSupported) {
		// Enable Kitty keyboard protocol
		// CSI > 1 u - Enable disambiguate escape codes
		process.stdout.write("\x1b[>1u")
		// CSI = 1 ; 1 u - Push keyboard flags, enable disambiguate
		process.stdout.write("\x1b[=1;1u")
		return true
	}

	return false
}

/**
 * Disable Kitty keyboard protocol
 */
export function disableKittyProtocol(): void {
	// CSI < 1 u - Pop keyboard flags (disable)
	process.stdout.write("\x1b[<1u")
}

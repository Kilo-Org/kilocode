/**
 * Terminal capability detection utilities
 * Detects support for Kitty keyboard protocol and other advanced features
 */

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
 * Check if terminal is likely to support Kitty protocol based on type
 */
export function detectKittyProtocolSupport(): boolean {
	const termType = detectTerminalType()

	// Known terminals with Kitty protocol support
	const supportedTerminals = ["kitty", "wezterm", "alacritty", "ghostty"]
	return supportedTerminals.includes(termType)
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

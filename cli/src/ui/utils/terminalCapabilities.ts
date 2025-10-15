/**
 * Terminal capability detection utilities
 * Detects support for Kitty keyboard protocol and other advanced features
 */

/**
 * Query terminal for Kitty keyboard protocol support
 * Returns a promise that resolves to true if supported, false otherwise
 */
export async function detectKittyProtocolSupport(): Promise<boolean> {
	return new Promise((resolve) => {
		// Set a timeout in case terminal doesn't respond
		const timeout = setTimeout(() => {
			resolve(false)
		}, 100) // 100ms timeout

		// Listen for terminal response
		const onData = (data: Buffer) => {
			const response = data.toString()

			// Check for Kitty protocol query response
			// Response format: ESC [ ? <flags> u
			if (response.match(/\x1b\[\?(\d+)u/)) {
				clearTimeout(timeout)
				process.stdin.removeListener("data", onData)
				resolve(true)
				return
			}
		}

		// Setup listener
		process.stdin.on("data", onData)

		// Query terminal for keyboard protocol support
		// CSI ? u - Query keyboard protocol
		process.stdout.write("\x1b[?u")
	})
}

/**
 * Detect terminal type from environment variables
 */
export function detectTerminalType(): string {
	const term = process.env.TERM || ""
	const termProgram = process.env.TERM_PROGRAM || ""

	if (termProgram.includes("iTerm")) return "iterm2"
	if (termProgram.includes("Apple_Terminal")) return "terminal.app"
	if (termProgram.includes("vscode")) return "vscode"
	if (term.includes("kitty")) return "kitty"
	if (term.includes("alacritty")) return "alacritty"
	if (term.includes("wezterm")) return "wezterm"
	if (term.includes("xterm")) return "xterm"

	return "unknown"
}

/**
 * Check if terminal is likely to support Kitty protocol based on type
 */
export function isLikelyKittyProtocolSupported(): boolean {
	const termType = detectTerminalType()

	// Known terminals with Kitty protocol support
	const supportedTerminals = ["kitty", "wezterm", "alacritty"]

	return supportedTerminals.includes(termType)
}

/**
 * Auto-detect and enable Kitty protocol if supported
 * Returns true if enabled, false otherwise
 */
export async function autoEnableKittyProtocol(): Promise<boolean> {
	// First check if likely supported based on terminal type
	if (!isLikelyKittyProtocolSupported()) {
		// Still try to detect, but less likely to succeed
	}

	// Query terminal for actual support
	const isSupported = await detectKittyProtocolSupport()

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

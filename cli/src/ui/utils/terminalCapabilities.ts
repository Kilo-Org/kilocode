/**
 * Terminal capability detection utilities
 * Detects support for Kitty keyboard protocol and other advanced features
 */

// kilocode_change: Track terminal type for specialized handling
let detectedTerminal: string | null = null

/**
 * Detect the terminal type from environment variables
 */
function detectTerminalType(): string {
	if (detectedTerminal) {
		return detectedTerminal
	}

	// Check common terminal environment variables
	const termProgram = process.env.TERM_PROGRAM
	const term = process.env.TERM
	const ghostty = process.env.GHOSTTY_RESOURCES_DIR

	// Detect Ghostty
	if (ghostty || termProgram === "ghostty" || term?.includes("ghostty")) {
		detectedTerminal = "ghostty"
		return "ghostty"
	}

	// Detect iTerm2
	if (termProgram === "iTerm.app") {
		detectedTerminal = "iterm"
		return "iterm"
	}

	// Detect WezTerm
	if (termProgram === "WezTerm") {
		detectedTerminal = "wezterm"
		return "wezterm"
	}

	// Detect Alacritty
	if (term?.includes("alacritty")) {
		detectedTerminal = "alacritty"
		return "alacritty"
	}

	detectedTerminal = "unknown"
	return "unknown"
}

/**
 * Check if running in Ghostty terminal
 */
export function isGhosttyTerminal(): boolean {
	return detectTerminalType() === "ghostty"
}

/**
 * Get the detected terminal type
 */
export function getTerminalType(): string {
	return detectTerminalType()
}

/**
 * Check if terminal supports Kitty protocol
 * Partially copied from gemini-cli
 */
let kittyDetected = false
let kittySupported = false

export async function detectKittyProtocolSupport(): Promise<boolean> {
	if (kittyDetected) {
		return kittySupported
	}

	return new Promise((resolve) => {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			kittyDetected = true
			resolve(false)
			return
		}

		const originalRawMode = process.stdin.isRaw
		if (!originalRawMode) {
			process.stdin.setRawMode(true)
		}

		let responseBuffer = ""
		let progressiveEnhancementReceived = false
		let timeoutId: NodeJS.Timeout | undefined

		const onTimeout = () => {
			timeoutId = undefined
			process.stdin.removeListener("data", handleData)
			if (!originalRawMode) {
				process.stdin.setRawMode(false)
			}
			kittyDetected = true
			resolve(false)
		}

		const handleData = (data: Buffer) => {
			if (timeoutId === undefined) {
				// Race condition. We have already timed out.
				return
			}
			responseBuffer += data.toString()

			// Check for progressive enhancement response (CSI ? <flags> u)
			if (responseBuffer.includes("\x1b[?") && responseBuffer.includes("u")) {
				progressiveEnhancementReceived = true
				// Give more time to get the full set of kitty responses if we have an
				// indication the terminal probably supports kitty and we just need to
				// wait a bit longer for a response.
				clearTimeout(timeoutId)
				timeoutId = setTimeout(onTimeout, 1000)
			}

			// Check for device attributes response (CSI ? <attrs> c)
			if (responseBuffer.includes("\x1b[?") && responseBuffer.includes("c")) {
				clearTimeout(timeoutId)
				timeoutId = undefined
				process.stdin.removeListener("data", handleData)

				if (!originalRawMode) {
					process.stdin.setRawMode(false)
				}

				if (progressiveEnhancementReceived) {
					kittySupported = true
				}

				kittyDetected = true
				resolve(kittySupported)
			}
		}

		process.stdin.on("data", handleData)

		// Send queries
		process.stdout.write("\x1b[?u") // Query progressive enhancement
		process.stdout.write("\x1b[c") // Query device attributes

		// Timeout after 200ms
		// When a iterm2 terminal does not have focus this can take over 90s on a
		// fast macbook so we need a somewhat longer threshold than would be ideal.
		timeoutId = setTimeout(onTimeout, 200)
	})
}

/**
 * Auto-detect and enable Kitty protocol if supported
 * Returns true if enabled, false otherwise
 */
export async function autoEnableKittyProtocol(): Promise<boolean> {
	// kilocode_change: Always enable Kitty protocol for Ghostty
	// Ghostty fully supports the Kitty keyboard protocol and it resolves
	// the "9u" character display issue by providing proper key codes
	const terminalType = detectTerminalType()
	if (terminalType === "ghostty") {
		// Enable Kitty keyboard protocol with flags 1 and 2
		// Flag 1: Disambiguate escape codes
		// Flag 2: Report event types (press/repeat/release)
		process.stdout.write("\x1b[>3u")
		process.on("exit", disableGhosttyKittyProtocol)
		process.on("SIGTERM", disableGhosttyKittyProtocol)
		return true
	}

	// Query terminal for actual support
	const isSupported = await detectKittyProtocolSupport()

	if (isSupported) {
		// Enable Kitty keyboard protocol with flag 1 (disambiguate escape codes)
		// CSI > <flags> u - Enable keyboard protocol with specified flags
		// Using only flag 1 for maximum compatibility across terminals (Kitty, Ghostty, Alacritty, WezTerm)
		// See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#progressive-enhancement
		process.stdout.write("\x1b[>1u")

		process.on("exit", disableKittyProtocol)
		process.on("SIGTERM", disableKittyProtocol)
		return true
	}

	return false
}

/**
 * Disable Kitty keyboard protocol
 * Must use the same flag value as enable (flag 1 or 3 for Ghostty)
 */
export function disableKittyProtocol(): void {
	// CSI < <flags> u - Disable keyboard protocol with specified flags
	process.stdout.write("\x1b[<1u")
}

/**
 * kilocode_change: Disable Ghostty's Kitty protocol with flag 3
 * Ghostty uses flags 1+2=3, so we need to disable with the same value
 */
export function disableGhosttyKittyProtocol(): void {
	// CSI < 3 u - Disable keyboard protocol with flags 1+2
	process.stdout.write("\x1b[<3u")
}

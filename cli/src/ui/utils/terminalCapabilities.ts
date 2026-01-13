/**
 * Terminal capability detection utilities
 * Detects support for Kitty keyboard protocol and other advanced features
 * Also handles Windows terminal compatibility for proper display rendering
 */

/**
 * Check if running on Windows platform
 */
export function isWindowsTerminal(): boolean {
	return process.platform === "win32"
}

/**
 * Get the appropriate terminal clear sequence for the current platform
 *
 * On Windows cmd.exe, the \x1b[3J (clear scrollback buffer) escape sequence
 * is not properly supported and can cause display artifacts like raw escape
 * sequences appearing in the output (e.g., [\r\n\t...]).
 *
 * This function returns a platform-appropriate clear sequence:
 * - Windows: \x1b[2J\x1b[H (clear screen + cursor home)
 * - Unix/Mac: \x1b[2J\x1b[3J\x1b[H (clear screen + clear scrollback + cursor home)
 */
export function getTerminalClearSequence(): string {
	if (isWindowsTerminal()) {
		// Windows cmd.exe doesn't properly support \x1b[3J (clear scrollback)
		// Using only clear screen and cursor home to avoid display artifacts
		return "\x1b[2J\x1b[H"
	}
	// Full clear sequence for Unix/Mac terminals
	return "\x1b[2J\x1b[3J\x1b[H"
}

/**
 * Normalize line endings for internal processing
 * Converts all line endings to LF (\n) for consistent internal handling
 */
export function normalizeLineEndings(text: string): string {
	// Convert CRLF to LF, then any remaining CR to LF
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

/**
 * Normalize line endings for terminal output
 * On Windows, converts LF to CRLF for proper display in cmd.exe
 * On Unix/Mac, returns the text unchanged
 *
 * This prevents display artifacts where bare LF characters cause
 * improper line rendering in Windows terminals.
 */
export function normalizeLineEndingsForOutput(text: string): string {
	if (isWindowsTerminal()) {
		// First normalize to LF, then convert to CRLF for Windows
		// This prevents double-conversion of already CRLF strings
		const normalized = normalizeLineEndings(text)
		return normalized.replace(/\n/g, "\r\n")
	}
	return text
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
 * Must use the same flag value as enable (flag 1)
 */
export function disableKittyProtocol(): void {
	// CSI < <flags> u - Disable keyboard protocol with specified flags
	process.stdout.write("\x1b[<1u")
}

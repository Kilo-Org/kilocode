/**
 * Terminal capability detection utilities
 * Detects support for Kitty keyboard protocol and other advanced features
 * Also handles Windows terminal compatibility for proper display rendering
 */

/**
 * Check if running on Windows platform
 */
export function isWindows(): boolean {
	return process.platform === "win32"
}

/**
 * Check if the terminal supports the scrollback clear escape sequence (\x1b[3J)
 *
 * Modern terminals like Windows Terminal and VS Code's integrated terminal
 * support this sequence, but legacy cmd.exe does not.
 *
 * Detection is based on environment variables:
 * - WT_SESSION: Set by Windows Terminal
 * - TERM_PROGRAM === 'vscode': Set by VS Code's integrated terminal
 * - Non-Windows platforms: Generally support it
 */
export function supportsScrollbackClear(): boolean {
	// Windows Terminal sets WT_SESSION env var
	if (process.env.WT_SESSION) {
		return true
	}
	// VS Code integrated terminal
	if (process.env.TERM_PROGRAM === "vscode") {
		return true
	}
	// Default: Unix/Mac support it, Windows cmd.exe doesn't
	return !isWindows()
}

/**
 * Check if the terminal supports OSC sequences for setting window title (\x1b]0;title\x07)
 *
 * Modern terminals support OSC 0 for title setting, but legacy cmd.exe does not.
 * This uses the same detection logic as scrollback clearing since unsupported
 * terminals are the same.
 */
export function supportsTitleSetting(): boolean {
	return supportsScrollbackClear()
}

/**
 * Get the appropriate terminal clear sequence for the current terminal
 *
 * On Windows cmd.exe, the \x1b[3J (clear scrollback buffer) escape sequence
 * is not properly supported and can cause display artifacts like raw escape
 * sequences appearing in the output (e.g., [\r\n\t...]).
 *
 * Modern terminals (Windows Terminal, VS Code) support the full sequence.
 *
 * This function returns a terminal-appropriate clear sequence:
 * - Legacy Windows (cmd.exe): \x1b[2J\x1b[H (clear screen + cursor home)
 * - Modern terminals: \x1b[2J\x1b[3J\x1b[H (clear screen + clear scrollback + cursor home)
 */
export function getTerminalClearSequence(): string {
	if (!supportsScrollbackClear()) {
		// Legacy Windows cmd.exe doesn't properly support \x1b[3J (clear scrollback)
		// Using only clear screen and cursor home to avoid display artifacts
		return "\x1b[2J\x1b[H"
	}
	// Full clear sequence for modern terminals
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
 * On Windows (without modern terminal), converts LF to CRLF for proper display in cmd.exe
 * On modern terminals, returns the text unchanged
 *
 * This prevents display artifacts where bare LF characters cause
 * improper line rendering in legacy Windows terminals.
 */
export function normalizeLineEndingsForOutput(text: string): string {
	// Only convert for legacy Windows terminals (not Windows Terminal or VS Code)
	if (isWindows() && !process.env.WT_SESSION && process.env.TERM_PROGRAM !== "vscode") {
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

		// Skip Kitty protocol detection on legacy Windows terminals (cmd.exe)
		// These terminals don't support the CSI queries and will display raw escape sequences
		if (!supportsScrollbackClear()) {
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

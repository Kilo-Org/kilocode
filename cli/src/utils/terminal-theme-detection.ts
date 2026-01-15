/**
 * Terminal Theme Detection Utility
 *
 * Detects whether the terminal is using a light or dark color scheme.
 * Uses multiple detection methods with fallbacks:
 *
 * 1. COLORFGBG environment variable (rxvt, xterm, etc.)
 * 2. Terminal-specific environment variables
 * 3. OSC 11 escape sequence query (xterm-compatible terminals)
 * 4. macOS defaults for Terminal.app
 *
 * @see https://github.com/Kilo-Org/kilocode/issues - Theme detection known issue
 */

import { execSync } from "child_process"
import { logs } from "../services/logs.js"

export type TerminalThemeType = "dark" | "light"

/**
 * ANSI color codes considered "dark" (0-7 are standard colors, 0 is black)
 * Colors 0-7 with low values (0, 1, 4, 5) are typically dark backgrounds
 */
const DARK_ANSI_COLORS = new Set([
	0, 1, 4, 5, 8, 16, 17, 18, 19, 52, 53, 54, 55, 232, 233, 234, 235, 236, 237, 238, 239,
])

/**
 * ANSI color codes considered "light" (7 is white, 15 is bright white)
 */
const LIGHT_ANSI_COLORS = new Set([7, 15, 145, 146, 147, 188, 189, 190, 231, 250, 251, 252, 253, 254, 255])

/**
 * Parse COLORFGBG environment variable
 * Format: "foreground;background" or "foreground;background;cursor"
 * Values are ANSI color codes (0-255)
 *
 * @example "15;0" - white on black (dark theme)
 * @example "0;15" - black on white (light theme)
 */
function parseColorFgBg(value: string): TerminalThemeType | null {
	const parts = value.split(";")
	if (parts.length < 2) {
		return null
	}

	const bgColor = parseInt(parts[1], 10)
	if (isNaN(bgColor)) {
		return null
	}

	// Check against known dark/light colors
	if (DARK_ANSI_COLORS.has(bgColor)) {
		return "dark"
	}
	if (LIGHT_ANSI_COLORS.has(bgColor)) {
		return "light"
	}

	// For extended colors (16-231), use a heuristic based on the color cube
	// Colors 16-231 form a 6x6x6 color cube
	if (bgColor >= 16 && bgColor <= 231) {
		const cubeIndex = bgColor - 16
		const r = Math.floor(cubeIndex / 36)
		const g = Math.floor((cubeIndex % 36) / 6)
		const b = cubeIndex % 6

		// Calculate perceived luminance (simplified)
		const luminance = 0.299 * r + 0.587 * g + 0.114 * b
		return luminance < 2.5 ? "dark" : "light"
	}

	// For grayscale colors (232-255)
	if (bgColor >= 232 && bgColor <= 255) {
		const grayLevel = bgColor - 232 // 0-23
		return grayLevel < 12 ? "dark" : "light"
	}

	return null
}

/**
 * Calculate luminance from RGB values (0-65535 range as returned by OSC queries)
 * Uses the standard luminance formula
 */
function calculateLuminance(r: number, g: number, b: number): number {
	// Normalize to 0-1 range
	const rNorm = r / 65535
	const gNorm = g / 65535
	const bNorm = b / 65535

	// Calculate relative luminance using sRGB formula
	return 0.2126 * rNorm + 0.7152 * gNorm + 0.0722 * bNorm
}

/**
 * Parse OSC 11 response to extract background color
 * Response format: "\x1b]11;rgb:RRRR/GGGG/BBBB\x1b\\" or "\x1b]11;rgb:RRRR/GGGG/BBBB\x07"
 */
function parseOscResponse(response: string): TerminalThemeType | null {
	// Match rgb:XXXX/XXXX/XXXX pattern (4 hex digits per component)
	const match = response.match(/rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/)
	if (!match) {
		return null
	}

	// Parse hex values and normalize to 16-bit range
	const parseHex = (hex: string): number => {
		const value = parseInt(hex, 16)
		// If 2 digits, scale to 16-bit; if 4 digits, use as-is
		return hex.length === 2 ? value * 257 : value
	}

	const r = parseHex(match[1])
	const g = parseHex(match[2])
	const b = parseHex(match[3])

	const luminance = calculateLuminance(r, g, b)

	// Threshold at 0.5 luminance
	return luminance < 0.5 ? "dark" : "light"
}

/**
 * Check terminal-specific environment variables for theme hints
 */
function checkTerminalEnvVars(): TerminalThemeType | null {
	// Check TERM_PROGRAM for known terminals with theme indicators
	const termProgram = process.env.TERM_PROGRAM?.toLowerCase()

	// VS Code integrated terminal
	if (termProgram === "vscode") {
		// VS Code sets VSCODE_TERMINAL_THEME or we can check the color theme
		const vscodeTheme = process.env.VSCODE_TERMINAL_THEME?.toLowerCase()
		if (vscodeTheme) {
			return vscodeTheme.includes("light") ? "light" : "dark"
		}
	}

	// iTerm2 on macOS
	if (termProgram === "iterm.app") {
		const itermProfile = process.env.ITERM_PROFILE?.toLowerCase()
		if (itermProfile) {
			if (itermProfile.includes("light")) return "light"
			if (itermProfile.includes("dark")) return "dark"
		}
	}

	// Hyper terminal
	if (termProgram === "hyper") {
		// Hyper doesn't expose theme directly, but we can check HYPER_THEME if set
		const hyperTheme = process.env.HYPER_THEME?.toLowerCase()
		if (hyperTheme) {
			return hyperTheme.includes("light") ? "light" : "dark"
		}
	}

	// Windows Terminal
	if (process.env.WT_SESSION) {
		// Windows Terminal doesn't expose theme directly via env vars
		// but we can check WT_PROFILE_ID for hints
		const wtProfile = process.env.WT_PROFILE_ID?.toLowerCase()
		if (wtProfile) {
			if (wtProfile.includes("light")) return "light"
			if (wtProfile.includes("dark")) return "dark"
		}
	}

	// Kitty terminal
	if (process.env.KITTY_WINDOW_ID) {
		// Kitty uses KITTY_THEME or we can check the config
		const kittyTheme = process.env.KITTY_THEME?.toLowerCase()
		if (kittyTheme) {
			return kittyTheme.includes("light") ? "light" : "dark"
		}
	}

	// Alacritty
	if (process.env.ALACRITTY_SOCKET) {
		// Alacritty doesn't expose theme via env vars by default
		// but users might set ALACRITTY_THEME
		const alacrittyTheme = process.env.ALACRITTY_THEME?.toLowerCase()
		if (alacrittyTheme) {
			return alacrittyTheme.includes("light") ? "light" : "dark"
		}
	}

	// Generic TERMINAL_THEME or TERM_THEME env var (user-defined)
	const genericTheme = (process.env.TERMINAL_THEME || process.env.TERM_THEME)?.toLowerCase()
	if (genericTheme) {
		return genericTheme.includes("light") ? "light" : "dark"
	}

	return null
}

/**
 * Query terminal background color using OSC 11 escape sequence
 * This is an async operation that requires terminal response
 *
 * Note: This method is not always reliable as:
 * - Not all terminals support OSC 11
 * - Some terminals may not respond
 * - Response timing can vary
 *
 * @param timeoutMs - Timeout in milliseconds (default: 100ms)
 */
async function queryTerminalBackground(timeoutMs: number = 100): Promise<TerminalThemeType | null> {
	// Only attempt if we have a TTY
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return null
	}

	return new Promise((resolve) => {
		let resolved = false
		let responseBuffer = ""

		const cleanup = () => {
			if (resolved) return
			resolved = true
			process.stdin.removeListener("data", onData)
			process.stdin.setRawMode?.(false)
			process.stdin.pause()
		}

		const onData = (data: Buffer) => {
			responseBuffer += data.toString()

			// Check if we have a complete OSC response
			// Responses end with BEL (\x07) or ST (\x1b\\)
			if (responseBuffer.includes("\x07") || responseBuffer.includes("\x1b\\")) {
				cleanup()
				const result = parseOscResponse(responseBuffer)
				resolve(result)
			}
		}

		// Set up timeout
		const timeout = setTimeout(() => {
			cleanup()
			resolve(null)
		}, timeoutMs)

		try {
			// Enable raw mode to receive terminal response
			process.stdin.setRawMode?.(true)
			process.stdin.resume()
			process.stdin.on("data", onData)

			// Send OSC 11 query: ESC ] 11 ; ? BEL
			// Using BEL (\x07) as terminator for broader compatibility
			process.stdout.write("\x1b]11;?\x07")
		} catch {
			clearTimeout(timeout)
			cleanup()
			resolve(null)
		}
	})
}

/**
 * Detect terminal theme using synchronous methods only
 * This is faster and doesn't require async/await
 */
export function detectTerminalThemeSync(): TerminalThemeType | null {
	// Method 1: Check COLORFGBG environment variable
	const colorFgBg = process.env.COLORFGBG
	if (colorFgBg) {
		const result = parseColorFgBg(colorFgBg)
		if (result) {
			logs.debug(`Theme detected from COLORFGBG: ${result}`, "TerminalThemeDetection")
			return result
		}
	}

	// Method 2: Check terminal-specific environment variables
	const envResult = checkTerminalEnvVars()
	if (envResult) {
		logs.debug(`Theme detected from terminal env vars: ${envResult}`, "TerminalThemeDetection")
		return envResult
	}

	// Method 3: Check macOS appearance (if running on macOS)
	if (process.platform === "darwin") {
		try {
			// Check if AppleInterfaceStyle is set (only set when dark mode is enabled)
			const result = execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", {
				encoding: "utf-8",
				timeout: 500,
			}).trim()
			if (result.toLowerCase() === "dark") {
				logs.debug("Theme detected from macOS appearance: dark", "TerminalThemeDetection")
				return "dark"
			}
		} catch {
			// AppleInterfaceStyle not set means light mode
			logs.debug("Theme detected from macOS appearance: light", "TerminalThemeDetection")
			return "light"
		}
	}

	return null
}

/**
 * Detect terminal theme using all available methods
 * Falls back to "dark" if detection fails
 *
 * @param options - Detection options
 * @param options.useOscQuery - Whether to use OSC 11 query (default: false, as it can be slow/unreliable)
 * @param options.oscTimeout - Timeout for OSC query in milliseconds (default: 100)
 */
export async function detectTerminalTheme(options?: {
	useOscQuery?: boolean
	oscTimeout?: number
}): Promise<TerminalThemeType> {
	const { useOscQuery = false, oscTimeout = 100 } = options || {}

	// Try synchronous methods first
	const syncResult = detectTerminalThemeSync()
	if (syncResult) {
		return syncResult
	}

	// Optionally try OSC query (disabled by default as it can be slow/unreliable)
	if (useOscQuery) {
		try {
			const oscResult = await queryTerminalBackground(oscTimeout)
			if (oscResult) {
				logs.debug(`Theme detected from OSC 11 query: ${oscResult}`, "TerminalThemeDetection")
				return oscResult
			}
		} catch (error) {
			logs.debug("OSC 11 query failed", "TerminalThemeDetection", { error })
		}
	}

	// Default to dark theme if detection fails
	logs.debug("Theme detection failed, defaulting to dark", "TerminalThemeDetection")
	return "dark"
}

/**
 * Get the appropriate theme ID based on detected terminal theme
 *
 * @param detectedTheme - The detected terminal theme type
 * @returns The theme ID to use ("dark" or "light")
 */
export function getThemeIdForTerminal(detectedTheme: TerminalThemeType): string {
	return detectedTheme === "light" ? "light" : "dark"
}

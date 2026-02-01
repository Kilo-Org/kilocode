// kilocode_change - new file
/**
 * Automatic terminal theme detection
 *
 * Detects whether the terminal is using a light or dark background
 * by checking various environment variables and terminal capabilities.
 */

/**
 * Detect the terminal's color scheme (light or dark)
 *
 * Detection strategy:
 * 1. Check COLORFGBG environment variable (used by many terminals)
 * 2. Check TERM_PROGRAM for known terminals with theme info
 * 3. Check other terminal-specific variables
 * 4. Fall back to 'dark' as default
 *
 * @returns 'light' or 'dark' based on terminal background
 */
export function detectTerminalTheme(): "light" | "dark" {
	// Check COLORFGBG environment variable
	// Format is typically "foreground;background" where higher numbers = lighter
	// Common values:
	// - Light backgrounds: "0;15" (black text on white)
	// - Dark backgrounds: "15;0" (white text on black)
	const colorFgBg = process.env.COLORFGBG
	if (colorFgBg) {
		const parts = colorFgBg.split(";")
		if (parts.length >= 2) {
			const bg = parseInt(parts[1]!, 10)
			// ANSI colors 0-7 are dark, 8-15 are bright/light
			// Background colors > 7 typically indicate a light terminal
			if (!isNaN(bg)) {
				return bg >= 8 ? "light" : "dark"
			}
		}
	}

	// Check for macOS Terminal.app theme
	// Terminal.app doesn't set COLORFGBG but we can check TERM_PROGRAM
	const termProgram = process.env.TERM_PROGRAM
	if (termProgram === "Apple_Terminal") {
		// Apple Terminal doesn't expose theme info via env vars
		// Default to dark as it's more common
		return "dark"
	}

	// Check for iTerm2
	if (termProgram === "iTerm.app") {
		// iTerm2 supports COLORFGBG, but if not set, default to dark
		return "dark"
	}

	// Check for VS Code integrated terminal
	if (termProgram === "vscode") {
		// VS Code's integrated terminal usually inherits from the editor theme
		// but doesn't expose it via env vars
		// Default to dark as it's more common for developers
		return "dark"
	}

	// Check for Windows Terminal
	if (process.env.WT_SESSION) {
		// Windows Terminal supports COLORFGBG, already handled above
		// If not set, default to dark
		return "dark"
	}

	// Check for Alacritty
	if (process.env.ALACRITTY_SOCKET || process.env.ALACRITTY_LOG) {
		// Alacritty doesn't expose theme info
		return "dark"
	}

	// Check for Kitty
	if (process.env.KITTY_WINDOW_ID) {
		// Kitty doesn't expose theme info via env vars
		return "dark"
	}

	// Check for Hyper
	if (termProgram === "Hyper") {
		return "dark"
	}

	// Check for tmux (it passes through the underlying terminal's COLORFGBG)
	if (process.env.TMUX) {
		// Already checked COLORFGBG above
		return "dark"
	}

	// Default to dark theme if we can't determine
	// Dark is a safer default as most terminals use dark backgrounds
	// and dark themes work better with most terminal color schemes
	return "dark"
}

/**
 * Check if theme auto-detection should be used
 *
 * Auto-detection is used when:
 * - User hasn't explicitly set a theme in config
 * - Config theme is set to "auto" or undefined
 *
 * @param configTheme - The theme value from config
 * @returns true if auto-detection should be used
 */
export function shouldAutoDetectTheme(configTheme: string | undefined): boolean {
	return !configTheme || configTheme === "auto" || configTheme === ""
}

/**
 * Get the theme to use, with automatic detection if needed
 *
 * @param configTheme - The theme value from config
 * @returns The theme to use ('light' or 'dark', or the user's configured theme)
 */
export function resolveTheme(configTheme: string | undefined): string {
	if (shouldAutoDetectTheme(configTheme)) {
		return detectTerminalTheme()
	}
	return configTheme!
}

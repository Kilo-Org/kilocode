/**
 * Terminal utilities for interactive prompts
 *
 * The newer versions of inquirer (v13+) use @inquirer/prompts internally,
 * which requires raw mode to be enabled for interactive features like
 * arrow key navigation in list prompts to work correctly.
 *
 * When stdin is not a TTY or when Node.js loses track of the raw mode state,
 * the prompts fall back to a non-interactive mode where users must type
 * their selection instead of using arrow keys.
 *
 * This module provides utilities to ensure raw mode is properly enabled
 * before running inquirer prompts.
 */

/**
 * Ensures stdin is in raw mode for interactive prompts.
 * Returns a cleanup function to restore the original state.
 *
 * @returns A cleanup function that restores the original raw mode state
 */
export function ensureRawMode(): () => void {
	// Only attempt to set raw mode if stdin is a TTY
	if (!process.stdin.isTTY) {
		return () => {}
	}

	// Check if setRawMode is available (it should be for TTY streams)
	if (typeof process.stdin.setRawMode !== "function") {
		return () => {}
	}

	// Store the original raw mode state
	const wasRawMode = process.stdin.isRaw

	// Enable raw mode if not already enabled
	if (!wasRawMode) {
		try {
			process.stdin.setRawMode(true)
		} catch (error) {
			// If setting raw mode fails, log and continue without it
			// The CLI will fall back to non-interactive mode
			console.debug("Failed to enable terminal raw mode:", error)
			return () => {}
		}
	}

	// Return cleanup function
	return () => {
		if (!wasRawMode && process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
			try {
				process.stdin.setRawMode(false)
			} catch (error) {
				// Log but don't throw - terminal state restoration is best-effort
				console.debug("Failed to restore terminal raw mode:", error)
			}
		}
	}
}

/**
 * Wraps an async function to ensure raw mode is enabled during its execution.
 * This is useful for wrapping inquirer prompt calls.
 *
 * @param fn - The async function to wrap
 * @returns The result of the wrapped function
 */
export async function withRawMode<T>(fn: () => Promise<T>): Promise<T> {
	const cleanup = ensureRawMode()
	try {
		return await fn()
	} finally {
		cleanup()
	}
}

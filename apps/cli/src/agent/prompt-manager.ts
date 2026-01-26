/**
 * PromptManager - Handles all user input collection
 *
 * This manager is responsible for:
 * - Collecting user input via readline
 * - Yes/No prompts with proper defaults
 * - Timed prompts that auto-select after timeout
 * - Raw mode input for character-by-character handling
 *
 * Design notes:
 * - Single responsibility: User input only (no output formatting)
 * - Returns Promises for all input operations
 * - Handles console mode switching (quiet mode restore)
 * - Can be disabled for programmatic (non-interactive) use
 */

import readline from "readline"

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration options for PromptManager.
 */
export interface PromptManagerOptions {
	/**
	 * Called before prompting to restore console output.
	 * Used to exit quiet mode temporarily.
	 */
	onBeforePrompt?: () => void

	/**
	 * Called after prompting to re-enable quiet mode.
	 */
	onAfterPrompt?: () => void

	/**
	 * Stream for input (default: process.stdin).
	 */
	stdin?: NodeJS.ReadStream

	/**
	 * Stream for prompt output (default: process.stdout).
	 */
	stdout?: NodeJS.WriteStream
}

/**
 * Result of a timed prompt.
 */
export interface TimedPromptResult {
	/** The user's input, or default if timed out */
	value: string
	/** Whether the result came from timeout */
	timedOut: boolean
	/** Whether the user cancelled (Ctrl+C) */
	cancelled: boolean
}

// =============================================================================
// PromptManager Class
// =============================================================================

export class PromptManager {
	private onBeforePrompt?: () => void
	private onAfterPrompt?: () => void
	private stdin: NodeJS.ReadStream
	private stdout: NodeJS.WriteStream

	/**
	 * Track if a prompt is currently active.
	 */
	private isPrompting = false

	constructor(options: PromptManagerOptions = {}) {
		this.onBeforePrompt = options.onBeforePrompt
		this.onAfterPrompt = options.onAfterPrompt
		this.stdin = options.stdin ?? (process.stdin as NodeJS.ReadStream)
		this.stdout = options.stdout ?? process.stdout
	}

	// ===========================================================================
	// Public API
	// ===========================================================================

	/**
	 * Check if a prompt is currently active.
	 */
	isActive(): boolean {
		return this.isPrompting
	}

	/**
	 * Prompt for text input using readline.
	 *
	 * @param prompt - The prompt text to display
	 * @returns The user's input
	 * @throws If input is cancelled or an error occurs
	 */
	async promptForInput(prompt: string): Promise<string> {
		return new Promise((resolve, reject) => {
			this.beforePrompt()
			this.isPrompting = true

			const rl = readline.createInterface({
				input: this.stdin,
				output: this.stdout,
			})

			rl.question(prompt, (answer) => {
				rl.close()
				this.isPrompting = false
				this.afterPrompt()
				resolve(answer)
			})

			rl.on("close", () => {
				this.isPrompting = false
				this.afterPrompt()
			})

			rl.on("error", (err) => {
				rl.close()
				this.isPrompting = false
				this.afterPrompt()
				reject(err)
			})
		})
	}

	/**
	 * Prompt for yes/no input.
	 *
	 * @param prompt - The prompt text to display
	 * @param defaultValue - Default value if empty input (default: false)
	 * @returns true for yes, false for no
	 */
	async promptForYesNo(prompt: string, defaultValue = false): Promise<boolean> {
		const answer = await this.promptForInput(prompt)
		const normalized = answer.trim().toLowerCase()
		if (normalized === "" && defaultValue !== undefined) {
			return defaultValue
		}
		return normalized === "y" || normalized === "yes"
	}

	/**
	 * Prompt for input with a timeout.
	 * Uses raw mode for character-by-character input handling.
	 *
	 * @param prompt - The prompt text to display
	 * @param timeoutMs - Timeout in milliseconds
	 * @param defaultValue - Value to use if timed out
	 * @returns TimedPromptResult with value, timedOut flag, and cancelled flag
	 */
	async promptWithTimeout(prompt: string, timeoutMs: number, defaultValue: string): Promise<TimedPromptResult> {
		return new Promise((resolve) => {
			this.beforePrompt()
			this.isPrompting = true

			// Track the original raw mode state to restore it later
			const wasRaw = this.stdin.isRaw

			// Enable raw mode for character-by-character input if TTY
			if (this.stdin.isTTY) {
				this.stdin.setRawMode(true)
			}

			this.stdin.resume()

			let inputBuffer = ""
			let timeoutCancelled = false
			let resolved = false

			// Set up timeout
			const timeout = setTimeout(() => {
				if (!resolved) {
					resolved = true
					cleanup()
					this.stdout.write(`\n[Timeout - using default: ${defaultValue || "(empty)"}]\n`)
					resolve({ value: defaultValue, timedOut: true, cancelled: false })
				}
			}, timeoutMs)

			// Display prompt
			this.stdout.write(prompt)

			// Cleanup function to restore state
			const cleanup = () => {
				clearTimeout(timeout)
				this.stdin.removeListener("data", onData)

				if (this.stdin.isTTY && wasRaw !== undefined) {
					this.stdin.setRawMode(wasRaw)
				}

				this.stdin.pause()
				this.isPrompting = false
				this.afterPrompt()
			}

			// Handle incoming data
			const onData = (data: Buffer) => {
				const char = data.toString()

				// Handle Ctrl+C
				if (char === "\x03") {
					cleanup()
					resolved = true
					this.stdout.write("\n[cancelled]\n")
					resolve({ value: defaultValue, timedOut: false, cancelled: true })
					return
				}

				// Cancel timeout on first input
				if (!timeoutCancelled) {
					timeoutCancelled = true
					clearTimeout(timeout)
				}

				// Handle Enter
				if (char === "\r" || char === "\n") {
					if (!resolved) {
						resolved = true
						cleanup()
						this.stdout.write("\n")
						resolve({ value: inputBuffer, timedOut: false, cancelled: false })
					}
					return
				}

				// Handle Backspace
				if (char === "\x7f" || char === "\b") {
					if (inputBuffer.length > 0) {
						inputBuffer = inputBuffer.slice(0, -1)
						this.stdout.write("\b \b")
					}
					return
				}

				// Normal character - add to buffer and echo
				inputBuffer += char
				this.stdout.write(char)
			}

			this.stdin.on("data", onData)
		})
	}

	/**
	 * Prompt for yes/no with timeout.
	 *
	 * @param prompt - The prompt text to display
	 * @param timeoutMs - Timeout in milliseconds
	 * @param defaultValue - Default boolean value if timed out
	 * @returns true for yes, false for no
	 */
	async promptForYesNoWithTimeout(prompt: string, timeoutMs: number, defaultValue: boolean): Promise<boolean> {
		const result = await this.promptWithTimeout(prompt, timeoutMs, defaultValue ? "y" : "n")
		const normalized = result.value.trim().toLowerCase()
		if (result.timedOut || result.cancelled || normalized === "") {
			return defaultValue
		}
		return normalized === "y" || normalized === "yes"
	}

	/**
	 * Display a message on stdout (utility for prompting context).
	 */
	write(text: string): void {
		this.stdout.write(text)
	}

	/**
	 * Display a message with newline.
	 */
	writeLine(text: string): void {
		this.stdout.write(text + "\n")
	}

	// ===========================================================================
	// Private Helpers
	// ===========================================================================

	private beforePrompt(): void {
		if (this.onBeforePrompt) {
			this.onBeforePrompt()
		}
	}

	private afterPrompt(): void {
		if (this.onAfterPrompt) {
			this.onAfterPrompt()
		}
	}
}

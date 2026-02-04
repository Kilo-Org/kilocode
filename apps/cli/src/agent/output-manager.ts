/**
 * OutputManager - Handles all CLI output and streaming
 *
 * This manager is responsible for:
 * - Writing messages to stdout/stderr
 * - Tracking what's been displayed (to avoid duplicates)
 * - Managing streaming content with delta computation
 * - Formatting different message types appropriately
 *
 * Design notes:
 * - Uses the Observable pattern from client/events.ts for internal state
 * - Single responsibility: CLI output only (no prompting, no state detection)
 * - Can be disabled for TUI mode where Ink controls the terminal
 */

import { ClineMessage, ClineSay } from "@roo-code/types"

import { Observable } from "./events.js"

// =============================================================================
// Types
// =============================================================================

/**
 * Tracks what we've displayed for a specific message ts.
 */
export interface DisplayedMessage {
	ts: number
	text: string
	partial: boolean
}

/**
 * Tracks streaming state for a message.
 */
export interface StreamState {
	ts: number
	text: string
	headerShown: boolean
}

/**
 * Configuration options for OutputManager.
 */
export interface OutputManagerOptions {
	/**
	 * When true, completely disables all output.
	 * Use for TUI mode where another system controls the terminal.
	 */
	disabled?: boolean

	/**
	 * Stream for normal output (default: process.stdout).
	 */
	stdout?: NodeJS.WriteStream

	/**
	 * Stream for error output (default: process.stderr).
	 */
	stderr?: NodeJS.WriteStream
}

// =============================================================================
// OutputManager Class
// =============================================================================

export class OutputManager {
	private disabled: boolean
	private stdout: NodeJS.WriteStream
	private stderr: NodeJS.WriteStream

	/**
	 * Track displayed messages by ts to avoid duplicate output.
	 * Observable pattern allows external systems to subscribe if needed.
	 */
	private displayedMessages = new Map<number, DisplayedMessage>()

	/**
	 * Track streamed content by ts for delta computation.
	 */
	private streamedContent = new Map<number, StreamState>()

	/**
	 * Track which ts is currently streaming (for newline management).
	 */
	private currentlyStreamingTs: number | null = null

	/**
	 * Track first partial logs (for debugging first/last pattern).
	 */
	private loggedFirstPartial = new Set<number>()

	/**
	 * Observable for streaming state changes.
	 * External systems can subscribe to know when streaming starts/ends.
	 */
	public readonly streamingState = new Observable<{ ts: number | null; isStreaming: boolean }>({
		ts: null,
		isStreaming: false,
	})

	constructor(options: OutputManagerOptions = {}) {
		this.disabled = options.disabled ?? false
		this.stdout = options.stdout ?? process.stdout
		this.stderr = options.stderr ?? process.stderr
	}

	// ===========================================================================
	// Public API
	// ===========================================================================

	/**
	 * Output a ClineMessage based on its type.
	 * This is the main entry point for message output.
	 *
	 * @param msg - The message to output
	 * @param skipFirstUserMessage - If true, skip the first "text" message (user prompt echo)
	 */
	outputMessage(msg: ClineMessage, skipFirstUserMessage = true): void {
		const ts = msg.ts
		const text = msg.text || ""
		const isPartial = msg.partial === true
		const previousDisplay = this.displayedMessages.get(ts)
		const alreadyDisplayedComplete = previousDisplay && !previousDisplay.partial

		if (msg.type === "say" && msg.say) {
			this.outputSayMessage(ts, msg.say, text, isPartial, alreadyDisplayedComplete, skipFirstUserMessage)
		} else if (msg.type === "ask" && msg.ask) {
			// For ask messages, we only output command_output here
			// Other asks are handled by AskDispatcher
			if (msg.ask === "command_output") {
				this.outputCommandOutput(ts, text, isPartial, alreadyDisplayedComplete)
			}
		}
	}

	/**
	 * Output a simple text line with a label.
	 */
	output(label: string, text?: string): void {
		if (this.disabled) return
		const message = text ? `${label} ${text}\n` : `${label}\n`
		this.stdout.write(message)
	}

	/**
	 * Output an error message.
	 */
	outputError(label: string, text?: string): void {
		if (this.disabled) return
		const message = text ? `${label} ${text}\n` : `${label}\n`
		this.stderr.write(message)
	}

	/**
	 * Write raw text to stdout (for streaming).
	 */
	writeRaw(text: string): void {
		if (this.disabled) return
		this.stdout.write(text)
	}

	/**
	 * Check if a message has already been fully displayed.
	 */
	isAlreadyDisplayed(ts: number): boolean {
		const displayed = this.displayedMessages.get(ts)
		return displayed !== undefined && !displayed.partial
	}

	/**
	 * Check if we're currently streaming any message.
	 */
	isCurrentlyStreaming(): boolean {
		return this.currentlyStreamingTs !== null
	}

	/**
	 * Get the ts of the currently streaming message.
	 */
	getCurrentlyStreamingTs(): number | null {
		return this.currentlyStreamingTs
	}

	/**
	 * Mark a message as displayed (useful for external coordination).
	 */
	markDisplayed(ts: number, text: string, partial: boolean): void {
		this.displayedMessages.set(ts, { ts, text, partial })
	}

	/**
	 * Clear all tracking state.
	 * Call this when starting a new task.
	 */
	clear(): void {
		this.displayedMessages.clear()
		this.streamedContent.clear()
		this.currentlyStreamingTs = null
		this.loggedFirstPartial.clear()
		this.streamingState.next({ ts: null, isStreaming: false })
	}

	/**
	 * Get debugging info about first partial logging.
	 */
	hasLoggedFirstPartial(ts: number): boolean {
		return this.loggedFirstPartial.has(ts)
	}

	/**
	 * Record that we've logged the first partial for a ts.
	 */
	setLoggedFirstPartial(ts: number): void {
		this.loggedFirstPartial.add(ts)
	}

	/**
	 * Clear the first partial record (when complete).
	 */
	clearLoggedFirstPartial(ts: number): void {
		this.loggedFirstPartial.delete(ts)
	}

	// ===========================================================================
	// Say Message Output
	// ===========================================================================

	private outputSayMessage(
		ts: number,
		say: ClineSay,
		text: string,
		isPartial: boolean,
		alreadyDisplayedComplete: boolean | undefined,
		skipFirstUserMessage: boolean,
	): void {
		switch (say) {
			case "text":
				this.outputTextMessage(ts, text, isPartial, alreadyDisplayedComplete, skipFirstUserMessage)
				break

			// case "thinking": - not a valid ClineSay type
			case "reasoning":
				this.outputReasoningMessage(ts, text, isPartial, alreadyDisplayedComplete)
				break

			case "command_output":
				this.outputCommandOutput(ts, text, isPartial, alreadyDisplayedComplete)
				break

			// Note: completion_result is an "ask" type, not a "say" type.
			// It is handled via the TaskCompleted event in extension-host.ts

			case "error":
				if (!alreadyDisplayedComplete) {
					this.outputError("\n[error]", text || "Unknown error")
					this.displayedMessages.set(ts, { ts, text: text || "", partial: false })
				}
				break

			case "api_req_started":
				// Silent - no output needed
				break

			default:
				// NO-OP for unknown say types
				break
		}
	}

	private outputTextMessage(
		ts: number,
		text: string,
		isPartial: boolean,
		alreadyDisplayedComplete: boolean | undefined,
		skipFirstUserMessage: boolean,
	): void {
		// Skip the initial user prompt echo (first message with no prior messages)
		if (skipFirstUserMessage && this.displayedMessages.size === 0 && !this.displayedMessages.has(ts)) {
			this.displayedMessages.set(ts, { ts, text, partial: !!isPartial })
			return
		}

		if (isPartial && text) {
			// Stream partial content
			this.streamContent(ts, text, "[assistant]")
			this.displayedMessages.set(ts, { ts, text, partial: true })
		} else if (!isPartial && text && !alreadyDisplayedComplete) {
			// Message complete - ensure all content is output
			const streamed = this.streamedContent.get(ts)

			if (streamed) {
				// We were streaming - output any remaining delta and finish
				if (text.length > streamed.text.length && text.startsWith(streamed.text)) {
					const delta = text.slice(streamed.text.length)
					this.writeRaw(delta)
				}
				this.finishStream(ts)
			} else {
				// Not streamed yet - output complete message
				this.output("\n[assistant]", text)
			}

			this.displayedMessages.set(ts, { ts, text, partial: false })
			this.streamedContent.set(ts, { ts, text, headerShown: true })
		}
	}

	private outputReasoningMessage(
		ts: number,
		text: string,
		isPartial: boolean,
		alreadyDisplayedComplete: boolean | undefined,
	): void {
		if (isPartial && text) {
			this.streamContent(ts, text, "[reasoning]")
			this.displayedMessages.set(ts, { ts, text, partial: true })
		} else if (!isPartial && text && !alreadyDisplayedComplete) {
			// Reasoning complete - finish the stream
			const streamed = this.streamedContent.get(ts)

			if (streamed) {
				if (text.length > streamed.text.length && text.startsWith(streamed.text)) {
					const delta = text.slice(streamed.text.length)
					this.writeRaw(delta)
				}
				this.finishStream(ts)
			} else {
				this.output("\n[reasoning]", text)
			}

			this.displayedMessages.set(ts, { ts, text, partial: false })
		}
	}

	/**
	 * Output command_output (shared between say and ask types).
	 */
	outputCommandOutput(
		ts: number,
		text: string,
		isPartial: boolean,
		alreadyDisplayedComplete: boolean | undefined,
	): void {
		if (isPartial && text) {
			this.streamContent(ts, text, "[command output]")
			this.displayedMessages.set(ts, { ts, text, partial: true })
		} else if (!isPartial && text && !alreadyDisplayedComplete) {
			const streamed = this.streamedContent.get(ts)

			if (streamed) {
				if (text.length > streamed.text.length && text.startsWith(streamed.text)) {
					const delta = text.slice(streamed.text.length)
					this.writeRaw(delta)
				}
				this.finishStream(ts)
			} else {
				this.writeRaw("\n[command output] ")
				this.writeRaw(text)
				this.writeRaw("\n")
			}

			this.displayedMessages.set(ts, { ts, text, partial: false })
			this.streamedContent.set(ts, { ts, text, headerShown: true })
		}
	}

	// ===========================================================================
	// Streaming Helpers
	// ===========================================================================

	/**
	 * Stream content with delta computation - only output new characters.
	 */
	streamContent(ts: number, text: string, header: string): void {
		const previous = this.streamedContent.get(ts)

		if (!previous) {
			// First time seeing this message - output header and initial text
			this.writeRaw(`\n${header} `)
			this.writeRaw(text)
			this.streamedContent.set(ts, { ts, text, headerShown: true })
			this.currentlyStreamingTs = ts
			this.streamingState.next({ ts, isStreaming: true })
		} else if (text.length > previous.text.length && text.startsWith(previous.text)) {
			// Text has grown - output delta
			const delta = text.slice(previous.text.length)
			this.writeRaw(delta)
			this.streamedContent.set(ts, { ts, text, headerShown: true })
		}
	}

	/**
	 * Finish streaming a message (add newline).
	 */
	finishStream(ts: number): void {
		if (this.currentlyStreamingTs === ts) {
			this.writeRaw("\n")
			this.currentlyStreamingTs = null
			this.streamingState.next({ ts: null, isStreaming: false })
		}
	}

	/**
	 * Output completion message (called from TaskCompleted handler).
	 */
	outputCompletionResult(ts: number, text: string): void {
		const previousDisplay = this.displayedMessages.get(ts)
		if (!previousDisplay || previousDisplay.partial) {
			this.output("\n[task complete]", text || "")
			this.displayedMessages.set(ts, { ts, text: text || "", partial: false })
		}
	}
}

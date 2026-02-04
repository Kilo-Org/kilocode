/**
 * JsonEventEmitter - Handles structured JSON output for the CLI
 *
 * This class transforms internal CLI events (ClineMessage, state changes, etc.)
 * into structured JSON events and outputs them to stdout.
 *
 * Supports two output modes:
 * - "stream-json": NDJSON format (one JSON object per line) for real-time streaming
 * - "json": Single JSON object at the end with accumulated events
 *
 * Schema is optimized for efficiency with high message volume:
 * - Minimal fields per event
 * - No redundant wrappers
 * - `done` flag instead of partial:false
 */

import type { ClineMessage } from "@roo-code/types"

import type { JsonEvent, JsonEventCost, JsonFinalOutput } from "@/types/json-events.js"

import type { ExtensionClient } from "./extension-client.js"
import type { TaskCompletedEvent } from "./events.js"

/**
 * Options for JsonEventEmitter.
 */
export interface JsonEventEmitterOptions {
	/** Output mode: "json" or "stream-json" */
	mode: "json" | "stream-json"
	/** Output stream (defaults to process.stdout) */
	stdout?: NodeJS.WriteStream
}

/**
 * Parse tool information from a ClineMessage text field.
 * Tool messages are JSON with a `tool` field containing the tool name.
 */
function parseToolInfo(text: string | undefined): { name: string; input: Record<string, unknown> } | null {
	if (!text) return null
	try {
		const parsed = JSON.parse(text)
		return parsed.tool ? { name: parsed.tool, input: parsed } : null
	} catch {
		return null
	}
}

/**
 * Parse API request cost information from api_req_started message text.
 */
function parseApiReqCost(text: string | undefined): JsonEventCost | undefined {
	if (!text) return undefined
	try {
		const parsed = JSON.parse(text)
		return parsed.cost !== undefined
			? {
					totalCost: parsed.cost,
					inputTokens: parsed.tokensIn,
					outputTokens: parsed.tokensOut,
					cacheWrites: parsed.cacheWrites,
					cacheReads: parsed.cacheReads,
				}
			: undefined
	} catch {
		return undefined
	}
}

/** Internal events that should not be emitted */
const SKIP_SAY_TYPES = new Set([
	"api_req_finished",
	"api_req_retried",
	"api_req_retry_delayed",
	"api_req_rate_limit_wait",
	"api_req_deleted",
	"checkpoint_saved",
	"condense_context",
	"condense_context_error",
	"sliding_window_truncation",
])

/** Key offset for reasoning content to avoid collision with text content delta tracking */
const REASONING_KEY_OFFSET = 1_000_000_000

export class JsonEventEmitter {
	private mode: "json" | "stream-json"
	private stdout: NodeJS.WriteStream
	private events: JsonEvent[] = []
	private unsubscribers: (() => void)[] = []
	private lastCost: JsonEventCost | undefined
	private seenMessageIds = new Set<number>()
	// Track previous content for delta computation
	private previousContent = new Map<number, string>()
	// Track the completion result content
	private completionResultContent: string | undefined

	constructor(options: JsonEventEmitterOptions) {
		this.mode = options.mode
		this.stdout = options.stdout ?? process.stdout
	}

	/**
	 * Attach to an ExtensionClient and subscribe to its events.
	 */
	attachToClient(client: ExtensionClient): void {
		// Subscribe to message events
		const unsubMessage = client.on("message", (msg) => this.handleMessage(msg, false))
		const unsubMessageUpdated = client.on("messageUpdated", (msg) => this.handleMessage(msg, true))
		const unsubTaskCompleted = client.on("taskCompleted", (event) => this.handleTaskCompleted(event))
		const unsubError = client.on("error", (error) => this.handleError(error))

		this.unsubscribers.push(unsubMessage, unsubMessageUpdated, unsubTaskCompleted, unsubError)

		// Emit init event
		this.emitEvent({
			type: "system",
			subtype: "init",
			content: "Task started",
		})
	}

	/**
	 * Detach from the client and clean up subscriptions.
	 */
	detach(): void {
		for (const unsub of this.unsubscribers) {
			unsub()
		}
		this.unsubscribers = []
	}

	/**
	 * Compute the delta (new content) for a streaming message.
	 * Returns null if there's no new content.
	 */
	private computeDelta(msgId: number, fullContent: string | undefined): string | null {
		if (!fullContent) return null

		const previous = this.previousContent.get(msgId) || ""
		if (fullContent === previous) return null

		this.previousContent.set(msgId, fullContent)
		// If content is appended, return only the new part
		return fullContent.startsWith(previous) ? fullContent.slice(previous.length) : fullContent
	}

	/**
	 * Check if this is a streaming partial message with no new content.
	 */
	private isEmptyStreamingDelta(content: string | null): boolean {
		return this.mode === "stream-json" && content === null
	}

	/**
	 * Get content to send for a message (delta for streaming, full for json mode).
	 */
	private getContentToSend(msgId: number, text: string | undefined, isPartial: boolean): string | null {
		if (this.mode === "stream-json" && isPartial) {
			return this.computeDelta(msgId, text)
		}
		return text ?? null
	}

	/**
	 * Build a base event with optional done flag.
	 */
	private buildTextEvent(
		type: "assistant" | "thinking" | "user",
		id: number,
		content: string | null,
		isDone: boolean,
		subtype?: string,
	): JsonEvent {
		const event: JsonEvent = { type, id }
		if (content !== null) {
			event.content = content
		}
		if (subtype) {
			event.subtype = subtype
		}
		if (isDone) {
			event.done = true
		}
		return event
	}

	/**
	 * Handle a ClineMessage and emit the appropriate JSON event.
	 */
	private handleMessage(msg: ClineMessage, _isUpdate: boolean): void {
		const isDone = !msg.partial

		// In json mode, only emit complete (non-partial) messages
		if (this.mode === "json" && msg.partial) {
			return
		}

		// Skip duplicate complete messages
		if (isDone && this.seenMessageIds.has(msg.ts)) {
			return
		}

		if (isDone) {
			this.seenMessageIds.add(msg.ts)
			this.previousContent.delete(msg.ts)
		}

		const contentToSend = this.getContentToSend(msg.ts, msg.text, msg.partial ?? false)

		// Skip if no new content for streaming partial messages
		if (msg.partial && this.isEmptyStreamingDelta(contentToSend)) {
			return
		}

		if (msg.type === "say" && msg.say) {
			this.handleSayMessage(msg, contentToSend, isDone)
		}

		if (msg.type === "ask" && msg.ask) {
			this.handleAskMessage(msg, contentToSend, isDone)
		}
	}

	/**
	 * Handle "say" type messages.
	 */
	private handleSayMessage(msg: ClineMessage, contentToSend: string | null, isDone: boolean): void {
		switch (msg.say) {
			case "text":
				this.emitEvent(this.buildTextEvent("assistant", msg.ts, contentToSend, isDone))
				break

			case "reasoning":
				this.handleReasoningMessage(msg, isDone)
				break

			case "error":
				this.emitEvent({ type: "error", id: msg.ts, content: contentToSend ?? undefined })
				break

			case "command_output":
				this.emitEvent({
					type: "tool_result",
					tool_result: { name: "execute_command", output: msg.text },
				})
				break

			case "user_feedback":
			case "user_feedback_diff":
				this.emitEvent(this.buildTextEvent("user", msg.ts, contentToSend, isDone))
				break

			case "api_req_started": {
				const cost = parseApiReqCost(msg.text)
				if (cost) {
					this.lastCost = cost
				}
				break
			}

			case "browser_action":
			case "browser_action_result":
				this.emitEvent({
					type: "tool_result",
					subtype: "browser",
					tool_result: { name: "browser_action", output: msg.text },
				})
				break

			case "mcp_server_response":
				this.emitEvent({
					type: "tool_result",
					subtype: "mcp",
					tool_result: { name: "mcp_server", output: msg.text },
				})
				break

			case "completion_result":
				if (msg.text && !msg.partial) {
					this.completionResultContent = msg.text
				}
				break

			default:
				if (SKIP_SAY_TYPES.has(msg.say!)) {
					break
				}
				if (msg.text) {
					this.emitEvent(this.buildTextEvent("assistant", msg.ts, contentToSend, isDone, msg.say))
				}
				break
		}
	}

	/**
	 * Handle reasoning/thinking messages with separate delta tracking.
	 */
	private handleReasoningMessage(msg: ClineMessage, isDone: boolean): void {
		const reasoningContent = msg.reasoning || msg.text
		const reasoningKey = msg.ts + REASONING_KEY_OFFSET
		const reasoningDelta = this.getContentToSend(reasoningKey, reasoningContent, msg.partial ?? false)

		if (msg.partial && this.isEmptyStreamingDelta(reasoningDelta)) {
			return
		}

		if (!msg.partial) {
			this.previousContent.delete(reasoningKey)
		}

		this.emitEvent(this.buildTextEvent("thinking", msg.ts, reasoningDelta, isDone))
	}

	/**
	 * Handle "ask" type messages.
	 */
	private handleAskMessage(msg: ClineMessage, contentToSend: string | null, isDone: boolean): void {
		switch (msg.ask) {
			case "tool": {
				const toolInfo = parseToolInfo(msg.text)
				this.emitEvent({
					type: "tool_use",
					id: msg.ts,
					subtype: "tool",
					tool_use: toolInfo ?? { name: "unknown_tool", input: { raw: msg.text } },
				})
				break
			}

			case "command":
				this.emitEvent({
					type: "tool_use",
					id: msg.ts,
					subtype: "command",
					tool_use: { name: "execute_command", input: { command: msg.text } },
				})
				break

			case "browser_action_launch":
				this.emitEvent({
					type: "tool_use",
					id: msg.ts,
					subtype: "browser",
					tool_use: { name: "browser_action", input: { raw: msg.text } },
				})
				break

			case "use_mcp_server":
				this.emitEvent({
					type: "tool_use",
					id: msg.ts,
					subtype: "mcp",
					tool_use: { name: "mcp_server", input: { raw: msg.text } },
				})
				break

			case "followup":
				this.emitEvent(this.buildTextEvent("assistant", msg.ts, contentToSend, isDone, "followup"))
				break

			case "command_output":
				// Handled in say type
				break

			case "completion_result":
				if (msg.text && !msg.partial) {
					this.completionResultContent = msg.text
				}
				break

			default:
				if (msg.text) {
					this.emitEvent(this.buildTextEvent("assistant", msg.ts, contentToSend, isDone, msg.ask))
				}
				break
		}
	}

	/**
	 * Handle task completion and emit result event.
	 */
	private handleTaskCompleted(event: TaskCompletedEvent): void {
		// Use tracked completion result content, falling back to event message
		const resultContent = this.completionResultContent || event.message?.text

		this.emitEvent({
			type: "result",
			id: event.message?.ts ?? Date.now(),
			content: resultContent,
			done: true,
			success: event.success,
			cost: this.lastCost,
		})

		// For "json" mode, output the final accumulated result
		if (this.mode === "json") {
			this.outputFinalResult(event.success, resultContent)
		}
	}

	/**
	 * Handle errors and emit error event.
	 */
	private handleError(error: Error): void {
		this.emitEvent({
			type: "error",
			id: Date.now(),
			content: error.message,
		})
	}

	/**
	 * Emit a JSON event.
	 * For stream-json mode: immediately output to stdout
	 * For json mode: accumulate for final output
	 */
	private emitEvent(event: JsonEvent): void {
		this.events.push(event)

		if (this.mode === "stream-json") {
			this.outputLine(event)
		}
	}

	/**
	 * Output a single JSON line (NDJSON format).
	 */
	private outputLine(data: unknown): void {
		this.stdout.write(JSON.stringify(data) + "\n")
	}

	/**
	 * Output the final accumulated result (for "json" mode).
	 */
	private outputFinalResult(success: boolean, content?: string): void {
		const output: JsonFinalOutput = {
			type: "result",
			success,
			content,
			cost: this.lastCost,
			events: this.events.filter((e) => e.type !== "result"), // Exclude the result event itself
		}

		this.stdout.write(JSON.stringify(output, null, 2) + "\n")
	}

	/**
	 * Get accumulated events (for testing or external use).
	 */
	getEvents(): JsonEvent[] {
		return [...this.events]
	}

	/**
	 * Clear accumulated events and state.
	 */
	clear(): void {
		this.events = []
		this.lastCost = undefined
		this.seenMessageIds.clear()
		this.previousContent.clear()
		this.completionResultContent = undefined
	}
}

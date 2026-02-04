/**
 * JSON Event Types for Structured CLI Output
 *
 * This module defines the types for structured JSON output from the CLI.
 * The output format is NDJSON (newline-delimited JSON) for stream-json mode,
 * or a single JSON object for json mode.
 *
 * Schema is optimized for efficiency with high message volume:
 * - Minimal fields per event
 * - No redundant wrappers
 * - `done` flag instead of partial:false
 */

/**
 * Output format options for the CLI.
 */
export const OUTPUT_FORMATS = ["text", "json", "stream-json"] as const

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export function isValidOutputFormat(format: string): format is OutputFormat {
	return (OUTPUT_FORMATS as readonly string[]).includes(format)
}

/**
 * Event type discriminators for JSON output.
 */
export type JsonEventType =
	| "system" // System messages (init, ready, shutdown)
	| "assistant" // Assistant text messages
	| "user" // User messages (echoed input)
	| "tool_use" // Tool invocations (file ops, commands, browser, MCP)
	| "tool_result" // Results from tool execution
	| "thinking" // Reasoning/thinking content
	| "error" // Errors
	| "result" // Final task result

/**
 * Tool use information for tool_use events.
 */
export interface JsonEventToolUse {
	/** Tool name (e.g., "read_file", "write_to_file", "execute_command") */
	name: string
	/** Tool input parameters */
	input?: Record<string, unknown>
}

/**
 * Tool result information for tool_result events.
 */
export interface JsonEventToolResult {
	/** Tool name that produced this result */
	name: string
	/** Tool output (for successful execution) */
	output?: string
	/** Error message (for failed execution) */
	error?: string
}

/**
 * Cost and token usage information.
 */
export interface JsonEventCost {
	/** Total cost in USD */
	totalCost?: number
	/** Input tokens used */
	inputTokens?: number
	/** Output tokens generated */
	outputTokens?: number
	/** Cache write tokens */
	cacheWrites?: number
	/** Cache read tokens */
	cacheReads?: number
}

/**
 * Base JSON event structure.
 * Optimized for minimal payload size.
 *
 * For streaming deltas:
 * - Each delta includes `id` for easy correlation
 * - Final message has `done: true`
 */
export interface JsonEvent {
	/** Event type discriminator */
	type: JsonEventType
	/** Message ID - included on first delta and final message */
	id?: number
	/** Content text (for text-based events) */
	content?: string
	/** True when this is the final message (stream complete) */
	done?: boolean
	/** Optional subtype for more specific categorization */
	subtype?: string
	/** Tool use information (for tool_use events) */
	tool_use?: JsonEventToolUse
	/** Tool result information (for tool_result events) */
	tool_result?: JsonEventToolResult
	/** Whether the task succeeded (for result events) */
	success?: boolean
	/** Cost and token usage (for result events) */
	cost?: JsonEventCost
}

/**
 * Final JSON output for "json" mode (single object at end).
 * Contains the result and accumulated messages.
 */
export interface JsonFinalOutput {
	/** Final result type */
	type: "result"
	/** Whether the task succeeded */
	success: boolean
	/** Result content/message */
	content?: string
	/** Cost and token usage */
	cost?: JsonEventCost
	/** All events that occurred during the task */
	events: JsonEvent[]
}

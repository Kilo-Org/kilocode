/**
 * JSON output utilities for CI mode
 * Converts messages to JSON format for non-interactive output
 */

import type { UnifiedMessage } from "../../state/atoms/ui.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import type { CliMessage } from "../../types/cli.js"
import { logs } from "../../services/logs.js"

/**
 * Convert a CLI message to JSON output format
 */
function formatCliMessage(message: CliMessage) {
	const { ts, ...restOfMessage } = message
	return {
		timestamp: ts,
		source: "cli",
		...restOfMessage,
	}
}

/**
 * Attempt to parse text as JSON
 * Returns parsed object if successful, null otherwise
 */
function tryParseJson(text: string | undefined): unknown | null {
	if (!text || text.trim() === "") {
		return null
	}

	try {
		const parsed = JSON.parse(text)
		// Only return if it's an object or array (not primitives)
		if (typeof parsed === "object" && parsed !== null) {
			return parsed
		}
		return null
	} catch (error) {
		// Not valid JSON, will be treated as plain text
		logs.debug("Failed to parse message text as JSON", "jsonOutput", {
			error: error instanceof Error ? error.message : String(error),
			textPreview: text.substring(0, 100),
		})
		return null
	}
}

/**
 * Convert an extension message to JSON output format
 *
 * This function handles both JSON and plain text content:
 * - If text is valid JSON (object/array), it's placed in 'metadata' field
 * - If text is plain text or malformed JSON, it's placed in 'content' field
 * - Empty/undefined text is omitted from output
 *
 * This ensures consistent formatting in both CI mode and interactive mode.
 */
function formatExtensionMessage(message: ExtensionChatMessage) {
	const { ts, text, ...restOfMessage } = message

	const output: Record<string, unknown> = {
		timestamp: ts,
		source: "extension",
		...restOfMessage,
	}

	// Try to parse text as JSON
	const parsedJson = tryParseJson(text)

	if (parsedJson !== null) {
		// Valid JSON object/array - place in metadata field
		output.metadata = parsedJson
		logs.debug("Parsed message text as JSON", "jsonOutput", {
			type: message.type,
			ask: message.ask,
			say: message.say,
		})
	} else if (text) {
		// Plain text or malformed JSON - place in content field
		output.content = text
	}
	// If text is empty/undefined, don't add either field

	return output
}

/**
 * Convert a unified message to JSON output format
 */
export function formatMessageAsJson(unifiedMessage: UnifiedMessage) {
	if (unifiedMessage.source === "cli") {
		return formatCliMessage(unifiedMessage.message)
	} else {
		return formatExtensionMessage(unifiedMessage.message)
	}
}

/**
 * Output a message as JSON to stdout
 */
export function outputJsonMessage(unifiedMessage: UnifiedMessage): void {
	const jsonOutput = formatMessageAsJson(unifiedMessage)
	console.log(JSON.stringify(jsonOutput))
}

/**
 * Output multiple messages as JSON array to stdout
 */
export function outputJsonMessages(messages: UnifiedMessage[]): void {
	const jsonOutputs = messages.map(formatMessageAsJson)
	console.log(JSON.stringify(jsonOutputs))
}

/**
 * JSON output utilities for CI mode
 * Converts messages to JSON format for non-interactive output
 */

import type { UnifiedMessage } from "../../state/atoms/ui.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import type { CliMessage } from "../../types/cli.js"

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
 * Convert an extension message to JSON output format
 *
 * If text is valid JSON (object/array), it's placed in 'metadata' field.
 * If text is plain text or malformed JSON, it's placed in 'content' field.
 */
function formatExtensionMessage(message: ExtensionChatMessage) {
	const { ts, text, ...restOfMessage } = message

	const output: Record<string, unknown> = {
		timestamp: ts,
		source: "extension",
		...restOfMessage,
	}

	if (text) {
		try {
			const parsed = JSON.parse(text)
			// Only use metadata for objects/arrays, not primitives
			if (typeof parsed === "object" && parsed !== null) {
				output.metadata = parsed
			} else {
				output.content = text
			}
		} catch {
			output.content = text
		}
	}

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

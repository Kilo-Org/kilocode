/**
 * JSON output utilities for CI mode
 * Converts messages to JSON format for non-interactive output
 *
 * Schema v1.0.0 adds:
 * - schemaVersion: Version identifier for automation compatibility
 * - event: Unified event type for semantic categorization
 * - messageId: Unique identifier for message tracking
 * - status: Message completion status (partial/complete)
 */

import { JSON_SCHEMA_VERSION, type MessageStatus } from "@kilocode/core-schemas"
import type { UnifiedMessage } from "../../state/atoms/ui.js"
import type { ExtensionChatMessage } from "../../types/messages.js"
import type { CliMessage } from "../../types/cli.js"
import { getCliMessageEvent, getExtensionMessageEvent } from "./eventMapper.js"
import { generateCliMessageId, generateExtensionMessageId } from "./messageId.js"

/**
 * Convert a CLI message to JSON output format (v1.0.0)
 */
function formatCliMessage(message: CliMessage) {
	const { ts, ...restOfMessage } = message
	const status: MessageStatus = message.partial ? "partial" : "complete"

	return {
		schemaVersion: JSON_SCHEMA_VERSION,
		messageId: generateCliMessageId(message),
		timestamp: ts,
		source: "cli" as const,
		event: getCliMessageEvent(message),
		status,
		...restOfMessage, // preserves partial for backward compatibility
	}
}

/**
 * Convert an extension message to JSON output format (v1.0.0)
 *
 * If text is valid JSON (object/array), it's placed in 'metadata' field.
 * If text is plain text or malformed JSON, it's placed in 'content' field.
 */
function formatExtensionMessage(message: ExtensionChatMessage) {
	const { ts, text, ...restOfMessage } = message
	const status: MessageStatus = message.partial ? "partial" : "complete"

	const output: Record<string, unknown> = {
		schemaVersion: JSON_SCHEMA_VERSION,
		messageId: generateExtensionMessageId(message),
		timestamp: ts,
		source: "extension" as const,
		event: getExtensionMessageEvent(message),
		status,
		...restOfMessage, // preserves partial for backward compatibility
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

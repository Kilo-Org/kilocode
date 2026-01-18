/**
 * Event mapping utilities for JSON schema contract
 *
 * Maps various message formats to unified event types for consistent
 * automation integration.
 */

import { type OutputEvent, mapCliTypeToEvent, mapAskToEvent, mapSayToEvent } from "@kilocode/core-schemas"
import type { CliMessage } from "../../types/cli.js"
import type { ExtensionChatMessage } from "../../types/messages.js"

/**
 * Get unified event type from a CLI message
 */
export function getCliMessageEvent(message: CliMessage): OutputEvent {
	return mapCliTypeToEvent(message.type)
}

/**
 * Get unified event type from an extension message
 */
export function getExtensionMessageEvent(message: ExtensionChatMessage): OutputEvent {
	if (message.type === "ask" && message.ask) {
		return mapAskToEvent(message.ask)
	}

	if (message.type === "say" && message.say) {
		return mapSayToEvent(message.say)
	}

	return "unknown"
}

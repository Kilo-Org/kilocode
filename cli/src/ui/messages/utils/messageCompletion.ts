/**
 * Message completion utilities for determining when messages are ready for static rendering
 *
 * This module provides logic to determine if messages are "complete" and can be moved
 * to the static rendering section, preventing unnecessary re-renders and improving performance.
 */

import type { UnifiedMessage } from "../../../state/atoms/ui.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import type { CliMessage } from "../../../types/cli.js"
import { parseApiReqInfo } from "../extension/utils.js"

/**
 * Determines if a CLI message is complete
 * CLI messages are complete when they are not marked as partial
 */
function isCliMessageComplete(message: CliMessage): boolean {
	const isComplete = message.partial !== true
	return isComplete
}

/**
 * Determines if an extension message is complete based on its type and state
 *
 * Completion rules:
 * - Messages with partial=true are never complete
 * - api_req_started requires specific completion indicators
 * - ask messages require isAnswered=true
 * - All other messages are complete if not partial
 */
function isExtensionMessageComplete(message: ExtensionChatMessage): boolean {
	// Handle partial flag first - if partial is explicitly true, not complete
	if (message.partial === true) {
		return false
	}

	// Special handling for api_req_started
	// This message type needs additional attributes to be considered complete
	if (message.say === "api_req_started") {
		const apiInfo = parseApiReqInfo(message)
		const isComplete = !!(apiInfo?.streamingFailedMessage || apiInfo?.cancelReason || apiInfo?.cost !== undefined)
		return isComplete
	}

	// Ask messages completion logic
	if (message.type === "ask") {
		// These ask types don't render, so they're immediately complete
		const nonRenderingAskTypes = ["completion_result"]
		if (message.ask && nonRenderingAskTypes.includes(message.ask)) {
			return true
		}

		// Ask messages are complete once they're in final form (not partial)
		// They don't need to wait for isAnswered since they're just displaying
		// the request and waiting for user interaction
		const isComplete = !message.partial
		return isComplete
	}

	return true
}

/**
 * Determines if a unified message is complete
 * Routes to appropriate completion checker based on message source
 */
export function isMessageComplete(message: UnifiedMessage): boolean {
	if (message.source === "cli") {
		return isCliMessageComplete(message.message)
	}
	return isExtensionMessageComplete(message.message)
}
/**
 * Deduplicates checkpoint_saved messages with the same hash
 * Keeps only the first occurrence of each unique checkpoint hash
 */
function deduplicateCheckpointMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
	const seenCheckpointHashes = new Set<string>()
	const deduplicated: UnifiedMessage[] = []

	for (const msg of messages) {
		// Only deduplicate checkpoint_saved messages
		if (
			msg.source === "extension" &&
			msg.message.type === "say" &&
			msg.message.say === "checkpoint_saved" &&
			msg.message.text
		) {
			const hash = msg.message.text.trim()
			if (seenCheckpointHashes.has(hash)) {
				// Skip duplicate checkpoint
				continue
			}
			seenCheckpointHashes.add(hash)
		}

		deduplicated.push(msg)
	}

	return deduplicated
}

/**
 * Splits messages into static (complete) and dynamic (incomplete) arrays
 *
 * IMPORTANT: Ensures sequential completion - a message can only be marked as static
 * if ALL previous messages are also complete. This prevents:
 * - Mixed ordering in the static section
 * - Partial messages appearing before completed ones
 * - Visual jumping when messages complete out of order
 *
 * @param messages - Array of unified messages in chronological order
 * @param options - Optional behavior flags
 * @returns Object with staticMessages (complete) and dynamicMessages (incomplete)
 */
export interface SplitMessagesOptions {
	/**
	 * When true, hides all partial messages and treats everything else as static.
	 * This enables a "pure static" mode where nothing streams to the terminal.
	 */
	hidePartialMessages?: boolean
}

export function splitMessages(
	messages: UnifiedMessage[],
	options?: SplitMessagesOptions,
): {
	staticMessages: UnifiedMessage[]
	dynamicMessages: UnifiedMessage[]
} {
	// First, deduplicate checkpoint messages
	const deduplicatedMessages = deduplicateCheckpointMessages(messages)

	// hide any partial messages and treat everything else as static.
	if (options?.hidePartialMessages) {
		const filteredMessages = deduplicatedMessages.filter(
			(msg) => (msg.message as { partial?: boolean }).partial !== true,
		)

		// After filtering out streaming messages, fall back to the normal split logic.
		// This keeps ordering stable: incomplete messages (e.g. api_req_started without cost)
		// stay in the dynamic section until they receive completion indicators.
		return splitMessages(filteredMessages)
	}

	let lastCompleteIndex = -1
	const incompleteReasons: Array<{ index: number; reason: string; message: unknown }> = []

	// Find the last consecutive index where all messages up to that point are complete
	for (let i = 0; i < deduplicatedMessages.length; i++) {
		const msg = deduplicatedMessages[i]!
		if (isMessageComplete(msg)) {
			// Only advance if this is the next consecutive complete message
			if (i === 0 || i === lastCompleteIndex + 1) {
				lastCompleteIndex = i
			} else {
				// Gap found - an earlier message is incomplete, stop here
				incompleteReasons.push({
					index: i,
					reason: "Gap in completion - previous message incomplete",
					message: {
						source: msg.source,
						...(msg.source === "cli" ? { id: msg.message.id } : { ts: msg.message.ts }),
					},
				})
				break
			}
		} else {
			// Incomplete message found - stop here
			incompleteReasons.push({
				index: i,
				reason: "Message not complete",
				message: {
					source: msg.source,
					...(msg.source === "cli"
						? { id: msg.message.id, partial: msg.message.partial }
						: {
								ts: msg.message.ts,
								type: msg.message.type,
								say: msg.message.say,
								ask: msg.message.ask,
								partial: msg.message.partial,
								isAnswered: msg.message.isAnswered,
							}),
				},
			})
			break
		}
	}

	const staticMessages = deduplicatedMessages.slice(0, lastCompleteIndex + 1)
	const dynamicMessages = deduplicatedMessages.slice(lastCompleteIndex + 1)

	return {
		staticMessages,
		dynamicMessages,
	}
}

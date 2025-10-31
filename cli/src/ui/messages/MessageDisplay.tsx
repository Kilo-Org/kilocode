/**
 * MessageDisplay component - displays chat messages from both CLI and extension state
 * Uses Ink Static component to optimize rendering of completed messages
 *
 * Performance Optimization:
 * ------------------------
 * Messages are split into two sections:
 * 1. Static section: Completed messages that won't change (rendered once with Ink Static)
 * 2. Dynamic section: Incomplete/updating messages (re-rendered as needed)
 *
 * This prevents unnecessary re-renders of completed messages, improving performance
 * especially in long conversations.
 *
 * Message Completion Logic:
 * -------------------------
 * A message is considered complete when:
 * - CLI messages: partial !== true
 * - Extension messages: depends on type (see messageCompletion.ts)
 * - Sequential rule: A message can only be static if all previous messages are complete
 *
 * Key Generation Strategy:
 * -----------------------
 * To prevent React duplicate key warnings when multiple messages are created within
 * the same millisecond (same timestamp), we use a composite key strategy:
 *
 * For CLI messages:
 *   - Uses the unique message ID: `cli-${id}`
 *
 * For Extension messages:
 *   - Combines multiple properties to ensure uniqueness:
 *     `ext-${timestamp}-${type}-${subtype}-${index}`
 *   - timestamp: Message creation time (may not be unique)
 *   - type: "say" or "ask"
 *   - subtype: Specific message type (e.g., "completion_result", "text")
 *   - index: Array position (final guarantee of uniqueness)
 *
 * This ensures stable, unique keys even when messages are created rapidly.
 */

import React from "react"
import { Box, Static } from "ink"
import { useAtomValue } from "jotai"
import { type UnifiedMessage, staticMessagesAtom, dynamicMessagesAtom } from "../../state/atoms/ui.js"
import { MessageRow } from "./MessageRow.js"

interface MessageDisplayProps {
	/** Optional filter to show only specific message types */
	filterType?: "ask" | "say"
	/** Maximum number of messages to display (default: all) */
	maxMessages?: number
}

/**
 * Generate a unique key for a unified message
 * Uses a composite key strategy to ensure uniqueness even when messages
 * have identical timestamps (created within the same millisecond)
 */
function getMessageKey(msg: UnifiedMessage, index: number): string {
	if (msg.source === "cli") {
		return `cli-${msg.message.id}`
	}

	// For extension messages, create a composite key from multiple properties
	const extMsg = msg.message
	const baseKey = `ext-${extMsg.ts}`

	// Add message type (say/ask) for additional uniqueness
	const typeKey = `${baseKey}-${extMsg.type}`

	// Add subtype (completion_result, text, etc.) if available
	let subtypeKey = typeKey
	if (extMsg.type === "say" && extMsg.say) {
		subtypeKey = `${typeKey}-${extMsg.say}`
	} else if (extMsg.type === "ask" && extMsg.ask) {
		subtypeKey = `${typeKey}-${extMsg.ask}`
	}

	// Add index as final guarantee of uniqueness
	return `${subtypeKey}-${index}`
}

export const MessageDisplay: React.FC<MessageDisplayProps> = () => {
	const staticMessages = useAtomValue(staticMessagesAtom)
	const dynamicMessages = useAtomValue(dynamicMessagesAtom)

	if (staticMessages.length === 0 && dynamicMessages.length === 0) {
		return null
	}

	return (
		<Box flexDirection="column">
			{/* Static section for completed messages - won't re-render */}
			{/* Key includes resetCounter to force re-mount when messages are replaced */}
			{staticMessages.length > 0 && (
				<Static items={staticMessages}>
					{(message, index) => (
						<Box key={getMessageKey(message, index)} paddingX={1}>
							<MessageRow unifiedMessage={message} />
						</Box>
					)}
				</Static>
			)}

			{/* Dynamic section for incomplete/updating messages - will re-render */}
			{dynamicMessages.map((unifiedMsg, index) => (
				<Box paddingX={1} key={getMessageKey(unifiedMsg, staticMessages.length + index)}>
					<MessageRow unifiedMessage={unifiedMsg} />
				</Box>
			))}
		</Box>
	)
}

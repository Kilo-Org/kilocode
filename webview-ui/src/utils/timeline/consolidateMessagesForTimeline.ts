import type { ClineMessage } from "@roo-code/types"
import { combineApiRequests } from "@roo/combineApiRequests"
import { combineCommandSequences } from "@roo/combineCommandSequences"
import { shouldShowInTimeline } from "../messageColors"

/**
 * Processes grouped messages using the existing shared utilities:
 * 1. Flattens grouped messages to individual messages
 * 2. Combines related messages (API requests, command sequences) using existing utilities
 * 3. Filters out unwanted message types
 * 4. Returns processed messages with original index mapping
 */
export function consolidateMessagesForTimeline(groupedMessages: (ClineMessage | ClineMessage[])[]): {
	processedMessages: ClineMessage[]
	messageToOriginalIndex: Map<ClineMessage, number>
} {
	if (groupedMessages.length <= 1) {
		return {
			processedMessages: [],
			messageToOriginalIndex: new Map(),
		}
	}

	// Flatten grouped messages to individual messages
	const flatMessages: ClineMessage[] = []
	const messageToOriginalIndex: Map<ClineMessage, number> = new Map()

	// Skip first message like Cline
	for (let i = 1; i < groupedMessages.length; i++) {
		const messageOrGroup = groupedMessages[i]
		if (Array.isArray(messageOrGroup)) {
			// Handle grouped messages - add each individual message
			messageOrGroup.forEach((msg) => {
				flatMessages.push(msg)
				messageToOriginalIndex.set(msg, i)
			})
		} else {
			// Handle single message
			flatMessages.push(messageOrGroup)
			messageToOriginalIndex.set(messageOrGroup, i)
		}
	}

	// Apply existing shared utilities for message combination
	const afterCommandCombining = combineCommandSequences(flatMessages)
	const combinedMessages = combineApiRequests(afterCommandCombining)

	// For combined messages that aren't in the original mapping,
	// find their original index by looking at their timestamp
	const updatedMapping = new Map(messageToOriginalIndex)
	combinedMessages.forEach((msg: ClineMessage) => {
		if (!updatedMapping.has(msg)) {
			// Find the original message with the same timestamp
			const originalMsg = flatMessages.find((original) => original.ts === msg.ts)
			if (originalMsg && messageToOriginalIndex.has(originalMsg)) {
				updatedMapping.set(msg, messageToOriginalIndex.get(originalMsg)!)
			}
		}
	})
	const processedMessages = combinedMessages.filter(shouldShowInTimeline)

	return {
		processedMessages,
		messageToOriginalIndex: updatedMapping,
	}
}

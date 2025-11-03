/**
 * Utility functions for message handling in Task
 * @kilocode_change - Created to fix orphaned partial ask messages bug
 */

import type { ClineMessage, ClineAsk, ClineSay } from "@roo-code/types"

/**
 * Search backwards through messages to find the most recent partial ask message
 * of the specified type. This handles cases where non-interactive messages
 * (like checkpoint_saved) are inserted between partial start and completion.
 *
 * @param messages - Array of Cline messages to search
 * @param type - The ask type to search for
 * @returns The partial message and its index, or undefined if not found
 */
export function findPartialAskMessage(
	messages: ClineMessage[],
	type: ClineAsk,
): { message: ClineMessage; index: number } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "ask" && msg.ask === type && msg.partial === true) {
			return { message: msg, index: i }
		}
	}
	return undefined
}

/**
 * Search backwards through messages to find the most recent partial say message
 * of the specified type. Similar to findPartialAskMessage but for say messages.
 *
 * @param messages - Array of Cline messages to search
 * @param type - The say type to search for
 * @returns The partial message and its index, or undefined if not found
 */
export function findPartialSayMessage(
	messages: ClineMessage[],
	type: ClineSay,
): { message: ClineMessage; index: number } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "say" && msg.say === type && msg.partial === true) {
			return { message: msg, index: i }
		}
	}
	return undefined
}

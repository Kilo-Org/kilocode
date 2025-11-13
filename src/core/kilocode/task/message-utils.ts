/**
 * Utility functions for message handling in Task
 * kilocode_change - Created to fix orphaned partial ask messages bug
 */

import pWaitFor from "p-wait-for"
import type { ClineMessage, ClineAsk, ClineSay } from "@roo-code/types"

const GUARD_TIMEOUT = 30 * 1000 // 30 seconds
const GUARD_INTERVAL = 50 // 50 milliseconds

/**
 * Message insertion guard to prevent concurrent message insertions.
 * This prevents race conditions where checkpoint_saved messages can arrive
 * during partial message updates, breaking message history order.
 */
export class MessageInsertionGuard {
	private isInserting = false
	private readonly timeout: number
	private readonly interval: number

	constructor(timeout = GUARD_TIMEOUT, interval = GUARD_INTERVAL) {
		this.timeout = timeout
		this.interval = interval
	}

	/**
	 * Wait for any in-flight message insertions to complete before proceeding.
	 * This ensures messages are inserted sequentially and prevents race conditions.
	 */
	async waitForClearance(): Promise<void> {
		await pWaitFor(() => !this.isInserting, {
			interval: this.interval,
			timeout: this.timeout,
		})
	}

	/**
	 * Acquire the insertion lock. Must be released with release() after insertion completes.
	 */
	acquire(): void {
		this.isInserting = true
	}

	/**
	 * Release the insertion lock, allowing other insertions to proceed.
	 */
	release(): void {
		this.isInserting = false
	}

	/**
	 * Check if a message insertion is currently in progress.
	 */
	isLocked(): boolean {
		return this.isInserting
	}
}

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

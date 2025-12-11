import { Task } from "../task/Task"
import { ClineMessage } from "@roo-code/types"
import { ApiMessage } from "../task-persistence/apiMessages"
import { cleanupAfterTruncation } from "../condense"

export interface RewindOptions {
	/** Whether to include the target message in deletion (edit=true, delete=false) */
	includeTargetMessage?: boolean
	/** Skip cleanup for special cases (default: false) */
	skipCleanup?: boolean
}

interface ContextEventIds {
	condenseIds: Set<string>
	truncationIds: Set<string>
}

/**
 * MessageManager provides centralized handling for all conversation rewind operations.
 *
 * This ensures that whenever UI chat history is rewound (delete, edit, checkpoint restore, etc.),
 * the API conversation history is properly maintained, including:
 * - Removing orphaned Summary messages when their condense_context is removed
 * - Removing orphaned truncation markers when their sliding_window_truncation is removed
 * - Cleaning up orphaned condenseParent/truncationParent tags
 *
 * Usage (always access via Task.messageManager getter):
 * ```typescript
 * await task.messageManager.rewindToTimestamp(messageTs, { includeTargetMessage: false })
 * ```
 *
 * @see Task.messageManager - The getter that provides lazy-initialized access to this manager
 */
export class MessageManager {
	constructor(private task: Task) {}

	/**
	 * Rewind conversation to a specific timestamp.
	 * This is the SINGLE entry point for all message deletion operations.
	 *
	 * @param ts - The timestamp to rewind to
	 * @param options - Rewind options
	 * @throws Error if timestamp not found in clineMessages
	 */
	async rewindToTimestamp(ts: number, options: RewindOptions = {}): Promise<void> {
		const { includeTargetMessage = false, skipCleanup = false } = options

		// Find the index in clineMessages
		const clineIndex = this.task.clineMessages.findIndex((m) => m.ts === ts)
		if (clineIndex === -1) {
			throw new Error(`Message with timestamp ${ts} not found in clineMessages`)
		}

		// Calculate the actual cutoff index
		const cutoffIndex = includeTargetMessage ? clineIndex + 1 : clineIndex

		await this.performRewind(cutoffIndex, ts, { skipCleanup })
	}

	/**
	 * Rewind conversation to a specific index in clineMessages.
	 * Keeps messages [0, toIndex) and removes [toIndex, end].
	 *
	 * @param toIndex - The index to rewind to (exclusive)
	 * @param options - Rewind options
	 */
	async rewindToIndex(toIndex: number, options: RewindOptions = {}): Promise<void> {
		const cutoffTs = this.task.clineMessages[toIndex]?.ts ?? Date.now()
		await this.performRewind(toIndex, cutoffTs, options)
	}

	/**
	 * Internal method that performs the actual rewind operation.
	 */
	private async performRewind(toIndex: number, cutoffTs: number, options: RewindOptions): Promise<void> {
		const { skipCleanup = false } = options

		// Step 1: Collect context event IDs from messages being removed
		const removedIds = this.collectRemovedContextEventIds(toIndex)

		// Step 2: Truncate clineMessages
		await this.truncateClineMessages(toIndex)

		// Step 3: Truncate and clean API history (combined with cleanup for efficiency)
		await this.truncateApiHistoryWithCleanup(cutoffTs, removedIds, skipCleanup)
	}

	/**
	 * Collect condenseIds and truncationIds from context-management events
	 * that will be removed during the rewind.
	 *
	 * This is critical for maintaining the linkage between:
	 * - condense_context (clineMessage) ↔ Summary (apiMessage)
	 * - sliding_window_truncation (clineMessage) ↔ Truncation marker (apiMessage)
	 */
	private collectRemovedContextEventIds(fromIndex: number): ContextEventIds {
		const condenseIds = new Set<string>()
		const truncationIds = new Set<string>()

		for (let i = fromIndex; i < this.task.clineMessages.length; i++) {
			const msg = this.task.clineMessages[i]

			// Collect condenseIds from condense_context events
			if (msg.say === "condense_context" && msg.contextCondense?.condenseId) {
				condenseIds.add(msg.contextCondense.condenseId)
				console.log(`[MessageManager] Found condense_context to remove: ${msg.contextCondense.condenseId}`)
			}

			// Collect truncationIds from sliding_window_truncation events
			if (msg.say === "sliding_window_truncation" && msg.contextTruncation?.truncationId) {
				truncationIds.add(msg.contextTruncation.truncationId)
				console.log(
					`[MessageManager] Found sliding_window_truncation to remove: ${msg.contextTruncation.truncationId}`,
				)
			}
		}

		return { condenseIds, truncationIds }
	}

	/**
	 * Truncate clineMessages to the specified index.
	 */
	private async truncateClineMessages(toIndex: number): Promise<void> {
		await this.task.overwriteClineMessages(this.task.clineMessages.slice(0, toIndex))
	}

	/**
	 * Truncate API history by timestamp, remove orphaned summaries/markers,
	 * and clean up orphaned tags - all in a single write operation.
	 *
	 * This combined approach:
	 * 1. Avoids multiple writes to API history
	 * 2. Only writes if the history actually changed
	 * 3. Handles both truncation and cleanup atomically
	 */
	private async truncateApiHistoryWithCleanup(
		cutoffTs: number,
		removedIds: ContextEventIds,
		skipCleanup: boolean,
	): Promise<void> {
		const originalHistory = this.task.apiConversationHistory
		let apiHistory = [...originalHistory]

		// Step 1: Filter by timestamp
		apiHistory = apiHistory.filter((m) => !m.ts || m.ts < cutoffTs)

		// Step 2: Remove Summaries whose condense_context was removed
		if (removedIds.condenseIds.size > 0) {
			apiHistory = apiHistory.filter((msg) => {
				if (msg.isSummary && msg.condenseId && removedIds.condenseIds.has(msg.condenseId)) {
					console.log(`[MessageManager] Removing orphaned Summary with condenseId: ${msg.condenseId}`)
					return false
				}
				return true
			})
		}

		// Step 3: Remove truncation markers whose sliding_window_truncation was removed
		if (removedIds.truncationIds.size > 0) {
			apiHistory = apiHistory.filter((msg) => {
				if (msg.isTruncationMarker && msg.truncationId && removedIds.truncationIds.has(msg.truncationId)) {
					console.log(
						`[MessageManager] Removing orphaned truncation marker with truncationId: ${msg.truncationId}`,
					)
					return false
				}
				return true
			})
		}

		// Step 4: Cleanup orphaned tags (unless skipped)
		if (!skipCleanup) {
			apiHistory = cleanupAfterTruncation(apiHistory)
		}

		// Only write if the history actually changed
		const historyChanged =
			apiHistory.length !== originalHistory.length || apiHistory.some((msg, i) => msg !== originalHistory[i])

		if (historyChanged) {
			await this.task.overwriteApiConversationHistory(apiHistory)
		}
	}
}

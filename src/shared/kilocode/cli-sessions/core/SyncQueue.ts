import { DEFAULT_CONFIG } from "../config.js"

/**
 * SyncQueueItem - Represents a single item in the sync queue.
 *
 * Each item tracks a file update that needs to be synced to the cloud.
 */
export interface SyncQueueItem {
	/** The task ID this item belongs to */
	taskId: string
	/** The blob name (e.g., 'api_conversation_history', 'ui_messages', 'task_metadata') */
	blobName: string
	/** The local file path containing the blob data */
	blobPath: string
	/** Timestamp when this item was added to the queue */
	timestamp: number
}

/**
 * SyncQueue - Manages the queue of pending sync operations.
 *
 * This class encapsulates all queue operations for session synchronization,
 * providing a clean interface for:
 * - Adding items to the queue
 * - Querying items by task or blob name
 * - Removing processed items
 * - Queue state inspection
 *
 * Extracted from SessionManager as part of the refactoring effort to improve
 * maintainability and testability through separation of concerns.
 */
export class SyncQueue {
	private readonly queueFlushThreshold: number

	private items: SyncQueueItem[] = []
	private taskIndex: Map<string, SyncQueueItem[]> = new Map()
	private blobIndex: Map<string, SyncQueueItem> = new Map() // key: `${taskId}:${blobName}`
	private flushHandler: (() => Promise<void>) | null = null

	/**
	 * Creates a new SyncQueue instance.
	 *
	 * @param queueFlushThreshold - Optional threshold for triggering automatic flush.
	 *                              Defaults to the value from DEFAULT_CONFIG.
	 */
	constructor(queueFlushThreshold: number = DEFAULT_CONFIG.sync.queueFlushThreshold) {
		this.queueFlushThreshold = queueFlushThreshold
	}

	/**
	 * Sets the flush handler that will be called when the queue needs to be flushed.
	 * This uses setter injection to avoid circular dependencies in the constructor.
	 */
	setFlushHandler(handler: () => Promise<void>): void {
		this.flushHandler = handler
	}

	/**
	 * Adds an item to the queue.
	 */
	enqueue(item: SyncQueueItem): void {
		this.items.push(item)

		// Update task index
		const taskItems = this.taskIndex.get(item.taskId) || []
		taskItems.push(item)
		this.taskIndex.set(item.taskId, taskItems)

		// Update blob index (keep only latest)
		const blobKey = `${item.taskId}:${item.blobName}`
		this.blobIndex.set(blobKey, item)

		if (this.length > this.queueFlushThreshold) {
			this.flushHandler?.()
		}
	}

	/**
	 * Gets all items currently in the queue.
	 * Returns a copy to prevent external mutation.
	 */
	getAll(): SyncQueueItem[] {
		return [...this.items]
	}

	/**
	 * Gets all items for a specific task.
	 */
	getItemsForTask(taskId: string): SyncQueueItem[] {
		return this.taskIndex.get(taskId) || []
	}

	/**
	 * Gets all unique task IDs in the queue.
	 */
	getUniqueTaskIds(): Set<string> {
		return new Set(this.items.map((item) => item.taskId))
	}

	/**
	 * Gets all unique blob names for items belonging to a specific task.
	 */
	getUniqueBlobNamesForTask(taskId: string): Set<string> {
		const taskItems = this.getItemsForTask(taskId)
		return new Set(taskItems.map((item) => item.blobName))
	}

	/**
	 * Gets the last item for a specific blob name within a task's items.
	 * Uses the blob index for O(1) lookup.
	 */
	getLastItemForBlob(taskId: string, blobName: string): SyncQueueItem | undefined {
		return this.blobIndex.get(`${taskId}:${blobName}`)
	}

	/**
	 * Gets the last item in the queue.
	 */
	getLastItem(): SyncQueueItem | undefined {
		return this.items[this.items.length - 1]
	}

	/**
	 * Removes all items matching the specified criteria that were added
	 * at or before the given timestamp.
	 *
	 * This is used after a successful blob upload to remove all queued
	 * items that were included in that upload.
	 */
	removeProcessedItems(taskId: string, blobName: string, beforeTimestamp: number): void {
		this.items = this.items.filter(
			(item) => !(item.taskId === taskId && item.blobName === blobName && item.timestamp <= beforeTimestamp),
		)

		// Rebuild task index for affected task
		const remainingTaskItems = this.items.filter((item) => item.taskId === taskId)
		if (remainingTaskItems.length > 0) {
			this.taskIndex.set(taskId, remainingTaskItems)
		} else {
			this.taskIndex.delete(taskId)
		}

		// Update blob index - find the latest item for this blob if any remain
		const blobKey = `${taskId}:${blobName}`
		const remainingBlobItems = this.items.filter((item) => item.taskId === taskId && item.blobName === blobName)
		if (remainingBlobItems.length > 0) {
			// Set to the last remaining item (most recent)
			this.blobIndex.set(blobKey, remainingBlobItems[remainingBlobItems.length - 1]!)
		} else {
			this.blobIndex.delete(blobKey)
		}
	}

	/**
	 * Clears all items from the queue.
	 */
	clear(): void {
		this.items = []
		this.taskIndex.clear()
		this.blobIndex.clear()
	}

	/**
	 * Gets the number of items in the queue.
	 */
	get length(): number {
		return this.items.length
	}

	/**
	 * Checks if the queue is empty.
	 */
	get isEmpty(): boolean {
		return this.items.length === 0
	}
}

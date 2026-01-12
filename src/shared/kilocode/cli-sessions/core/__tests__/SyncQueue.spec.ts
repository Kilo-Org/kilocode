import { SyncQueue, SyncQueueItem } from "../SyncQueue"

describe("SyncQueue", () => {
	let queue: SyncQueue

	beforeEach(() => {
		queue = new SyncQueue()
	})

	describe("Basic Queue Operations", () => {
		it("isEmpty returns true for new queue", () => {
			expect(queue.isEmpty).toBe(true)
		})

		it("length returns 0 for new queue", () => {
			expect(queue.length).toBe(0)
		})

		it("enqueue adds item to queue", () => {
			const item: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file.json",
				timestamp: Date.now(),
			}

			queue.enqueue(item)

			expect(queue.length).toBe(1)
			expect(queue.isEmpty).toBe(false)
		})

		it("getAll returns copy of all items", () => {
			const item: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file.json",
				timestamp: Date.now(),
			}

			queue.enqueue(item)
			const allItems = queue.getAll()

			expect(allItems).toHaveLength(1)
			expect(allItems[0]).toEqual(item)
		})

		it("getAll returns copy not reference", () => {
			const item: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file.json",
				timestamp: Date.now(),
			}

			queue.enqueue(item)
			const allItems = queue.getAll()

			// Modifying the returned array should not affect the queue
			allItems.pop()
			expect(queue.length).toBe(1)
		})

		it("clear removes all items", () => {
			const item: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file.json",
				timestamp: Date.now(),
			}

			queue.enqueue(item)
			queue.clear()

			expect(queue.length).toBe(0)
			expect(queue.isEmpty).toBe(true)
		})
	})

	describe("Task-Based Operations", () => {
		it("getItemsForTask returns empty array for unknown task", () => {
			const items = queue.getItemsForTask("unknown-task")

			expect(items).toEqual([])
		})

		it("getItemsForTask returns items for specific task", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "ui_messages",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}
			const item3: SyncQueueItem = {
				taskId: "task-2",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file3.json",
				timestamp: 3000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)
			queue.enqueue(item3)

			const task1Items = queue.getItemsForTask("task-1")
			const task2Items = queue.getItemsForTask("task-2")

			expect(task1Items).toHaveLength(2)
			expect(task1Items).toEqual([item1, item2])
			expect(task2Items).toHaveLength(1)
			expect(task2Items).toEqual([item3])
		})

		it("getUniqueTaskIds returns set of all task IDs", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-2",
				blobName: "ui_messages",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}
			const item3: SyncQueueItem = {
				taskId: "task-1",
				blobName: "task_metadata",
				blobPath: "/path/to/file3.json",
				timestamp: 3000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)
			queue.enqueue(item3)

			const uniqueTaskIds = queue.getUniqueTaskIds()

			expect(uniqueTaskIds).toEqual(new Set(["task-1", "task-2"]))
		})

		it("getUniqueBlobNamesForTask returns blob names for task", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "ui_messages",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}
			const item3: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file3.json",
				timestamp: 3000,
			}
			const item4: SyncQueueItem = {
				taskId: "task-2",
				blobName: "task_metadata",
				blobPath: "/path/to/file4.json",
				timestamp: 4000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)
			queue.enqueue(item3)
			queue.enqueue(item4)

			const task1BlobNames = queue.getUniqueBlobNamesForTask("task-1")
			const task2BlobNames = queue.getUniqueBlobNamesForTask("task-2")

			expect(task1BlobNames).toEqual(new Set(["api_conversation_history", "ui_messages"]))
			expect(task2BlobNames).toEqual(new Set(["task_metadata"]))
		})
	})

	describe("Blob Index Operations", () => {
		it("getLastItemForBlob returns undefined for unknown blob", () => {
			const item = queue.getLastItemForBlob("task-1", "unknown-blob")

			expect(item).toBeUndefined()
		})

		it("getLastItemForBlob returns latest item for blob", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}
			const item3: SyncQueueItem = {
				taskId: "task-1",
				blobName: "ui_messages",
				blobPath: "/path/to/file3.json",
				timestamp: 3000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)
			queue.enqueue(item3)

			const lastApiItem = queue.getLastItemForBlob("task-1", "api_conversation_history")
			const lastUiItem = queue.getLastItemForBlob("task-1", "ui_messages")

			expect(lastApiItem).toEqual(item2)
			expect(lastUiItem).toEqual(item3)
		})

		it("enqueue updates blob index with latest item", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}

			queue.enqueue(item1)
			expect(queue.getLastItemForBlob("task-1", "api_conversation_history")).toEqual(item1)

			queue.enqueue(item2)
			expect(queue.getLastItemForBlob("task-1", "api_conversation_history")).toEqual(item2)
		})
	})

	describe("Item Removal", () => {
		it("removeProcessedItems removes matching items", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}
			const item3: SyncQueueItem = {
				taskId: "task-1",
				blobName: "ui_messages",
				blobPath: "/path/to/file3.json",
				timestamp: 3000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)
			queue.enqueue(item3)

			queue.removeProcessedItems("task-1", "api_conversation_history", 2500)

			expect(queue.length).toBe(1)
			expect(queue.getAll()).toEqual([item3])
		})

		it("removeProcessedItems only removes items at or before timestamp", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}
			const item3: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file3.json",
				timestamp: 3000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)
			queue.enqueue(item3)

			queue.removeProcessedItems("task-1", "api_conversation_history", 1500)

			expect(queue.length).toBe(2)
			expect(queue.getAll()).toEqual([item2, item3])
		})

		it("removeProcessedItems updates task index", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "ui_messages",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)

			queue.removeProcessedItems("task-1", "api_conversation_history", 1500)

			expect(queue.getItemsForTask("task-1")).toEqual([item2])
		})

		it("removeProcessedItems updates blob index", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)

			queue.removeProcessedItems("task-1", "api_conversation_history", 1500)

			expect(queue.getLastItemForBlob("task-1", "api_conversation_history")).toEqual(item2)
		})

		it("removeProcessedItems handles empty queue", () => {
			expect(() => {
				queue.removeProcessedItems("task-1", "api_conversation_history", 1000)
			}).not.toThrow()

			expect(queue.length).toBe(0)
		})

		it("removeProcessedItems removes all items for task when all match", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}
			const item3: SyncQueueItem = {
				taskId: "task-2",
				blobName: "ui_messages",
				blobPath: "/path/to/file3.json",
				timestamp: 3000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)
			queue.enqueue(item3)

			queue.removeProcessedItems("task-1", "api_conversation_history", 2500)

			expect(queue.getItemsForTask("task-1")).toEqual([])
			expect(queue.getItemsForTask("task-2")).toEqual([item3])
		})
	})

	describe("Flush Handler", () => {
		let mockFlushHandler: ReturnType<typeof vi.fn>

		beforeEach(() => {
			mockFlushHandler = vi.fn().mockResolvedValue(undefined)
			queue.setFlushHandler(mockFlushHandler)
		})

		it("setFlushHandler stores handler", () => {
			const handler = vi.fn().mockResolvedValue(undefined)
			queue.setFlushHandler(handler)

			// Handler is stored internally, we can test by triggering flush
			const item: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file.json",
				timestamp: Date.now(),
			}

			// Create a queue with threshold 0 to trigger flush on first enqueue
			const smallQueue = new SyncQueue(0)
			smallQueue.setFlushHandler(handler)
			smallQueue.enqueue(item)

			expect(handler).toHaveBeenCalledTimes(1)
		})

		it("enqueue triggers flush when threshold exceeded", () => {
			const smallQueue = new SyncQueue(2) // threshold of 2
			smallQueue.setFlushHandler(mockFlushHandler)

			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "ui_messages",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}
			const item3: SyncQueueItem = {
				taskId: "task-1",
				blobName: "task_metadata",
				blobPath: "/path/to/file3.json",
				timestamp: 3000,
			}

			smallQueue.enqueue(item1)
			expect(mockFlushHandler).not.toHaveBeenCalled()

			smallQueue.enqueue(item2)
			expect(mockFlushHandler).not.toHaveBeenCalled()

			smallQueue.enqueue(item3)
			expect(mockFlushHandler).toHaveBeenCalledTimes(1)
		})

		it("enqueue does not trigger flush below threshold", () => {
			const smallQueue = new SyncQueue(3) // threshold of 3
			smallQueue.setFlushHandler(mockFlushHandler)

			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "ui_messages",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}

			smallQueue.enqueue(item1)
			smallQueue.enqueue(item2)

			expect(mockFlushHandler).not.toHaveBeenCalled()
		})

		it("flush handler is called with correct context", async () => {
			const smallQueue = new SyncQueue(0) // threshold 0 to trigger on first enqueue
			smallQueue.setFlushHandler(mockFlushHandler)

			const item: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file.json",
				timestamp: Date.now(),
			}

			smallQueue.enqueue(item)

			expect(mockFlushHandler).toHaveBeenCalledTimes(1)
			expect(mockFlushHandler).toHaveBeenCalledWith()
		})
	})

	describe("Edge Cases", () => {
		it("getLastItem returns undefined for empty queue", () => {
			const lastItem = queue.getLastItem()

			expect(lastItem).toBeUndefined()
		})

		it("getLastItem returns last enqueued item", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "ui_messages",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)

			expect(queue.getLastItem()).toEqual(item2)
		})

		it("multiple items for same task and blob", () => {
			const item1: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file1.json",
				timestamp: 1000,
			}
			const item2: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file2.json",
				timestamp: 2000,
			}
			const item3: SyncQueueItem = {
				taskId: "task-1",
				blobName: "api_conversation_history",
				blobPath: "/path/to/file3.json",
				timestamp: 3000,
			}

			queue.enqueue(item1)
			queue.enqueue(item2)
			queue.enqueue(item3)

			expect(queue.getItemsForTask("task-1")).toHaveLength(3)
			expect(queue.getLastItemForBlob("task-1", "api_conversation_history")).toEqual(item3)
			expect(queue.getUniqueBlobNamesForTask("task-1")).toEqual(new Set(["api_conversation_history"]))
		})
	})
})

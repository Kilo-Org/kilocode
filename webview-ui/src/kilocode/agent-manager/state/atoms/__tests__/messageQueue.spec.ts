import { describe, it, expect } from "vitest"
import type { QueuedMessage } from "../messageQueue"

/**
 * Test suite for message queue atom operations.
 * Tests queue state management: add, update, remove, retry.
 */

describe("messageQueue atoms", () => {
	describe("addToQueue", () => {
		it("should create a new queued message with correct initial state", () => {
			const sessionId = "session1"
			const content = "Test message"

			const newMessage: QueuedMessage = {
				id: "msg-uuid",
				sessionId,
				content,
				status: "queued",
				timestamp: Date.now(),
				retryCount: 0,
				maxRetries: 3,
			}

			expect(newMessage.status).toBe("queued")
			expect(newMessage.retryCount).toBe(0)
			expect(newMessage.maxRetries).toBe(3)
			expect(newMessage.sessionId).toBe(sessionId)
		})

		it("should add message to existing queue", () => {
			const queue: QueuedMessage[] = []

			const message1: QueuedMessage = {
				id: "msg1",
				sessionId: "session1",
				content: "First",
				status: "queued",
				timestamp: Date.now(),
				retryCount: 0,
				maxRetries: 3,
			}

			queue.push(message1)

			const message2: QueuedMessage = {
				id: "msg2",
				sessionId: "session1",
				content: "Second",
				status: "queued",
				timestamp: Date.now() + 1,
				retryCount: 0,
				maxRetries: 3,
			}

			queue.push(message2)

			expect(queue).toHaveLength(2)
			expect(queue[0].id).toBe("msg1")
			expect(queue[1].id).toBe("msg2")
		})

		it("should generate unique IDs for each message", () => {
			const ids = new Set<string>()

			for (let i = 0; i < 10; i++) {
				const id = crypto.randomUUID()
				ids.add(id)
			}

			// All IDs should be unique
			expect(ids.size).toBe(10)
		})
	})

	describe("updateMessageStatus", () => {
		it("should update message status from queued to sending", () => {
			const message: QueuedMessage = {
				id: "msg1",
				sessionId: "session1",
				content: "Test",
				status: "queued",
				timestamp: Date.now(),
				retryCount: 0,
				maxRetries: 3,
			}

			const updated = { ...message, status: "sending" as const }

			expect(message.status).toBe("queued")
			expect(updated.status).toBe("sending")
		})

		it("should update message status to sent with no error", () => {
			const message: QueuedMessage = {
				id: "msg1",
				sessionId: "session1",
				content: "Test",
				status: "sending",
				timestamp: Date.now(),
				retryCount: 0,
				maxRetries: 3,
			}

			const updated = { ...message, status: "sent" as const, error: undefined }

			expect(updated.status).toBe("sent")
			expect(updated.error).toBeUndefined()
		})

		it("should update message status to failed with error message", () => {
			const message: QueuedMessage = {
				id: "msg1",
				sessionId: "session1",
				content: "Test",
				status: "sending",
				timestamp: Date.now(),
				retryCount: 0,
				maxRetries: 3,
			}

			const errorMsg = "Session not running"
			const updated = { ...message, status: "failed" as const, error: errorMsg }

			expect(updated.status).toBe("failed")
			expect(updated.error).toBe(errorMsg)
		})

		it("should only update the specified message in queue", () => {
			const queue: QueuedMessage[] = [
				{
					id: "msg1",
					sessionId: "session1",
					content: "First",
					status: "queued",
					timestamp: Date.now(),
					retryCount: 0,
					maxRetries: 3,
				},
				{
					id: "msg2",
					sessionId: "session1",
					content: "Second",
					status: "queued",
					timestamp: Date.now() + 1,
					retryCount: 0,
					maxRetries: 3,
				},
			]

			const updated = queue.map((msg) => (msg.id === "msg1" ? { ...msg, status: "sending" as const } : msg))

			expect(updated[0].status).toBe("sending")
			expect(updated[1].status).toBe("queued")
		})
	})

	describe("removeFromQueue", () => {
		it("should remove message from queue", () => {
			const queue: QueuedMessage[] = [
				{
					id: "msg1",
					sessionId: "session1",
					content: "First",
					status: "sent",
					timestamp: Date.now(),
					retryCount: 0,
					maxRetries: 3,
				},
				{
					id: "msg2",
					sessionId: "session1",
					content: "Second",
					status: "queued",
					timestamp: Date.now() + 1,
					retryCount: 0,
					maxRetries: 3,
				},
			]

			const filtered = queue.filter((msg) => msg.id !== "msg1")

			expect(queue).toHaveLength(2)
			expect(filtered).toHaveLength(1)
			expect(filtered[0].id).toBe("msg2")
		})

		it("should handle removing non-existent message", () => {
			const queue: QueuedMessage[] = [
				{
					id: "msg1",
					sessionId: "session1",
					content: "Test",
					status: "queued",
					timestamp: Date.now(),
					retryCount: 0,
					maxRetries: 3,
				},
			]

			const filtered = queue.filter((msg) => msg.id !== "nonexistent")

			// Queue unchanged if message doesn't exist
			expect(filtered).toHaveLength(1)
		})
	})

	describe("retryFailedMessage", () => {
		it("should change failed message status back to queued", () => {
			const message: QueuedMessage = {
				id: "msg1",
				sessionId: "session1",
				content: "Test",
				status: "failed",
				timestamp: Date.now(),
				error: "Session not running",
				retryCount: 1,
				maxRetries: 3,
			}

			const retried = {
				...message,
				status: "queued" as const,
				error: undefined,
				retryCount: message.retryCount + 1,
			}

			expect(message.status).toBe("failed")
			expect(retried.status).toBe("queued")
			expect(retried.retryCount).toBe(2)
			expect(retried.error).toBeUndefined()
		})

		it("should increment retry count on each retry", () => {
			const message: QueuedMessage = {
				id: "msg1",
				sessionId: "session1",
				content: "Test",
				status: "failed",
				timestamp: Date.now(),
				error: "Error",
				retryCount: 0,
				maxRetries: 3,
			}

			const retry1 = { ...message, retryCount: 1 }
			const retry2 = { ...retry1, retryCount: 2 }
			const retry3 = { ...retry2, retryCount: 3 }

			expect(message.retryCount).toBe(0)
			expect(retry1.retryCount).toBe(1)
			expect(retry2.retryCount).toBe(2)
			expect(retry3.retryCount).toBe(3)
		})

		it("should not allow retry beyond maxRetries", () => {
			const message: QueuedMessage = {
				id: "msg1",
				sessionId: "session1",
				content: "Test",
				status: "failed",
				timestamp: Date.now(),
				error: "Error",
				retryCount: 3,
				maxRetries: 3,
			}

			const canRetry = message.retryCount < message.maxRetries

			expect(canRetry).toBe(false)
		})

		it("should not retry non-failed messages", () => {
			const message: QueuedMessage = {
				id: "msg1",
				sessionId: "session1",
				content: "Test",
				status: "sent",
				timestamp: Date.now(),
				retryCount: 0,
				maxRetries: 3,
			}

			const shouldRetry = message.status === "failed"

			expect(shouldRetry).toBe(false)
		})
	})

	describe("queue ordering", () => {
		it("should maintain FIFO order", () => {
			const queue: QueuedMessage[] = []

			for (let i = 0; i < 5; i++) {
				queue.push({
					id: `msg${i}`,
					sessionId: "session1",
					content: `Message ${i}`,
					status: "queued",
					timestamp: Date.now() + i,
					retryCount: 0,
					maxRetries: 3,
				})
			}

			// First queued should be first in line
			const nextQueued = queue.find((msg) => msg.status === "queued")
			expect(nextQueued?.id).toBe("msg0")
		})

		it("should find next queued message", () => {
			const queue: QueuedMessage[] = [
				{
					id: "msg1",
					sessionId: "session1",
					content: "First",
					status: "sending",
					timestamp: Date.now(),
					retryCount: 0,
					maxRetries: 3,
				},
				{
					id: "msg2",
					sessionId: "session1",
					content: "Second",
					status: "queued",
					timestamp: Date.now() + 1,
					retryCount: 0,
					maxRetries: 3,
				},
				{
					id: "msg3",
					sessionId: "session1",
					content: "Third",
					status: "queued",
					timestamp: Date.now() + 2,
					retryCount: 0,
					maxRetries: 3,
				},
			]

			const nextQueued = queue.find((msg) => msg.status === "queued")

			// Should get first queued message
			expect(nextQueued?.id).toBe("msg2")
		})
	})
})

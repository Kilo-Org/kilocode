/**
 * Tests for message insertion guard to prevent race conditions
 * @kilocode_change - Created to test checkpoint message race condition fix
 */

import { describe, it, expect, beforeEach } from "vitest"
import { MessageInsertionGuard } from "../../kilocode/task/message-utils"

describe("MessageInsertionGuard", () => {
	let guard: MessageInsertionGuard

	beforeEach(() => {
		guard = new MessageInsertionGuard()
	})

	describe("basic locking", () => {
		it("should start unlocked", () => {
			expect(guard.isLocked()).toBe(false)
		})

		it("should lock when acquired", () => {
			guard.acquire()
			expect(guard.isLocked()).toBe(true)
		})

		it("should unlock when released", () => {
			guard.acquire()
			guard.release()
			expect(guard.isLocked()).toBe(false)
		})

		it("should allow multiple acquire/release cycles", () => {
			guard.acquire()
			guard.release()
			guard.acquire()
			guard.release()
			expect(guard.isLocked()).toBe(false)
		})
	})

	describe("concurrent access", () => {
		it("should serialize concurrent insertions", async () => {
			const insertionOrder: number[] = []
			const insertionCount = 5

			// Simulate concurrent message insertions
			const insertions = Array.from({ length: insertionCount }, (_, i) =>
				(async () => {
					await guard.waitForClearance()
					guard.acquire()
					try {
						insertionOrder.push(i)
						// Simulate some work being done
						await new Promise((resolve) => setTimeout(resolve, 10))
					} finally {
						guard.release()
					}
				})(),
			)

			await Promise.all(insertions)

			// All insertions should have completed
			expect(insertionOrder).toHaveLength(insertionCount)
			// Each index should appear exactly once
			expect(new Set(insertionOrder).size).toBe(insertionCount)
		})

		it("should wait for lock to release before proceeding", async () => {
			let firstTaskComplete = false
			let secondTaskStarted = false

			// First task acquires lock
			guard.acquire()

			const firstTask = (async () => {
				await new Promise((resolve) => setTimeout(resolve, 50))
				guard.release()
				firstTaskComplete = true
			})()

			// Second task waits for clearance
			const secondTask = (async () => {
				await guard.waitForClearance()
				secondTaskStarted = true
			})()

			// Second task should not start until first completes
			await new Promise((resolve) => setTimeout(resolve, 25))
			expect(secondTaskStarted).toBe(false)
			expect(firstTaskComplete).toBe(false)

			await firstTask
			await secondTask

			expect(firstTaskComplete).toBe(true)
			expect(secondTaskStarted).toBe(true)
		})

		it("should handle rapid successive insertions", async () => {
			const results: string[] = []

			const insertion1 = (async () => {
				await guard.waitForClearance()
				guard.acquire()
				try {
					results.push("A")
					await new Promise((resolve) => setTimeout(resolve, 5))
				} finally {
					guard.release()
				}
			})()

			const insertion2 = (async () => {
				await guard.waitForClearance()
				guard.acquire()
				try {
					results.push("B")
					await new Promise((resolve) => setTimeout(resolve, 5))
				} finally {
					guard.release()
				}
			})()

			const insertion3 = (async () => {
				await guard.waitForClearance()
				guard.acquire()
				try {
					results.push("C")
					await new Promise((resolve) => setTimeout(resolve, 5))
				} finally {
					guard.release()
				}
			})()

			await Promise.all([insertion1, insertion2, insertion3])

			// All three should complete
			expect(results).toHaveLength(3)
			// Should contain all elements
			expect(results).toContain("A")
			expect(results).toContain("B")
			expect(results).toContain("C")
		})
	})

	describe("error handling", () => {
		it("should release lock even if insertion throws error", async () => {
			await guard.waitForClearance()
			guard.acquire()

			let errorThrown = false
			try {
				throw new Error("Simulated insertion error")
			} catch (error) {
				errorThrown = true
			} finally {
				guard.release()
			}

			// Error should have been thrown
			expect(errorThrown).toBe(true)

			// Guard should be released
			expect(guard.isLocked()).toBe(false)

			// Next insertion should succeed
			await guard.waitForClearance()
			guard.acquire()
			expect(guard.isLocked()).toBe(true)
			guard.release()
		})

		it("should timeout if lock is never released", async () => {
			const shortTimeout = new MessageInsertionGuard(100, 10)

			// Acquire lock but never release it
			shortTimeout.acquire()

			// Should timeout after 100ms
			await expect(shortTimeout.waitForClearance()).rejects.toThrow()
		})
	})

	describe("realistic checkpoint scenario", () => {
		it("should prevent checkpoint message from interrupting partial updates", async () => {
			const messageLog: Array<{ type: string; action: string }> = []

			// Simulate partial message being updated
			const partialMessageUpdate = async () => {
				await guard.waitForClearance()
				guard.acquire()
				try {
					messageLog.push({ type: "ask", action: "start_partial" })
					await new Promise((resolve) => setTimeout(resolve, 20))
					messageLog.push({ type: "ask", action: "update_partial" })
					await new Promise((resolve) => setTimeout(resolve, 20))
					messageLog.push({ type: "ask", action: "complete_partial" })
				} finally {
					guard.release()
				}
			}

			// Simulate checkpoint message arriving mid-update
			const checkpointMessage = async () => {
				await new Promise((resolve) => setTimeout(resolve, 10)) // Starts 10ms after partial
				await guard.waitForClearance()
				guard.acquire()
				try {
					messageLog.push({ type: "say", action: "checkpoint_saved" })
				} finally {
					guard.release()
				}
			}

			await Promise.all([partialMessageUpdate(), checkpointMessage()])

			// Verify checkpoint came after all partial updates
			const checkpointIndex = messageLog.findIndex(
				(entry) => entry.type === "say" && entry.action === "checkpoint_saved",
			)
			const lastPartialIndex = messageLog.findIndex((entry) => entry.action === "complete_partial")

			expect(checkpointIndex).toBeGreaterThan(lastPartialIndex)
			expect(messageLog).toHaveLength(4)
		})

		it("should handle multiple checkpoint messages during streaming", async () => {
			const messageLog: string[] = []

			// Simulate streaming message with multiple partial updates
			const streamingMessage = async () => {
				for (let i = 0; i < 5; i++) {
					await guard.waitForClearance()
					guard.acquire()
					try {
						messageLog.push(`stream_chunk_${i}`)
						await new Promise((resolve) => setTimeout(resolve, 10))
					} finally {
						guard.release()
					}
				}
			}

			// Simulate two checkpoint messages arriving during stream
			const checkpoint1 = async () => {
				await new Promise((resolve) => setTimeout(resolve, 15))
				await guard.waitForClearance()
				guard.acquire()
				try {
					messageLog.push("checkpoint_1")
				} finally {
					guard.release()
				}
			}

			const checkpoint2 = async () => {
				await new Promise((resolve) => setTimeout(resolve, 35))
				await guard.waitForClearance()
				guard.acquire()
				try {
					messageLog.push("checkpoint_2")
				} finally {
					guard.release()
				}
			}

			await Promise.all([streamingMessage(), checkpoint1(), checkpoint2()])

			// All messages should be present
			expect(messageLog).toHaveLength(7)

			// Stream chunks should be sequential
			const chunk0Index = messageLog.indexOf("stream_chunk_0")
			const chunk1Index = messageLog.indexOf("stream_chunk_1")
			const chunk2Index = messageLog.indexOf("stream_chunk_2")
			expect(chunk1Index).toBeGreaterThan(chunk0Index)
			expect(chunk2Index).toBeGreaterThan(chunk1Index)

			// Checkpoints should come after some chunks (not interrupt mid-chunk)
			const checkpoint1Index = messageLog.indexOf("checkpoint_1")
			const checkpoint2Index = messageLog.indexOf("checkpoint_2")
			expect(checkpoint1Index).toBeGreaterThan(-1)
			expect(checkpoint2Index).toBeGreaterThan(-1)
		})
	})

	describe("custom configuration", () => {
		it("should respect custom timeout", async () => {
			const customGuard = new MessageInsertionGuard(50, 5)

			customGuard.acquire()

			// Should timeout after 50ms
			await expect(customGuard.waitForClearance()).rejects.toThrow()
		})

		it("should respect custom interval", async () => {
			const customGuard = new MessageInsertionGuard(1000, 100)
			let checkCount = 0

			customGuard.acquire()

			// Count how many times we check before timeout
			const checkInterval = setInterval(() => {
				if (!customGuard.isLocked()) {
					clearInterval(checkInterval)
				}
				checkCount++
			}, 100)

			setTimeout(() => customGuard.release(), 250)

			await customGuard.waitForClearance()
			clearInterval(checkInterval)

			// With 100ms interval and 250ms wait, should check approximately 2-3 times
			expect(checkCount).toBeGreaterThanOrEqual(2)
			expect(checkCount).toBeLessThanOrEqual(4)
		})
	})
})

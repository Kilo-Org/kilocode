/**
 * Tests for useCondense hook
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createStore } from "jotai"
import {
	condensePendingRequestsAtom,
	addPendingCondenseRequestAtom,
	removePendingCondenseRequestAtom,
	resolveCondenseRequestAtom,
	CONDENSE_REQUEST_TIMEOUT_MS,
} from "../../atoms/condense.js"

vi.mock("../../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

describe("useCondense", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	describe("condenseAndWait behavior", () => {
		describe("timeout handling", () => {
			it("should reject with timeout error after CONDENSE_REQUEST_TIMEOUT_MS", async () => {
				const taskId = "test-task-timeout"
				const resolve = vi.fn()
				const reject = vi.fn()

				// Create a timeout as the hook would
				const timeout = setTimeout(() => {
					store.set(removePendingCondenseRequestAtom, taskId)
					reject(new Error(`Condense request timed out after ${CONDENSE_REQUEST_TIMEOUT_MS / 1000} seconds`))
				}, CONDENSE_REQUEST_TIMEOUT_MS)

				// Add the pending request
				store.set(addPendingCondenseRequestAtom, {
					taskId,
					resolve,
					reject,
					timeout,
				})

				// Verify request is pending
				expect(store.get(condensePendingRequestsAtom).size).toBe(1)
				expect(store.get(condensePendingRequestsAtom).has(taskId)).toBe(true)

				// Fast-forward time to trigger timeout
				vi.advanceTimersByTime(CONDENSE_REQUEST_TIMEOUT_MS)

				// Verify timeout was triggered
				expect(reject).toHaveBeenCalledTimes(1)
				expect(reject).toHaveBeenCalledWith(
					new Error(`Condense request timed out after ${CONDENSE_REQUEST_TIMEOUT_MS / 1000} seconds`),
				)
				expect(resolve).not.toHaveBeenCalled()

				// Verify request was removed
				expect(store.get(condensePendingRequestsAtom).size).toBe(0)
			})

			it("should not timeout if resolved before timeout", async () => {
				const taskId = "test-task-no-timeout"
				const resolve = vi.fn()
				const reject = vi.fn()

				// Create a timeout as the hook would
				const timeout = setTimeout(() => {
					store.set(removePendingCondenseRequestAtom, taskId)
					reject(new Error(`Condense request timed out after ${CONDENSE_REQUEST_TIMEOUT_MS / 1000} seconds`))
				}, CONDENSE_REQUEST_TIMEOUT_MS)

				// Add the pending request
				store.set(addPendingCondenseRequestAtom, {
					taskId,
					resolve,
					reject,
					timeout,
				})

				// Advance time but not enough to trigger timeout
				vi.advanceTimersByTime(CONDENSE_REQUEST_TIMEOUT_MS / 2)

				// Resolve the request before timeout
				store.set(resolveCondenseRequestAtom, { taskId })

				// Verify resolve was called
				expect(resolve).toHaveBeenCalledTimes(1)
				expect(reject).not.toHaveBeenCalled()

				// Advance past the original timeout time
				vi.advanceTimersByTime(CONDENSE_REQUEST_TIMEOUT_MS)

				// Verify reject was NOT called (timeout was cleared)
				expect(reject).not.toHaveBeenCalled()
			})
		})

		describe("success resolution", () => {
			it("should resolve successfully when response is received", () => {
				const taskId = "test-task-success"
				const resolve = vi.fn()
				const reject = vi.fn()
				const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

				// Add pending request
				store.set(addPendingCondenseRequestAtom, {
					taskId,
					resolve,
					reject,
					timeout,
				})

				// Simulate receiving the response
				store.set(resolveCondenseRequestAtom, { taskId })

				// Verify correct callback was invoked
				expect(resolve).toHaveBeenCalledTimes(1)
				expect(reject).not.toHaveBeenCalled()

				// Verify request was cleaned up
				expect(store.get(condensePendingRequestsAtom).size).toBe(0)
			})

			it("should handle multiple concurrent requests independently", () => {
				const taskId1 = "task-1"
				const taskId2 = "task-2"
				const resolve1 = vi.fn()
				const resolve2 = vi.fn()
				const reject1 = vi.fn()
				const reject2 = vi.fn()
				const timeout1 = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)
				const timeout2 = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

				// Add two pending requests
				store.set(addPendingCondenseRequestAtom, {
					taskId: taskId1,
					resolve: resolve1,
					reject: reject1,
					timeout: timeout1,
				})
				store.set(addPendingCondenseRequestAtom, {
					taskId: taskId2,
					resolve: resolve2,
					reject: reject2,
					timeout: timeout2,
				})

				expect(store.get(condensePendingRequestsAtom).size).toBe(2)

				// Resolve only the first one
				store.set(resolveCondenseRequestAtom, { taskId: taskId1 })

				expect(resolve1).toHaveBeenCalledTimes(1)
				expect(resolve2).not.toHaveBeenCalled()
				expect(store.get(condensePendingRequestsAtom).size).toBe(1)
				expect(store.get(condensePendingRequestsAtom).has(taskId2)).toBe(true)

				// Now resolve the second
				store.set(resolveCondenseRequestAtom, { taskId: taskId2 })

				expect(resolve2).toHaveBeenCalledTimes(1)
				expect(store.get(condensePendingRequestsAtom).size).toBe(0)

				clearTimeout(timeout1)
				clearTimeout(timeout2)
			})
		})

		describe("error handling", () => {
			it("should reject when error is returned in response", () => {
				const taskId = "test-task-error"
				const resolve = vi.fn()
				const reject = vi.fn()
				const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

				// Add pending request
				store.set(addPendingCondenseRequestAtom, {
					taskId,
					resolve,
					reject,
					timeout,
				})

				// Simulate receiving an error response
				store.set(resolveCondenseRequestAtom, {
					taskId,
					error: "Condensation failed due to insufficient context",
				})

				// Verify reject was called with correct error
				expect(reject).toHaveBeenCalledTimes(1)
				expect(reject).toHaveBeenCalledWith(new Error("Condensation failed due to insufficient context"))
				expect(resolve).not.toHaveBeenCalled()

				// Verify request was cleaned up
				expect(store.get(condensePendingRequestsAtom).size).toBe(0)
			})

			it("should handle sendMessage failure by removing pending request", () => {
				const taskId = "test-task-send-fail"
				const resolve = vi.fn()
				const reject = vi.fn()

				// Simulate the flow: add request, then sendMessage fails
				const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

				store.set(addPendingCondenseRequestAtom, {
					taskId,
					resolve,
					reject,
					timeout,
				})

				expect(store.get(condensePendingRequestsAtom).size).toBe(1)

				// Simulate sendMessage catch block behavior
				store.set(removePendingCondenseRequestAtom, taskId)

				// Request should be removed
				expect(store.get(condensePendingRequestsAtom).size).toBe(0)
			})
		})

		describe("cleanup behavior", () => {
			it("should clear timeout when request is removed", () => {
				const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
				const taskId = "test-task-cleanup"
				const resolve = vi.fn()
				const reject = vi.fn()
				const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

				store.set(addPendingCondenseRequestAtom, {
					taskId,
					resolve,
					reject,
					timeout,
				})

				store.set(removePendingCondenseRequestAtom, taskId)

				expect(clearTimeoutSpy).toHaveBeenCalled()
			})

			it("should clear timeout when request is resolved", () => {
				const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
				const taskId = "test-task-cleanup-resolve"
				const resolve = vi.fn()
				const reject = vi.fn()
				const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

				store.set(addPendingCondenseRequestAtom, {
					taskId,
					resolve,
					reject,
					timeout,
				})

				store.set(resolveCondenseRequestAtom, { taskId })

				expect(clearTimeoutSpy).toHaveBeenCalled()
			})

			it("should not throw when removing non-existent request", () => {
				// Should not throw
				expect(() => {
					store.set(removePendingCondenseRequestAtom, "non-existent-task")
				}).not.toThrow()

				expect(store.get(condensePendingRequestsAtom).size).toBe(0)
			})

			it("should not call resolve/reject when resolving non-existent request", () => {
				// Should not throw and not call any callbacks
				expect(() => {
					store.set(resolveCondenseRequestAtom, { taskId: "non-existent-task" })
				}).not.toThrow()
			})
		})
	})

	describe("constants", () => {
		it("CONDENSE_REQUEST_TIMEOUT_MS should be 60 seconds", () => {
			expect(CONDENSE_REQUEST_TIMEOUT_MS).toBe(60000)
		})
	})
})

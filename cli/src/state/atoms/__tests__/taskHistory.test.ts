import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { createStore } from "jotai"
import {
	taskHistoryPendingRequestsAtom,
	addPendingRequestAtom,
	removePendingRequestAtom,
	resolveTaskHistoryRequestAtom,
	type TaskHistoryData,
} from "../taskHistory.js"
import type { HistoryItem } from "@roo-code/types"
import { TASK_HISTORY_REQUEST_TIMEOUT_MS } from "../../../constants/timeouts.js"

/**
 * Creates a minimal mock HistoryItem for testing
 */
function createMockHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id: "task-1",
		number: 1,
		ts: Date.now(),
		task: "Test task",
		tokensIn: 100,
		tokensOut: 200,
		totalCost: 0.01,
		...overrides,
	}
}

describe("taskHistory atoms", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("addPendingRequestAtom", () => {
		it("should add a pending request to the map", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const timeout = setTimeout(() => {}, TASK_HISTORY_REQUEST_TIMEOUT_MS)

			store.set(addPendingRequestAtom, {
				requestId: "test-123",
				resolve,
				reject,
				timeout,
			})

			const pendingRequests = store.get(taskHistoryPendingRequestsAtom)
			expect(pendingRequests.size).toBe(1)
			expect(pendingRequests.has("test-123")).toBe(true)

			clearTimeout(timeout)
		})
	})

	describe("removePendingRequestAtom", () => {
		it("should remove a pending request and clear its timeout", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const timeoutCallback = vi.fn()
			const timeout = setTimeout(timeoutCallback, TASK_HISTORY_REQUEST_TIMEOUT_MS)

			// Add the request first
			store.set(addPendingRequestAtom, {
				requestId: "test-456",
				resolve,
				reject,
				timeout,
			})

			// Remove it
			store.set(removePendingRequestAtom, "test-456")

			const pendingRequests = store.get(taskHistoryPendingRequestsAtom)
			expect(pendingRequests.size).toBe(0)

			// Verify timeout was cleared
			vi.advanceTimersByTime(6000)
			expect(timeoutCallback).not.toHaveBeenCalled()
		})

		it("should do nothing if request ID does not exist", () => {
			store.set(removePendingRequestAtom, "nonexistent")
			const pendingRequests = store.get(taskHistoryPendingRequestsAtom)
			expect(pendingRequests.size).toBe(0)
		})
	})

	describe("resolveTaskHistoryRequestAtom", () => {
		it("should resolve a pending request with data", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const timeout = setTimeout(() => {}, TASK_HISTORY_REQUEST_TIMEOUT_MS)

			// Add the request
			store.set(addPendingRequestAtom, {
				requestId: "test-789",
				resolve,
				reject,
				timeout,
			})

			const mockData: TaskHistoryData = {
				historyItems: [createMockHistoryItem()],
				pageIndex: 0,
				pageCount: 1,
			}

			// Resolve it
			store.set(resolveTaskHistoryRequestAtom, {
				requestId: "test-789",
				data: mockData,
			})

			// Verify resolve was called with data
			expect(resolve).toHaveBeenCalledWith(mockData)
			expect(reject).not.toHaveBeenCalled()

			// Verify request was removed
			const pendingRequests = store.get(taskHistoryPendingRequestsAtom)
			expect(pendingRequests.size).toBe(0)
		})

		it("should reject a pending request with error", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const timeout = setTimeout(() => {}, TASK_HISTORY_REQUEST_TIMEOUT_MS)

			// Add the request
			store.set(addPendingRequestAtom, {
				requestId: "test-error",
				resolve,
				reject,
				timeout,
			})

			// Resolve with error
			store.set(resolveTaskHistoryRequestAtom, {
				requestId: "test-error",
				error: "Something went wrong",
			})

			// Verify reject was called
			expect(reject).toHaveBeenCalledWith(expect.any(Error))
			expect(reject.mock.calls[0][0].message).toBe("Something went wrong")
			expect(resolve).not.toHaveBeenCalled()

			// Verify request was removed
			const pendingRequests = store.get(taskHistoryPendingRequestsAtom)
			expect(pendingRequests.size).toBe(0)
		})

		it("should do nothing if request ID does not exist", () => {
			const mockData: TaskHistoryData = {
				historyItems: [],
				pageIndex: 0,
				pageCount: 0,
			}

			// Should not throw
			store.set(resolveTaskHistoryRequestAtom, {
				requestId: "nonexistent",
				data: mockData,
			})
		})
	})

	describe("Promise-based task history flow", () => {
		it("should resolve promise when response arrives before timeout", async () => {
			const TIMEOUT_MS = TASK_HISTORY_REQUEST_TIMEOUT_MS
			const requestId = "flow-test-1"

			// Simulate the flow used in CLI.resumeConversation
			const resultPromise = new Promise<TaskHistoryData>((resolve, reject) => {
				const timeout = setTimeout(() => {
					store.set(removePendingRequestAtom, requestId)
					reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`))
				}, TIMEOUT_MS)

				store.set(addPendingRequestAtom, { requestId, resolve, reject, timeout })
			})

			// Simulate response arriving
			const mockData: TaskHistoryData = {
				historyItems: [createMockHistoryItem()],
				pageIndex: 0,
				pageCount: 1,
			}

			store.set(resolveTaskHistoryRequestAtom, { requestId, data: mockData })

			// Should resolve with data
			const result = await resultPromise
			expect(result).toEqual(mockData)
		})

		it("should reject promise when timeout occurs", async () => {
			const TIMEOUT_MS = TASK_HISTORY_REQUEST_TIMEOUT_MS
			const requestId = "flow-test-2"

			// Simulate the flow used in CLI.resumeConversation
			const resultPromise = new Promise<TaskHistoryData>((resolve, reject) => {
				const timeout = setTimeout(() => {
					store.set(removePendingRequestAtom, requestId)
					reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`))
				}, TIMEOUT_MS)

				store.set(addPendingRequestAtom, { requestId, resolve, reject, timeout })
			})

			// Advance time past timeout
			vi.advanceTimersByTime(TIMEOUT_MS + 100)

			// Should reject with timeout error
			await expect(resultPromise).rejects.toThrow(`Request timed out after ${TIMEOUT_MS}ms`)

			// Verify request was removed
			const pendingRequests = store.get(taskHistoryPendingRequestsAtom)
			expect(pendingRequests.size).toBe(0)
		})
	})
})

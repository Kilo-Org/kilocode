/**
 * Tests for condense context state management atoms
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import {
	condensePendingRequestsAtom,
	addPendingCondenseRequestAtom,
	removePendingCondenseRequestAtom,
	resolveCondenseRequestAtom,
	CONDENSE_REQUEST_TIMEOUT_MS,
} from "../condense.js"

describe("condense atoms", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("condensePendingRequestsAtom", () => {
		it("should initialize with empty map", () => {
			const pendingRequests = store.get(condensePendingRequestsAtom)
			expect(pendingRequests.size).toBe(0)
		})
	})

	describe("addPendingCondenseRequestAtom", () => {
		it("should add a pending request", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

			store.set(addPendingCondenseRequestAtom, {
				taskId: "task-123",
				resolve,
				reject,
				timeout,
			})

			const pendingRequests = store.get(condensePendingRequestsAtom)
			expect(pendingRequests.size).toBe(1)
			expect(pendingRequests.has("task-123")).toBe(true)

			clearTimeout(timeout)
		})

		it("should store resolve and reject functions", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

			store.set(addPendingCondenseRequestAtom, {
				taskId: "task-456",
				resolve,
				reject,
				timeout,
			})

			const pendingRequests = store.get(condensePendingRequestsAtom)
			const request = pendingRequests.get("task-456")
			expect(request?.resolve).toBe(resolve)
			expect(request?.reject).toBe(reject)

			clearTimeout(timeout)
		})
	})

	describe("removePendingCondenseRequestAtom", () => {
		it("should remove a pending request", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

			store.set(addPendingCondenseRequestAtom, {
				taskId: "task-789",
				resolve,
				reject,
				timeout,
			})

			expect(store.get(condensePendingRequestsAtom).size).toBe(1)

			store.set(removePendingCondenseRequestAtom, "task-789")

			expect(store.get(condensePendingRequestsAtom).size).toBe(0)
		})

		it("should clear timeout when removing request", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
			const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

			store.set(addPendingCondenseRequestAtom, {
				taskId: "task-timeout",
				resolve,
				reject,
				timeout,
			})

			store.set(removePendingCondenseRequestAtom, "task-timeout")

			expect(clearTimeoutSpy).toHaveBeenCalled()
		})

		it("should do nothing for non-existent request", () => {
			// Should not throw
			store.set(removePendingCondenseRequestAtom, "non-existent")
			expect(store.get(condensePendingRequestsAtom).size).toBe(0)
		})
	})

	describe("resolveCondenseRequestAtom", () => {
		it("should resolve pending request successfully", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

			store.set(addPendingCondenseRequestAtom, {
				taskId: "task-success",
				resolve,
				reject,
				timeout,
			})

			store.set(resolveCondenseRequestAtom, { taskId: "task-success" })

			expect(resolve).toHaveBeenCalledTimes(1)
			expect(reject).not.toHaveBeenCalled()
			expect(store.get(condensePendingRequestsAtom).size).toBe(0)
		})

		it("should reject pending request with error", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

			store.set(addPendingCondenseRequestAtom, {
				taskId: "task-error",
				resolve,
				reject,
				timeout,
			})

			store.set(resolveCondenseRequestAtom, {
				taskId: "task-error",
				error: "Condensation failed",
			})

			expect(reject).toHaveBeenCalledTimes(1)
			expect(reject).toHaveBeenCalledWith(new Error("Condensation failed"))
			expect(resolve).not.toHaveBeenCalled()
			expect(store.get(condensePendingRequestsAtom).size).toBe(0)
		})

		it("should clear timeout when resolving", () => {
			const resolve = vi.fn()
			const reject = vi.fn()
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
			const timeout = setTimeout(() => {}, CONDENSE_REQUEST_TIMEOUT_MS)

			store.set(addPendingCondenseRequestAtom, {
				taskId: "task-clear-timeout",
				resolve,
				reject,
				timeout,
			})

			store.set(resolveCondenseRequestAtom, { taskId: "task-clear-timeout" })

			expect(clearTimeoutSpy).toHaveBeenCalled()
		})

		it("should do nothing for non-existent request", () => {
			// Should not throw
			store.set(resolveCondenseRequestAtom, { taskId: "non-existent" })
			expect(store.get(condensePendingRequestsAtom).size).toBe(0)
		})
	})

	describe("CONDENSE_REQUEST_TIMEOUT_MS", () => {
		it("should be 60 seconds", () => {
			expect(CONDENSE_REQUEST_TIMEOUT_MS).toBe(60000)
		})
	})
})

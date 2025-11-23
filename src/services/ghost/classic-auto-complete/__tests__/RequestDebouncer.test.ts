import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { RequestDebouncer } from "../RequestDebouncer"

describe("RequestDebouncer", () => {
	let debouncer: RequestDebouncer

	beforeEach(() => {
		vi.useFakeTimers()
		debouncer = new RequestDebouncer()
	})

	afterEach(() => {
		vi.useRealTimers()
		debouncer.clear()
	})

	it("should debounce a single request", async () => {
		const mockExecute = vi.fn().mockResolvedValue(undefined)

		const promise = debouncer.debounce(mockExecute, 300)

		// Should not execute immediately
		expect(mockExecute).not.toHaveBeenCalled()

		// Advance timers
		await vi.advanceTimersByTimeAsync(300)

		// Should execute after delay
		await promise
		expect(mockExecute).toHaveBeenCalledTimes(1)
	})

	it("should restart debounce timer on subsequent calls", async () => {
		const mockExecute1 = vi.fn().mockResolvedValue(undefined)
		const mockExecute2 = vi.fn().mockResolvedValue(undefined)

		const promise1 = debouncer.debounce(mockExecute1, 300)

		// Advance partway
		await vi.advanceTimersByTimeAsync(200)

		// Make another call - should restart timer
		const promise2 = debouncer.debounce(mockExecute2, 300)

		// Advance remaining time from first call
		await vi.advanceTimersByTimeAsync(100)

		// First should not have executed yet
		expect(mockExecute1).not.toHaveBeenCalled()

		// Advance full delay from second call
		await vi.advanceTimersByTimeAsync(200)

		// Only second should execute
		await Promise.all([promise1, promise2])
		expect(mockExecute1).not.toHaveBeenCalled()
		expect(mockExecute2).toHaveBeenCalledTimes(1)
	})

	it("should flush pending request immediately", async () => {
		const mockExecute = vi.fn().mockResolvedValue(undefined)

		debouncer.debounce(mockExecute, 300)

		// Flush immediately
		debouncer.flush()

		// Should execute without waiting
		await vi.runAllTimersAsync()
		expect(mockExecute).toHaveBeenCalledTimes(1)
	})

	it("should flush on shouldFlush condition", async () => {
		const mockExecute1 = vi.fn().mockResolvedValue(undefined)
		const mockExecute2 = vi.fn().mockResolvedValue(undefined)

		debouncer.debounce(mockExecute1, 300)

		// Advance partway
		await vi.advanceTimersByTimeAsync(100)

		// Make another call with shouldFlush returning true
		const shouldFlush = vi.fn().mockReturnValue(true)
		debouncer.debounce(mockExecute2, 300, shouldFlush)

		// Should have flushed first request
		await vi.runAllTimersAsync()
		expect(mockExecute1).toHaveBeenCalledTimes(1)
		expect(mockExecute2).toHaveBeenCalledTimes(1)
	})

	it("should not flush when shouldFlush returns false", async () => {
		const mockExecute1 = vi.fn().mockResolvedValue(undefined)
		const mockExecute2 = vi.fn().mockResolvedValue(undefined)

		debouncer.debounce(mockExecute1, 300)

		// Advance partway
		await vi.advanceTimersByTimeAsync(100)

		// Make another call with shouldFlush returning false
		const shouldFlush = vi.fn().mockReturnValue(false)
		const promise = debouncer.debounce(mockExecute2, 300, shouldFlush)

		// Should restart timer, not flush
		await vi.advanceTimersByTimeAsync(300)
		await promise

		// Only second should execute
		expect(mockExecute1).not.toHaveBeenCalled()
		expect(mockExecute2).toHaveBeenCalledTimes(1)
	})

	it("should resolve all pending promises when request completes", async () => {
		const mockExecute = vi.fn().mockResolvedValue(undefined)

		const promise1 = debouncer.debounce(mockExecute, 300)
		const promise2 = debouncer.debounce(mockExecute, 300)
		const promise3 = debouncer.debounce(mockExecute, 300)

		await vi.advanceTimersByTimeAsync(300)

		// All promises should resolve
		await Promise.all([promise1, promise2, promise3])

		// But execute should only be called once
		expect(mockExecute).toHaveBeenCalledTimes(1)
	})

	it("should clear pending requests without executing", () => {
		const mockExecute = vi.fn().mockResolvedValue(undefined)

		debouncer.debounce(mockExecute, 300)

		// Clear without executing
		debouncer.clear()

		// Advance timers
		vi.advanceTimersByTime(300)

		// Should not execute
		expect(mockExecute).not.toHaveBeenCalled()
	})

	it("should report pending status correctly", () => {
		expect(debouncer.hasPending()).toBe(false)

		debouncer.debounce(vi.fn().mockResolvedValue(undefined), 300)
		expect(debouncer.hasPending()).toBe(true)

		debouncer.clear()
		expect(debouncer.hasPending()).toBe(false)
	})

	it("should handle async execution errors gracefully", async () => {
		const mockExecute = vi.fn().mockRejectedValue(new Error("Test error"))

		const promise = debouncer.debounce(mockExecute, 300)

		await vi.advanceTimersByTimeAsync(300)

		// Should not throw, just resolve the promise
		await expect(promise).resolves.toBeUndefined()
	})
})

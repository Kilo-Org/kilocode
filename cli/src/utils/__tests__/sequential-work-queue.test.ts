import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { SequentialWorkQueue } from "../sequential-work-queue.js"

describe("SequentialWorkQueue", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("processes items in FIFO order", async () => {
		const processed: string[] = []
		const queue = new SequentialWorkQueue<string>({
			canProcess: () => true,
			process: async ({ value }) => {
				processed.push(value)
			},
		})

		queue.enqueue("a")
		queue.enqueue("b")
		queue.enqueue("c")

		await vi.runAllTimersAsync()
		expect(processed).toEqual(["a", "b", "c"])

		queue.dispose()
	})

	it("does not process until canProcess allows it", async () => {
		let ready = false
		const processed: string[] = []
		const queue = new SequentialWorkQueue<string>({
			canProcess: () => ready,
			process: async ({ value }) => {
				processed.push(value)
			},
		})

		queue.enqueue("a")
		await vi.runAllTimersAsync()
		expect(processed).toEqual([])

		ready = true
		queue.notify()
		await vi.runAllTimersAsync()
		expect(processed).toEqual(["a"])

		queue.dispose()
	})

	it("retries failed items before moving on", async () => {
		let attempts = 0
		const processed: string[] = []
		const queue = new SequentialWorkQueue<string>({
			canProcess: () => true,
			retryDelayMs: 10,
			shouldRetry: () => true,
			process: async ({ value }) => {
				attempts += 1
				if (attempts === 1) {
					throw new Error("transient")
				}
				processed.push(value)
			},
		})

		queue.enqueue("a")

		await vi.runAllTimersAsync()
		expect(processed).toEqual(["a"])
		expect(attempts).toBe(2)

		queue.dispose()
	})

	it("drops items when shouldRetry is false and continues", async () => {
		const processed: string[] = []
		const onDrop = vi.fn()
		const queue = new SequentialWorkQueue<string>({
			canProcess: () => true,
			shouldRetry: () => false,
			onDrop,
			process: async ({ value }) => {
				if (value === "bad") {
					throw new Error("permanent")
				}
				processed.push(value)
			},
		})

		queue.enqueue("bad")
		queue.enqueue("good")

		await vi.runAllTimersAsync()
		expect(processed).toEqual(["good"])
		expect(onDrop).toHaveBeenCalledTimes(1)
		expect(onDrop.mock.calls[0]?.[0].item.value).toBe("bad")

		queue.dispose()
	})

	it("clear cancels pending retry", async () => {
		let attempts = 0
		const process = vi.fn(async () => {
			attempts += 1
			throw new Error("transient")
		})
		const queue = new SequentialWorkQueue<string>({
			canProcess: () => true,
			retryDelayMs: 10,
			shouldRetry: () => true,
			process: async ({ value }) => {
				await process(value)
			},
		})

		queue.enqueue("a")
		await Promise.resolve()
		await Promise.resolve()
		expect(process).toHaveBeenCalledTimes(1)

		queue.clear()
		await vi.advanceTimersByTimeAsync(50)
		expect(process).toHaveBeenCalledTimes(1)
		expect(attempts).toBe(1)

		queue.dispose()
	})
})

import { describe, expect, it, vi } from "vitest"

import { ListenableGenerator } from "./ListenableGenerator"

describe("ListenableGenerator", () => {
	// Helper function to create an async generator
	async function* asyncGenerator<T>(values: T[]) {
		for (const value of values) {
			// Yield on next event loop iteration to ensure async behavior
			await new Promise(setImmediate)
			yield value
		}
	}

	it("should yield values from the source generator via tee()", async () => {
		const values = [1, 2, 3]
		const source = asyncGenerator(values)
		const onError = vi.fn()

		const lg = new ListenableGenerator<number>(source, onError, new AbortController())

		const result: number[] = []
		for await (const value of lg.tee()) {
			result.push(value)
		}

		expect(result).toEqual(values)
		expect(onError).not.toHaveBeenCalled()
	})

	it("should allow listeners to receive values", async () => {
		const values = [1, 2, 3]
		const source = asyncGenerator(values)
		const onError = vi.fn()

		const lg = new ListenableGenerator<number>(source, onError, new AbortController())

		const listener = vi.fn()

		// Add listener after yielding starts (next event loop iteration)
		await new Promise(setImmediate)
		lg.listen(listener)

		// Wait for generator to actually finish
		await lg.waitForCompletion()

		expect(listener).toHaveBeenCalledWith(1)
		expect(listener).toHaveBeenCalledWith(2)
		expect(listener).toHaveBeenCalledWith(3)
		// Listener should receive null at the end
		expect(listener).toHaveBeenCalledWith(null)
	})

	it("should buffer values for listeners added after some values have been yielded", async () => {
		const values = [1, 2, 3]
		const source = asyncGenerator(values)
		const onError = vi.fn()

		const lg = new ListenableGenerator<number>(source, onError, new AbortController())

		const initialListener = vi.fn()

		lg.listen(initialListener)

		// Wait for the first value to be yielded (next event loop iteration)
		await new Promise(setImmediate)

		// Add a second listener after first value has been yielded
		const newListener = vi.fn()
		lg.listen(newListener)

		// Wait for generator to actually finish
		await lg.waitForCompletion()

		// Both listeners should have received all values
		;[initialListener, newListener].forEach((listener) => {
			expect(listener).toHaveBeenCalledWith(1)
			expect(listener).toHaveBeenCalledWith(2)
			expect(listener).toHaveBeenCalledWith(3)
			expect(listener).toHaveBeenCalledWith(null)
		})
	})

	it("should handle cancellation", async () => {
		const values = [1, 2, 3, 4, 5]
		const source = asyncGenerator(values)
		const onError = vi.fn()

		const lg = new ListenableGenerator<number>(source, onError, new AbortController())

		const result: number[] = []
		const teeIterator = lg.tee()

		const consume = async () => {
			for await (const value of teeIterator) {
				result.push(value)
				if (value === 3) {
					lg.cancel()
				}
			}
		}

		await consume()

		expect(result).toEqual([1, 2, 3])
		expect(lg["_isEnded"]).toBe(true)
	})

	it("should call onError when the source generator throws an error", async () => {
		async function* errorGenerator() {
			yield 1
			throw new Error("Test error")
		}

		const source = errorGenerator()
		const onError = vi.fn()

		const lg = new ListenableGenerator<number>(source, onError, new AbortController())

		const result: number[] = []
		for await (const value of lg.tee()) {
			result.push(value)
		}

		expect(result).toEqual([1])
		expect(onError).toHaveBeenCalledTimes(1)
		expect(onError).toHaveBeenCalledWith(new Error("Test error"))
	})

	it("should notify listeners when the generator ends", async () => {
		const values = [1, 2, 3]
		const source = asyncGenerator(values)
		const onError = vi.fn()

		const lg = new ListenableGenerator<number>(source, onError, new AbortController())

		const listener = vi.fn()
		lg.listen(listener)

		// Wait for the generator to actually finish
		await lg.waitForCompletion()

		expect(listener).toHaveBeenCalledWith(1)
		expect(listener).toHaveBeenCalledWith(2)
		expect(listener).toHaveBeenCalledWith(3)
		expect(listener).toHaveBeenCalledWith(null)
	})
})

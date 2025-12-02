import { GhostListenableGenerator, GhostStringListenableGenerator } from "../GhostListenableGenerator"

describe("GhostListenableGenerator", () => {
	describe("basic functionality", () => {
		it("should buffer values from the source generator", async () => {
			async function* source(): AsyncGenerator<string> {
				yield "a"
				yield "b"
				yield "c"
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			await generator.waitForCompletion()

			expect(generator.getBuffer()).toEqual(["a", "b", "c"])
			expect(generator.isEnded).toBe(true)
		})

		it("should notify listeners of new values", async () => {
			async function* source(): AsyncGenerator<string> {
				yield "a"
				yield "b"
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			const receivedValues: (string | null)[] = []
			generator.listen((value) => receivedValues.push(value))

			await generator.waitForCompletion()

			expect(receivedValues).toEqual(["a", "b", null])
		})

		it("should send buffered values to new listeners", async () => {
			async function* source(): AsyncGenerator<string> {
				yield "a"
				yield "b"
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			await generator.waitForCompletion()

			const receivedValues: (string | null)[] = []
			generator.listen((value) => receivedValues.push(value))

			// Should receive all buffered values plus null for end
			expect(receivedValues).toEqual(["a", "b", null])
		})

		it("should allow removing listeners", async () => {
			let resolveYield: () => void
			const yieldPromise = new Promise<void>((resolve) => {
				resolveYield = resolve
			})

			async function* source(): AsyncGenerator<string> {
				yield "a"
				await yieldPromise
				yield "b"
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			const receivedValues: (string | null)[] = []
			const listener = (value: string | null) => receivedValues.push(value)
			generator.listen(listener)

			// Wait a bit for first value
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Remove listener before second value
			generator.unlisten(listener)
			resolveYield!()

			await generator.waitForCompletion()

			// Should only have received "a"
			expect(receivedValues).toEqual(["a"])
		})
	})

	describe("cancellation", () => {
		it("should mark generator as cancelled and ended", async () => {
			async function* source(): AsyncGenerator<string> {
				yield "a"
				await new Promise((resolve) => setTimeout(resolve, 1000))
				yield "b"
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			// Wait for first value
			await new Promise((resolve) => setTimeout(resolve, 10))

			generator.cancel()

			expect(generator.isCancelled).toBe(true)
			expect(generator.isEnded).toBe(true)
		})

		it("should stop buffering new values after cancel", async () => {
			async function* source(): AsyncGenerator<string> {
				yield "a"
				yield "b"
				yield "c"
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			// Cancel immediately
			generator.cancel()

			// Wait a bit for any pending operations
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Buffer should be empty or have at most the first value
			// (depending on timing, the first yield might have completed)
			expect(generator.getBuffer().length).toBeLessThanOrEqual(1)
		})

		it("should allow checking cancelled state", () => {
			async function* source(): AsyncGenerator<string> {
				yield "a"
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			expect(generator.isCancelled).toBe(false)

			generator.cancel()

			expect(generator.isCancelled).toBe(true)
		})
	})

	describe("tee", () => {
		it("should allow multiple consumers via tee", async () => {
			async function* source(): AsyncGenerator<string> {
				yield "a"
				yield "b"
				yield "c"
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			const consumer1Values: string[] = []
			const consumer2Values: string[] = []

			const consumer1 = (async () => {
				for await (const value of generator.tee()) {
					consumer1Values.push(value)
				}
			})()

			const consumer2 = (async () => {
				for await (const value of generator.tee()) {
					consumer2Values.push(value)
				}
			})()

			await Promise.all([consumer1, consumer2])

			expect(consumer1Values).toEqual(["a", "b", "c"])
			expect(consumer2Values).toEqual(["a", "b", "c"])
		})

		it("should yield buffered values to late consumers", async () => {
			async function* source(): AsyncGenerator<string> {
				yield "a"
				yield "b"
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			await generator.waitForCompletion()

			// Start consuming after completion
			const values: string[] = []
			for await (const value of generator.tee()) {
				values.push(value)
			}

			expect(values).toEqual(["a", "b"])
		})
	})

	describe("error handling", () => {
		it("should call onError when source throws", async () => {
			const testError = new Error("Test error")

			async function* source(): AsyncGenerator<string> {
				yield "a"
				throw testError
			}

			const onError = vi.fn()
			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), onError, abortController)

			await generator.waitForCompletion()

			expect(onError).toHaveBeenCalledWith(testError)
			expect(generator.error).toBe(testError)
			expect(generator.isEnded).toBe(true)
		})

		it("should still notify listeners with null after error", async () => {
			async function* source(): AsyncGenerator<string> {
				yield "a"
				throw new Error("Test error")
			}

			const abortController = new AbortController()
			const generator = new GhostListenableGenerator(source(), vi.fn(), abortController)

			const receivedValues: (string | null)[] = []
			generator.listen((value) => receivedValues.push(value))

			await generator.waitForCompletion()

			expect(receivedValues).toContain("a")
			expect(receivedValues[receivedValues.length - 1]).toBe(null)
		})
	})
})

describe("GhostStringListenableGenerator", () => {
	it("should accumulate text from chunks", async () => {
		async function* source(): AsyncGenerator<string> {
			yield "Hello"
			yield " "
			yield "World"
		}

		const abortController = new AbortController()
		const generator = new GhostStringListenableGenerator(source(), vi.fn(), abortController)

		await generator.waitForCompletion()

		expect(generator.getAccumulatedText()).toBe("Hello World")
	})

	it("should return empty string when no chunks", async () => {
		async function* source(): AsyncGenerator<string> {
			// Empty generator
		}

		const abortController = new AbortController()
		const generator = new GhostStringListenableGenerator(source(), vi.fn(), abortController)

		await generator.waitForCompletion()

		expect(generator.getAccumulatedText()).toBe("")
	})

	it("should accumulate text progressively", async () => {
		let resolveYield: () => void
		const yieldPromise = new Promise<void>((resolve) => {
			resolveYield = resolve
		})

		async function* source(): AsyncGenerator<string> {
			yield "Hello"
			await yieldPromise
			yield " World"
		}

		const abortController = new AbortController()
		const generator = new GhostStringListenableGenerator(source(), vi.fn(), abortController)

		// Wait for first chunk
		await new Promise((resolve) => setTimeout(resolve, 10))
		expect(generator.getAccumulatedText()).toBe("Hello")

		// Allow second chunk
		resolveYield!()
		await generator.waitForCompletion()

		expect(generator.getAccumulatedText()).toBe("Hello World")
	})
})

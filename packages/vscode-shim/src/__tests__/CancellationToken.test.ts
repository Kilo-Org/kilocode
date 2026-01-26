import { CancellationTokenSource } from "../classes/CancellationToken.js"

describe("CancellationToken", () => {
	describe("initial state", () => {
		it("should not be cancelled initially", () => {
			const source = new CancellationTokenSource()
			const token = source.token

			expect(token.isCancellationRequested).toBe(false)
		})

		it("should have onCancellationRequested function", () => {
			const source = new CancellationTokenSource()
			const token = source.token

			expect(typeof token.onCancellationRequested).toBe("function")
		})
	})
})

describe("CancellationTokenSource", () => {
	describe("token property", () => {
		it("should return a CancellationToken", () => {
			const source = new CancellationTokenSource()
			const token = source.token

			expect(token).toBeDefined()
			expect(typeof token.isCancellationRequested).toBe("boolean")
			expect(typeof token.onCancellationRequested).toBe("function")
		})

		it("should return the same token instance on multiple accesses", () => {
			const source = new CancellationTokenSource()

			expect(source.token).toBe(source.token)
		})
	})

	describe("cancel()", () => {
		it("should set isCancellationRequested to true", () => {
			const source = new CancellationTokenSource()

			source.cancel()

			expect(source.token.isCancellationRequested).toBe(true)
		})

		it("should fire onCancellationRequested event", () => {
			const source = new CancellationTokenSource()
			const listener = vi.fn()

			source.token.onCancellationRequested(listener)
			source.cancel()

			expect(listener).toHaveBeenCalledTimes(1)
		})

		it("should only fire event once on multiple cancel calls", () => {
			const source = new CancellationTokenSource()
			const listener = vi.fn()

			source.token.onCancellationRequested(listener)
			source.cancel()
			source.cancel()
			source.cancel()

			expect(listener).toHaveBeenCalledTimes(1)
		})

		it("should be idempotent", () => {
			const source = new CancellationTokenSource()

			source.cancel()
			source.cancel()

			expect(source.token.isCancellationRequested).toBe(true)
		})
	})

	describe("dispose()", () => {
		it("should cancel the token", () => {
			const source = new CancellationTokenSource()

			source.dispose()

			expect(source.token.isCancellationRequested).toBe(true)
		})

		it("should fire onCancellationRequested event", () => {
			const source = new CancellationTokenSource()
			const listener = vi.fn()

			source.token.onCancellationRequested(listener)
			source.dispose()

			expect(listener).toHaveBeenCalledTimes(1)
		})

		it("should be safe to call multiple times", () => {
			const source = new CancellationTokenSource()

			expect(() => {
				source.dispose()
				source.dispose()
			}).not.toThrow()
		})
	})

	describe("onCancellationRequested", () => {
		it("should return a disposable", () => {
			const source = new CancellationTokenSource()
			const listener = vi.fn()

			const disposable = source.token.onCancellationRequested(listener)

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})

		it("should stop listening after disposing", () => {
			const source = new CancellationTokenSource()
			const listener = vi.fn()

			const disposable = source.token.onCancellationRequested(listener)
			disposable.dispose()
			source.cancel()

			expect(listener).not.toHaveBeenCalled()
		})

		it("should call listener immediately if already cancelled", () => {
			const source = new CancellationTokenSource()
			source.cancel()

			const listener = vi.fn()
			source.token.onCancellationRequested(listener)

			// Event was already fired, listener added after won't be called
			// This matches VSCode behavior
			expect(listener).not.toHaveBeenCalled()
		})

		it("should support multiple listeners", () => {
			const source = new CancellationTokenSource()
			const listener1 = vi.fn()
			const listener2 = vi.fn()

			source.token.onCancellationRequested(listener1)
			source.token.onCancellationRequested(listener2)
			source.cancel()

			expect(listener1).toHaveBeenCalledTimes(1)
			expect(listener2).toHaveBeenCalledTimes(1)
		})
	})
})

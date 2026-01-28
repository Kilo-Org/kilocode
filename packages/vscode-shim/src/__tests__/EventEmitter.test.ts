import { EventEmitter } from "../classes/EventEmitter.js"

describe("EventEmitter", () => {
	describe("event subscription", () => {
		it("should subscribe and receive events", () => {
			const emitter = new EventEmitter<string>()
			const listener = vi.fn()

			emitter.event(listener)
			emitter.fire("test")

			expect(listener).toHaveBeenCalledWith("test")
			expect(listener).toHaveBeenCalledTimes(1)
		})

		it("should support multiple listeners", () => {
			const emitter = new EventEmitter<number>()
			const listener1 = vi.fn()
			const listener2 = vi.fn()

			emitter.event(listener1)
			emitter.event(listener2)
			emitter.fire(42)

			expect(listener1).toHaveBeenCalledWith(42)
			expect(listener2).toHaveBeenCalledWith(42)
		})

		it("should bind thisArgs when provided", () => {
			const emitter = new EventEmitter<string>()
			const context = { name: "test", capturedThis: null as unknown }

			emitter.event(function (this: typeof context) {
				this.capturedThis = this
			}, context)

			emitter.fire("event")
			expect(context.capturedThis).toBe(context)
		})

		it("should add disposable to array when provided", () => {
			const emitter = new EventEmitter<string>()
			const disposables: { dispose: () => void }[] = []

			emitter.event(() => {}, undefined, disposables)

			expect(disposables).toHaveLength(1)
			expect(typeof disposables[0]?.dispose).toBe("function")
		})
	})

	describe("dispose subscription", () => {
		it("should stop receiving events after dispose", () => {
			const emitter = new EventEmitter<string>()
			const listener = vi.fn()

			const disposable = emitter.event(listener)
			emitter.fire("before")

			disposable.dispose()
			emitter.fire("after")

			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith("before")
		})
	})

	describe("dispose emitter", () => {
		it("should remove all listeners on dispose", () => {
			const emitter = new EventEmitter<string>()
			const listener1 = vi.fn()
			const listener2 = vi.fn()

			emitter.event(listener1)
			emitter.event(listener2)

			emitter.dispose()
			emitter.fire("test")

			expect(listener1).not.toHaveBeenCalled()
			expect(listener2).not.toHaveBeenCalled()
		})

		it("should have zero listeners after dispose", () => {
			const emitter = new EventEmitter<string>()
			emitter.event(() => {})
			emitter.event(() => {})

			expect(emitter.listenerCount).toBe(2)

			emitter.dispose()
			expect(emitter.listenerCount).toBe(0)
		})
	})

	describe("error handling", () => {
		it("should not fail if a listener throws", () => {
			const emitter = new EventEmitter<string>()
			const goodListener = vi.fn()

			emitter.event(() => {
				throw new Error("Listener error")
			})
			emitter.event(goodListener)

			// Should not throw
			expect(() => emitter.fire("test")).not.toThrow()

			// Good listener should still be called
			expect(goodListener).toHaveBeenCalledWith("test")
		})
	})

	describe("listenerCount", () => {
		it("should track number of listeners", () => {
			const emitter = new EventEmitter<string>()

			expect(emitter.listenerCount).toBe(0)

			const d1 = emitter.event(() => {})
			expect(emitter.listenerCount).toBe(1)

			const d2 = emitter.event(() => {})
			expect(emitter.listenerCount).toBe(2)

			d1.dispose()
			expect(emitter.listenerCount).toBe(1)

			d2.dispose()
			expect(emitter.listenerCount).toBe(0)
		})
	})
})

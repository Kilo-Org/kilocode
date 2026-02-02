import { useToastStore } from "../useToast.js"

describe("useToastStore", () => {
	beforeEach(() => {
		// Reset the store before each test
		useToastStore.setState({ toasts: [] })
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("initial state", () => {
		it("should start with an empty toast queue", () => {
			const state = useToastStore.getState()
			expect(state.toasts).toEqual([])
		})
	})

	describe("addToast", () => {
		it("should add a toast to the queue", () => {
			const { addToast } = useToastStore.getState()

			const id = addToast("Test message")

			const state = useToastStore.getState()
			expect(state.toasts).toHaveLength(1)
			expect(state.toasts[0]).toMatchObject({
				id,
				message: "Test message",
				type: "info",
				duration: 3000,
			})
		})

		it("should add a toast with custom type", () => {
			const { addToast } = useToastStore.getState()

			const id = addToast("Error message", "error")

			const state = useToastStore.getState()
			expect(state.toasts[0]).toMatchObject({
				id,
				message: "Error message",
				type: "error",
			})
		})

		it("should add a toast with custom duration", () => {
			const { addToast } = useToastStore.getState()

			const id = addToast("Custom duration", "info", 5000)

			const state = useToastStore.getState()
			expect(state.toasts[0]).toMatchObject({
				id,
				duration: 5000,
			})
		})

		it("should replace existing toast when adding a new one (immediate display)", () => {
			const { addToast } = useToastStore.getState()

			addToast("First message")
			addToast("Second message")
			addToast("Third message")

			const state = useToastStore.getState()
			// New toasts replace existing ones for immediate display
			expect(state.toasts).toHaveLength(1)
			expect(state.toasts[0]?.message).toBe("Third message")
		})

		it("should generate unique IDs for each toast", () => {
			const { addToast } = useToastStore.getState()

			const id1 = addToast("First")
			const id2 = addToast("Second")
			const id3 = addToast("Third")

			expect(id1).not.toBe(id2)
			expect(id2).not.toBe(id3)
			expect(id1).not.toBe(id3)
		})

		it("should set createdAt timestamp", () => {
			const { addToast } = useToastStore.getState()
			const beforeTime = Date.now()

			addToast("Timestamped message")

			const state = useToastStore.getState()
			expect(state.toasts[0]?.createdAt).toBeGreaterThanOrEqual(beforeTime)
			expect(state.toasts[0]?.createdAt).toBeLessThanOrEqual(Date.now())
		})

		it("should support success type", () => {
			const { addToast } = useToastStore.getState()

			addToast("Success", "success")

			const state = useToastStore.getState()
			expect(state.toasts[0]?.type).toBe("success")
		})

		it("should support warning type", () => {
			const { addToast } = useToastStore.getState()

			addToast("Warning", "warning")

			const state = useToastStore.getState()
			expect(state.toasts[0]?.type).toBe("warning")
		})
	})

	describe("removeToast", () => {
		it("should remove a toast by ID", () => {
			const { addToast, removeToast } = useToastStore.getState()

			const id = addToast("Only toast")

			removeToast(id)

			const state = useToastStore.getState()
			expect(state.toasts).toHaveLength(0)
		})

		it("should handle removing non-existent toast gracefully", () => {
			const { addToast, removeToast } = useToastStore.getState()

			addToast("Only toast")

			removeToast("non-existent-id")

			const state = useToastStore.getState()
			expect(state.toasts).toHaveLength(1)
		})
	})

	describe("clearToasts", () => {
		it("should clear all toasts", () => {
			const { addToast, clearToasts } = useToastStore.getState()

			addToast("First")
			addToast("Second")
			addToast("Third")

			clearToasts()

			const state = useToastStore.getState()
			expect(state.toasts).toHaveLength(0)
		})

		it("should handle clearing empty queue", () => {
			const { clearToasts } = useToastStore.getState()

			clearToasts()

			const state = useToastStore.getState()
			expect(state.toasts).toHaveLength(0)
		})
	})

	describe("immediate replacement behavior", () => {
		it("should show latest toast immediately when multiple are added", () => {
			const { addToast } = useToastStore.getState()

			addToast("First")
			addToast("Second")
			const id3 = addToast("Third")

			const state = useToastStore.getState()
			// Only most recent toast is present
			expect(state.toasts).toHaveLength(1)
			expect(state.toasts[0]?.id).toBe(id3)
			expect(state.toasts[0]?.message).toBe("Third")
		})

		it("should return empty when toast is removed", () => {
			const { addToast, removeToast } = useToastStore.getState()

			const id = addToast("Only toast")
			removeToast(id)

			const state = useToastStore.getState()
			expect(state.toasts).toHaveLength(0)
		})
	})
})

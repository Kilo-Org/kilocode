import { abortableDelay } from "../abortableDelay"

describe("abortableDelay", () => {
	test("should resolve after specified delay", async () => {
		const startTime = Date.now()
		const abortController = new AbortController()

		await abortableDelay(50, abortController.signal)

		const elapsed = Date.now() - startTime
		expect(elapsed).toBeGreaterThanOrEqual(45) // Allow some tolerance
	})

	test("should reject when aborted before delay completes", async () => {
		const abortController = new AbortController()

		// Abort after 25ms
		setTimeout(() => abortController.abort(), 25)

		await expect(abortableDelay(100, abortController.signal)).rejects.toThrow("Aborted")
	})

	test("should reject immediately if signal is already aborted", async () => {
		const abortController = new AbortController()
		abortController.abort()

		await expect(abortableDelay(50, abortController.signal)).rejects.toThrow("Aborted")
	})
})

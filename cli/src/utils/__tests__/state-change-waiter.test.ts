import { describe, it, expect } from "vitest"
import { createStateChangeWaiter } from "../state-change-waiter.js"

describe("state-change-waiter", () => {
	it("resolves when notifyChanged is called", async () => {
		const waiter = createStateChangeWaiter()

		let resolved = false
		const promise = waiter.waitForChange().then(() => {
			resolved = true
		})

		await Promise.resolve()
		expect(resolved).toBe(false)

		waiter.notifyChanged()
		await promise
		expect(resolved).toBe(true)
	})

	it("requires a new notifyChanged for subsequent waits", async () => {
		const waiter = createStateChangeWaiter()

		const first = waiter.waitForChange()
		waiter.notifyChanged()
		await first

		let resolved = false
		const pending = waiter.waitForChange().then(() => {
			resolved = true
		})

		await Promise.resolve()
		expect(resolved).toBe(false)

		waiter.notifyChanged()
		await pending
		expect(resolved).toBe(true)
	})
})

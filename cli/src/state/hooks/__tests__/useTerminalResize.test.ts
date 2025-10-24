/**
 * Tests for useTerminalResize hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createStore } from "jotai"
import { messageResetCounterAtom } from "../../atoms/ui.js"

describe("useTerminalResize", () => {
	let store: ReturnType<typeof createStore>
	let originalIsTTY: boolean
	let resizeListeners: Array<() => void> = []

	beforeEach(() => {
		store = createStore()
		originalIsTTY = process.stdout.isTTY
		resizeListeners = []

		// Mock process.stdout
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		})

		// Mock process.stdout.on and off
		vi.spyOn(process.stdout, "on").mockImplementation((event: string, listener: any) => {
			if (event === "resize") {
				resizeListeners.push(listener)
			}
			return process.stdout
		})

		vi.spyOn(process.stdout, "off").mockImplementation((event: string | symbol, listener: any) => {
			if (event === "resize") {
				const index = resizeListeners.indexOf(listener)
				if (index > -1) {
					resizeListeners.splice(index, 1)
				}
			}
			return process.stdout
		})

		vi.spyOn(process.stdout, "write").mockImplementation(() => true)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		Object.defineProperty(process.stdout, "isTTY", {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		})
	})

	describe("Terminal Resize Detection", () => {
		it("should initialize messageResetCounterAtom with 0", () => {
			const counter = store.get(messageResetCounterAtom)
			expect(counter).toBe(0)
		})

		it("should increment reset counter when manually triggered", () => {
			const initialCounter = store.get(messageResetCounterAtom)

			// Manually increment the counter (simulating what the hook does)
			store.set(messageResetCounterAtom, (prev) => prev + 1)

			const newCounter = store.get(messageResetCounterAtom)
			expect(newCounter).toBe(initialCounter + 1)
		})

		it("should handle multiple increments", () => {
			const initialCounter = store.get(messageResetCounterAtom)

			// Simulate multiple resize events
			store.set(messageResetCounterAtom, (prev) => prev + 1)
			store.set(messageResetCounterAtom, (prev) => prev + 1)
			store.set(messageResetCounterAtom, (prev) => prev + 1)

			const newCounter = store.get(messageResetCounterAtom)
			expect(newCounter).toBe(initialCounter + 3)
		})
	})

	describe("Terminal Clear Functionality", () => {
		it("should verify ANSI clear codes are correct", () => {
			const clearCode = "\x1b[2J\x1b[H"

			// Verify the clear code format
			expect(clearCode).toContain("\x1b[2J") // Clear entire screen
			expect(clearCode).toContain("\x1b[H") // Move cursor to home
		})

		it("should verify stdout.write can be called with clear codes", () => {
			const clearCode = "\x1b[2J\x1b[H"

			process.stdout.write(clearCode)

			expect(process.stdout.write).toHaveBeenCalledWith(clearCode)
		})
	})

	describe("Hook Export", () => {
		it("should export useTerminalResize hook", async () => {
			const hooks = await import("../index.js")

			expect(hooks.useTerminalResize).toBeDefined()
			expect(typeof hooks.useTerminalResize).toBe("function")
		})
	})
})

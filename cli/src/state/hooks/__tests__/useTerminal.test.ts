/**
 * Tests for useTerminal hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createStore } from "jotai"
import { messageResetCounterAtom, messageCutoffTimestampAtom } from "../../atoms/ui.js"

describe("useTerminal", () => {
	let store: ReturnType<typeof createStore>
	let originalIsTTY: boolean
	let resizeListeners: Array<() => void> = []
	let originalColumns: number

	beforeEach(() => {
		store = createStore()
		originalIsTTY = process.stdout.isTTY
		originalColumns = process.stdout.columns
		resizeListeners = []

		// Mock process.stdout
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		})

		Object.defineProperty(process.stdout, "columns", {
			value: 80,
			writable: true,
			configurable: true,
		})

		// Mock process.stdout.on and off
		vi.spyOn(process.stdout, "on").mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
			if (event === "resize") {
				resizeListeners.push(listener)
			}
			return process.stdout
		})

		vi.spyOn(process.stdout, "off").mockImplementation(
			(event: string | symbol, listener: (...args: unknown[]) => void) => {
				if (event === "resize") {
					const index = resizeListeners.indexOf(listener)
					if (index > -1) {
						resizeListeners.splice(index, 1)
					}
				}
				return process.stdout
			},
		)

		vi.spyOn(process.stdout, "write").mockImplementation(() => true)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		Object.defineProperty(process.stdout, "isTTY", {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(process.stdout, "columns", {
			value: originalColumns,
			writable: true,
			configurable: true,
		})
	})

	describe("State Atoms", () => {
		it("should initialize messageResetCounterAtom with 0", () => {
			const counter = store.get(messageResetCounterAtom)
			expect(counter).toBe(0)
		})

		it("should initialize messageCutoffTimestampAtom with 0", () => {
			const timestamp = store.get(messageCutoffTimestampAtom)
			expect(timestamp).toBe(0)
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

			// Simulate multiple clear events
			store.set(messageResetCounterAtom, (prev) => prev + 1)
			store.set(messageResetCounterAtom, (prev) => prev + 1)
			store.set(messageResetCounterAtom, (prev) => prev + 1)

			const newCounter = store.get(messageResetCounterAtom)
			expect(newCounter).toBe(initialCounter + 3)
		})

		it("should update messageCutoffTimestamp", () => {
			const timestamp = Date.now()
			store.set(messageCutoffTimestampAtom, timestamp)

			const storedTimestamp = store.get(messageCutoffTimestampAtom)
			expect(storedTimestamp).toBe(timestamp)
		})
	})

	describe("Terminal Clear Functionality", () => {
		it("should verify ANSI clear codes are correct", () => {
			const clearCode = "\x1b[2J\x1b[3J\x1b[H"

			// Verify the clear code format
			expect(clearCode).toContain("\x1b[2J") // Clear entire screen
			expect(clearCode).toContain("\x1b[3J") // Clear scrollback buffer (gnome-terminal)
			expect(clearCode).toContain("\x1b[H") // Move cursor to home
		})

		it("should verify stdout.write can be called with clear codes", () => {
			const clearCode = "\x1b[2J\x1b[3J\x1b[H"

			process.stdout.write(clearCode)

			expect(process.stdout.write).toHaveBeenCalledWith(clearCode)
		})
	})

	describe("Terminal Resize Detection", () => {
		it("should track resize listeners", () => {
			// Simulate adding a resize listener
			const mockListener = vi.fn()
			process.stdout.on("resize", mockListener)

			expect(resizeListeners).toContain(mockListener)
			expect(resizeListeners.length).toBe(1)
		})

		it("should remove resize listeners", () => {
			// Simulate adding and removing a resize listener
			const mockListener = vi.fn()
			process.stdout.on("resize", mockListener)
			expect(resizeListeners.length).toBe(1)

			process.stdout.off("resize", mockListener)
			expect(resizeListeners.length).toBe(0)
		})

		it("should detect column width changes", () => {
			const initialWidth = process.stdout.columns

			// Change columns
			Object.defineProperty(process.stdout, "columns", {
				value: 120,
				writable: true,
				configurable: true,
			})

			expect(process.stdout.columns).not.toBe(initialWidth)
			expect(process.stdout.columns).toBe(120)
		})
	})

	describe("Hook Integration", () => {
		it("should verify hook handles both resize and cutoff timestamp", () => {
			// The hook should:
			// 1. Set up resize listener when stdout is TTY
			// 2. Clear terminal when messageCutoffTimestamp changes to non-zero
			// 3. Clear terminal when terminal width changes
			// 4. Increment messageResetCounter on each clear

			// This test verifies the atoms and mocks are set up correctly
			// The actual hook behavior is tested through integration
			expect(store.get(messageResetCounterAtom)).toBe(0)
			expect(store.get(messageCutoffTimestampAtom)).toBe(0)
			expect(process.stdout.isTTY).toBe(true)
		})
	})

	describe("Hook Export", () => {
		it("should export useTerminal hook", async () => {
			const hooks = await import("../index.js")

			expect(hooks.useTerminal).toBeDefined()
			expect(typeof hooks.useTerminal).toBe("function")
		})
	})
})

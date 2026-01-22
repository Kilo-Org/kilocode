import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ensureRawMode, withRawMode } from "../terminal.js"

describe("terminal utilities", () => {
	let originalIsTTY: boolean | undefined
	let originalIsRaw: boolean | undefined
	let originalSetRawMode: typeof process.stdin.setRawMode | undefined

	beforeEach(() => {
		// Store original values
		originalIsTTY = process.stdin.isTTY
		originalIsRaw = process.stdin.isRaw
		originalSetRawMode = process.stdin.setRawMode
	})

	afterEach(() => {
		// Restore original values
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		})
		Object.defineProperty(process.stdin, "isRaw", {
			value: originalIsRaw,
			writable: true,
			configurable: true,
		})
		if (originalSetRawMode) {
			process.stdin.setRawMode = originalSetRawMode
		}
		vi.restoreAllMocks()
	})

	describe("ensureRawMode", () => {
		it("should return noop cleanup when stdin is not a TTY", () => {
			Object.defineProperty(process.stdin, "isTTY", {
				value: false,
				writable: true,
				configurable: true,
			})

			const cleanup = ensureRawMode()

			// Should return a function that does nothing
			expect(typeof cleanup).toBe("function")
			cleanup() // Should not throw
		})

		it("should return noop cleanup when setRawMode is not available", () => {
			Object.defineProperty(process.stdin, "isTTY", {
				value: true,
				writable: true,
				configurable: true,
			})
			// @ts-expect-error - intentionally setting to undefined for test
			process.stdin.setRawMode = undefined

			const cleanup = ensureRawMode()

			expect(typeof cleanup).toBe("function")
			cleanup() // Should not throw
		})

		it("should enable raw mode when not already enabled", () => {
			const mockSetRawMode = vi.fn()

			Object.defineProperty(process.stdin, "isTTY", {
				value: true,
				writable: true,
				configurable: true,
			})
			Object.defineProperty(process.stdin, "isRaw", {
				value: false,
				writable: true,
				configurable: true,
			})
			process.stdin.setRawMode = mockSetRawMode

			const cleanup = ensureRawMode()

			expect(mockSetRawMode).toHaveBeenCalledWith(true)
			expect(typeof cleanup).toBe("function")
		})

		it("should not enable raw mode when already enabled", () => {
			const mockSetRawMode = vi.fn()

			Object.defineProperty(process.stdin, "isTTY", {
				value: true,
				writable: true,
				configurable: true,
			})
			Object.defineProperty(process.stdin, "isRaw", {
				value: true,
				writable: true,
				configurable: true,
			})
			process.stdin.setRawMode = mockSetRawMode

			const cleanup = ensureRawMode()

			expect(mockSetRawMode).not.toHaveBeenCalled()
			expect(typeof cleanup).toBe("function")
		})

		it("should restore raw mode to false on cleanup when it was originally false", () => {
			const mockSetRawMode = vi.fn()

			Object.defineProperty(process.stdin, "isTTY", {
				value: true,
				writable: true,
				configurable: true,
			})
			Object.defineProperty(process.stdin, "isRaw", {
				value: false,
				writable: true,
				configurable: true,
			})
			process.stdin.setRawMode = mockSetRawMode

			const cleanup = ensureRawMode()
			cleanup()

			expect(mockSetRawMode).toHaveBeenCalledTimes(2)
			expect(mockSetRawMode).toHaveBeenNthCalledWith(1, true)
			expect(mockSetRawMode).toHaveBeenNthCalledWith(2, false)
		})

		it("should not restore raw mode on cleanup when it was originally true", () => {
			const mockSetRawMode = vi.fn()

			Object.defineProperty(process.stdin, "isTTY", {
				value: true,
				writable: true,
				configurable: true,
			})
			Object.defineProperty(process.stdin, "isRaw", {
				value: true,
				writable: true,
				configurable: true,
			})
			process.stdin.setRawMode = mockSetRawMode

			const cleanup = ensureRawMode()
			cleanup()

			// Should not have been called at all since raw mode was already enabled
			expect(mockSetRawMode).not.toHaveBeenCalled()
		})

		it("should handle setRawMode throwing an error gracefully", () => {
			const mockSetRawMode = vi.fn().mockImplementation(() => {
				throw new Error("Cannot set raw mode")
			})

			Object.defineProperty(process.stdin, "isTTY", {
				value: true,
				writable: true,
				configurable: true,
			})
			Object.defineProperty(process.stdin, "isRaw", {
				value: false,
				writable: true,
				configurable: true,
			})
			process.stdin.setRawMode = mockSetRawMode

			// Should not throw
			const cleanup = ensureRawMode()
			expect(typeof cleanup).toBe("function")
			cleanup() // Should not throw
		})
	})

	describe("withRawMode", () => {
		it("should call the provided function and return its result", async () => {
			Object.defineProperty(process.stdin, "isTTY", {
				value: false,
				writable: true,
				configurable: true,
			})

			const mockFn = vi.fn().mockResolvedValue("test result")

			const result = await withRawMode(mockFn)

			expect(mockFn).toHaveBeenCalled()
			expect(result).toBe("test result")
		})

		it("should enable raw mode before calling the function", async () => {
			const mockSetRawMode = vi.fn()
			const callOrder: string[] = []

			Object.defineProperty(process.stdin, "isTTY", {
				value: true,
				writable: true,
				configurable: true,
			})
			Object.defineProperty(process.stdin, "isRaw", {
				value: false,
				writable: true,
				configurable: true,
			})
			process.stdin.setRawMode = mockSetRawMode.mockImplementation(() => {
				callOrder.push("setRawMode")
			})

			const mockFn = vi.fn().mockImplementation(async () => {
				callOrder.push("fn")
				return "result"
			})

			await withRawMode(mockFn)

			expect(callOrder).toEqual(["setRawMode", "fn", "setRawMode"])
		})

		it("should restore raw mode even if the function throws", async () => {
			const mockSetRawMode = vi.fn()

			Object.defineProperty(process.stdin, "isTTY", {
				value: true,
				writable: true,
				configurable: true,
			})
			Object.defineProperty(process.stdin, "isRaw", {
				value: false,
				writable: true,
				configurable: true,
			})
			process.stdin.setRawMode = mockSetRawMode

			const mockFn = vi.fn().mockRejectedValue(new Error("Test error"))

			await expect(withRawMode(mockFn)).rejects.toThrow("Test error")

			// Should have called setRawMode twice: once to enable, once to restore
			expect(mockSetRawMode).toHaveBeenCalledTimes(2)
			expect(mockSetRawMode).toHaveBeenNthCalledWith(1, true)
			expect(mockSetRawMode).toHaveBeenNthCalledWith(2, false)
		})
	})
})

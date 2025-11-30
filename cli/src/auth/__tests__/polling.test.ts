import { describe, it, expect, vi } from "vitest"
import { poll, formatTimeRemaining } from "../utils/polling.js"

describe("Polling Utility", () => {
	describe("poll", () => {
		it("should successfully poll and return data", async () => {
			const mockData = { success: true }
			const pollFn = vi.fn().mockResolvedValue({
				continue: false,
				data: mockData,
			})

			const result = await poll({
				interval: 100,
				maxAttempts: 5,
				pollFn,
			})

			expect(result).toEqual(mockData)
			expect(pollFn).toHaveBeenCalledTimes(1)
		})

		it("should continue polling until success", async () => {
			const mockData = { success: true }
			let attempts = 0
			const pollFn = vi.fn().mockImplementation(() => {
				attempts++
				if (attempts < 3) {
					return Promise.resolve({ continue: true })
				}
				return Promise.resolve({ continue: false, data: mockData })
			})

			const result = await poll({
				interval: 10,
				maxAttempts: 5,
				pollFn,
			})

			expect(result).toEqual(mockData)
			expect(pollFn).toHaveBeenCalledTimes(3)
		})

		it("should throw error when max attempts reached", async () => {
			const pollFn = vi.fn().mockResolvedValue({ continue: true })

			await expect(
				poll({
					interval: 10,
					maxAttempts: 3,
					pollFn,
				}),
			).rejects.toThrow("Polling timeout: Maximum attempts reached")

			expect(pollFn).toHaveBeenCalledTimes(3)
		})

		it("should throw error from poll result", async () => {
			const error = new Error("Test error")
			const pollFn = vi.fn().mockResolvedValue({
				continue: false,
				error,
			})

			await expect(
				poll({
					interval: 10,
					maxAttempts: 5,
					pollFn,
				}),
			).rejects.toThrow("Test error")
		})

		it("should call onProgress callback", async () => {
			const mockData = { success: true }
			const onProgress = vi.fn()
			let attempts = 0
			const pollFn = vi.fn().mockImplementation(() => {
				attempts++
				if (attempts < 3) {
					return Promise.resolve({ continue: true })
				}
				return Promise.resolve({ continue: false, data: mockData })
			})

			await poll({
				interval: 10,
				maxAttempts: 5,
				pollFn,
				onProgress,
			})

			expect(onProgress).toHaveBeenCalledTimes(3)
			expect(onProgress).toHaveBeenNthCalledWith(1, 1, 5)
			expect(onProgress).toHaveBeenNthCalledWith(2, 2, 5)
			expect(onProgress).toHaveBeenNthCalledWith(3, 3, 5)
		})

		it("should retry on transient errors", async () => {
			const mockData = { success: true }
			let attempts = 0
			const pollFn = vi.fn().mockImplementation(() => {
				attempts++
				if (attempts === 1) {
					throw new Error("Network error")
				}
				return Promise.resolve({ continue: false, data: mockData })
			})

			const result = await poll({
				interval: 10,
				maxAttempts: 5,
				pollFn,
			})

			expect(result).toEqual(mockData)
			expect(pollFn).toHaveBeenCalledTimes(2)
		})
	})

	describe("formatTimeRemaining", () => {
		it("should format time correctly", () => {
			const startTime = Date.now() - 30000 // 30 seconds ago
			const expiresIn = 600 // 10 minutes

			const result = formatTimeRemaining(startTime, expiresIn)

			expect(result).toMatch(/^9:[0-9]{2}$/)
		})

		it("should handle zero remaining time", () => {
			const startTime = Date.now() - 600000 // 10 minutes ago
			const expiresIn = 600 // 10 minutes

			const result = formatTimeRemaining(startTime, expiresIn)

			expect(result).toBe("0:00")
		})

		it("should pad seconds with zero", () => {
			const startTime = Date.now() - 595000 // 9:55 ago
			const expiresIn = 600 // 10 minutes

			const result = formatTimeRemaining(startTime, expiresIn)

			expect(result).toBe("0:05")
		})
	})
})

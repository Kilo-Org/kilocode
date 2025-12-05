import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DeviceAuthService } from "../DeviceAuthService"
import type { DeviceAuthInitiateResponse, DeviceAuthPollResponse } from "@roo-code/types"

// Mock fetch globally
global.fetch = vi.fn()

describe("DeviceAuthService", () => {
	let service: DeviceAuthService

	beforeEach(() => {
		service = new DeviceAuthService()
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		service.dispose()
		vi.useRealTimers()
	})

	describe("initiate", () => {
		it("should successfully initiate device auth", async () => {
			const mockResponse: DeviceAuthInitiateResponse = {
				code: "ABC123",
				verificationUrl: "https://kilo.ai/device/verify",
				expiresIn: 600,
			}

			const startedSpy = vi.fn()
			service.on("started", startedSpy)
			;(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			})

			// Mock the first poll call to return pending
			;(global.fetch as any).mockResolvedValueOnce({
				status: 202,
			})

			const result = await service.initiate()

			expect(result).toEqual(mockResponse)
			expect(startedSpy).toHaveBeenCalledWith(mockResponse)
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/device-auth/codes"),
				expect.objectContaining({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
				}),
			)
		})

		it("should handle rate limiting (429)", async () => {
			;(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 429,
			})

			const errorSpy = vi.fn()
			service.on("error", errorSpy)

			await expect(service.initiate()).rejects.toThrow("Too many pending authorization requests")
			expect(errorSpy).toHaveBeenCalled()
		})

		it("should handle other errors", async () => {
			;(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 500,
			})

			const errorSpy = vi.fn()
			service.on("error", errorSpy)

			await expect(service.initiate()).rejects.toThrow("Failed to initiate device authorization: 500")
			expect(errorSpy).toHaveBeenCalled()
		})
	})

	describe("polling", () => {
		it("should emit polling event for pending status", async () => {
			const pollingSpy = vi.fn()
			service.on("polling", pollingSpy)

			const mockInitResponse: DeviceAuthInitiateResponse = {
				code: "ABC123",
				verificationUrl: "https://kilo.ai/device/verify",
				expiresIn: 600,
			}

			// Mock initiate call
			;(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockInitResponse,
			})

			// Mock all subsequent polls to return pending to prevent infinite loop
			;(global.fetch as any).mockResolvedValue({
				status: 202,
			})

			await service.initiate()

			// Wait for the immediate poll call
			await vi.advanceTimersByTimeAsync(100)

			expect(pollingSpy).toHaveBeenCalled()

			// Clean up to prevent background timers
			service.cancel()
		})

		it("should emit success event when approved", async () => {
			const successSpy = vi.fn()
			service.on("success", successSpy)

			const mockInitResponse: DeviceAuthInitiateResponse = {
				code: "ABC123",
				verificationUrl: "https://kilo.ai/device/verify",
				expiresIn: 600,
			}

			const mockPollResponse: DeviceAuthPollResponse = {
				status: "approved",
				token: "test-token",
				userEmail: "test@example.com",
			}

			// Mock initiate call
			;(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockInitResponse,
			})

			// Mock poll - approved
			;(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => mockPollResponse,
			})

			await service.initiate()

			// Wait for the immediate poll call
			await vi.runAllTimersAsync()

			expect(successSpy).toHaveBeenCalledWith("test-token", "test@example.com")
		})

		it("should emit denied event when user denies", async () => {
			const deniedSpy = vi.fn()
			service.on("denied", deniedSpy)

			const mockInitResponse: DeviceAuthInitiateResponse = {
				code: "ABC123",
				verificationUrl: "https://kilo.ai/device/verify",
				expiresIn: 600,
			}

			// Mock initiate call
			;(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockInitResponse,
			})

			// Mock poll - denied
			;(global.fetch as any).mockResolvedValueOnce({
				status: 403,
			})

			await service.initiate()

			// Wait for the immediate poll call
			await vi.runAllTimersAsync()

			expect(deniedSpy).toHaveBeenCalled()
		})

		it("should emit expired event when code expires", async () => {
			const expiredSpy = vi.fn()
			service.on("expired", expiredSpy)

			const mockInitResponse: DeviceAuthInitiateResponse = {
				code: "ABC123",
				verificationUrl: "https://kilo.ai/device/verify",
				expiresIn: 600,
			}

			// Mock initiate call
			;(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockInitResponse,
			})

			// Mock poll - expired
			;(global.fetch as any).mockResolvedValueOnce({
				status: 410,
			})

			await service.initiate()

			// Wait for the immediate poll call
			await vi.runAllTimersAsync()

			expect(expiredSpy).toHaveBeenCalled()
		})

		it("should handle polling errors", async () => {
			const errorSpy = vi.fn()
			service.on("error", errorSpy)

			const mockInitResponse: DeviceAuthInitiateResponse = {
				code: "ABC123",
				verificationUrl: "https://kilo.ai/device/verify",
				expiresIn: 600,
			}

			// Mock initiate call
			;(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockInitResponse,
			})

			// Mock poll - error
			;(global.fetch as any).mockRejectedValueOnce(new Error("Network error"))

			await service.initiate()

			// Wait for the immediate poll call
			await vi.runAllTimersAsync()

			expect(errorSpy).toHaveBeenCalled()
		})
	})

	describe("cancel", () => {
		it("should emit cancelled event and stop polling", async () => {
			const cancelledSpy = vi.fn()
			service.on("cancelled", cancelledSpy)

			const mockResponse: DeviceAuthInitiateResponse = {
				code: "ABC123",
				verificationUrl: "https://kilo.ai/device/verify",
				expiresIn: 600,
			}

			;(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			})

			// Mock first poll
			;(global.fetch as any).mockResolvedValueOnce({
				status: 202,
			})

			await service.initiate()

			service.cancel()

			expect(cancelledSpy).toHaveBeenCalled()

			// Verify polling stopped by checking no more fetch calls after cancel
			vi.clearAllMocks()
			await vi.advanceTimersByTimeAsync(5000)
			expect(global.fetch).not.toHaveBeenCalled()
		})
	})

	describe("dispose", () => {
		it("should clean up resources", async () => {
			const mockResponse: DeviceAuthInitiateResponse = {
				code: "ABC123",
				verificationUrl: "https://kilo.ai/device/verify",
				expiresIn: 600,
			}

			;(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			})

			// Mock first poll
			;(global.fetch as any).mockResolvedValueOnce({
				status: 202,
			})

			await service.initiate()

			service.dispose()

			// Verify polling stopped
			vi.clearAllMocks()
			await vi.advanceTimersByTimeAsync(5000)
			expect(global.fetch).not.toHaveBeenCalled()
		})
	})
})

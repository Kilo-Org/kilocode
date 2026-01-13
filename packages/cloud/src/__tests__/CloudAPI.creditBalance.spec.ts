import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { CloudAPI } from "../CloudAPI.js"
import { AuthenticationError, CloudAPIError } from "../errors.js"
import type { AuthService } from "@roo-code/types"

// Mock the config module
vi.mock("../config.js", () => ({
	getRooCodeApiUrl: () => "https://api.test.com",
}))

// Mock the utils module
vi.mock("../utils.js", () => ({
	getUserAgent: () => "test-user-agent",
}))

describe("CloudAPI.creditBalance", () => {
	let mockAuthService: {
		getSessionToken: Mock<() => string | undefined>
	}
	let cloudAPI: CloudAPI

	beforeEach(() => {
		mockAuthService = {
			getSessionToken: vi.fn(),
		}
		cloudAPI = new CloudAPI(mockAuthService as unknown as AuthService)

		// Reset fetch mock
		global.fetch = vi.fn()
	})

	it("should fetch credit balance successfully", async () => {
		const mockBalance = 12.34
		mockAuthService.getSessionToken.mockReturnValue("test-session-token")

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ balance: mockBalance }),
		})

		const balance = await cloudAPI.creditBalance()

		expect(balance).toBe(mockBalance)
		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.test.com/api/extension/credit-balance",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer test-session-token",
					"Content-Type": "application/json",
					"User-Agent": "test-user-agent",
				}),
			}),
		)
	})

	it("should throw AuthenticationError when session token is missing", async () => {
		mockAuthService.getSessionToken.mockReturnValue(undefined)

		await expect(cloudAPI.creditBalance()).rejects.toThrow(AuthenticationError)
	})

	it("should handle API errors", async () => {
		mockAuthService.getSessionToken.mockReturnValue("test-session-token")

		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			json: async () => ({ error: "Server error" }),
		})

		await expect(cloudAPI.creditBalance()).rejects.toThrow(CloudAPIError)
	})

	it("should handle network errors", async () => {
		mockAuthService.getSessionToken.mockReturnValue("test-session-token")

		global.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"))

		await expect(cloudAPI.creditBalance()).rejects.toThrow(
			"Network error while calling /api/extension/credit-balance",
		)
	})

	it("should handle invalid response format", async () => {
		mockAuthService.getSessionToken.mockReturnValue("test-session-token")

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ invalid: "response" }),
		})

		await expect(cloudAPI.creditBalance()).rejects.toThrow()
	})
})

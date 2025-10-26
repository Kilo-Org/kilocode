// npx vitest run src/__tests__/kilocode.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
	ghostServiceSettingsSchema,
	checkKilocodeBalance,
	getApiUrl,
	getAppUrl,
	getKiloUrlFromToken,
	getExtensionConfigUrl,
} from "../kilocode/kilocode.js"

describe("ghostServiceSettingsSchema", () => {
	describe("autoTriggerDelay", () => {
		it("should accept valid millisecond values", () => {
			const validValues = [50, 100, 200, 1000, 3000, 5000]

			for (const value of validValues) {
				const result = ghostServiceSettingsSchema.safeParse({
					autoTriggerDelay: value,
				})
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.data?.autoTriggerDelay).toBe(value)
				}
			}
		})

		it("should accept legacy second values for backward compatibility (1-5 seconds)", () => {
			// Values 1-5 are treated as seconds and capped at 5 (= 5000ms)
			const legacyValues = [1, 3, 5]

			for (const value of legacyValues) {
				const result = ghostServiceSettingsSchema.safeParse({
					autoTriggerDelay: value,
				})
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.data?.autoTriggerDelay).toBe(value)
				}
			}
		})

		it("should accept legacy values above 5 seconds (they get capped at runtime)", () => {
			const legacyValues = [6, 10, 30, 49]

			for (const value of legacyValues) {
				const result = ghostServiceSettingsSchema.safeParse({
					autoTriggerDelay: value,
				})
				expect(result.success).toBe(true)
			}
		})

		it("should reject values below minimum (1 for legacy, 50 for new)", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				autoTriggerDelay: 0,
			})
			expect(result.success).toBe(false)
		})

		it("should reject values above maximum (5000ms)", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				autoTriggerDelay: 5001,
			})
			expect(result.success).toBe(false)
		})

		it("should be optional", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				enableAutoTrigger: true,
			})
			expect(result.success).toBe(true)
		})
	})

	describe("other ghost service settings", () => {
		it("should accept all boolean settings", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				enableAutoTrigger: true,
				enableQuickInlineTaskKeybinding: false,
				enableSmartInlineTaskKeybinding: true,
				showGutterAnimation: false,
			})
			expect(result.success).toBe(true)
		})

		it("should accept combined settings", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				enableAutoTrigger: true,
				autoTriggerDelay: 1500,
				enableQuickInlineTaskKeybinding: true,
				enableSmartInlineTaskKeybinding: true,
				showGutterAnimation: true,
			})
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data?.autoTriggerDelay).toBe(1500)
			}
		})
	})
})

describe("checkKilocodeBalance", () => {
	const mockToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbnYiOiJwcm9kdWN0aW9uIn0.test"
	const mockOrgId = "org-123"

	beforeEach(() => {
		global.fetch = vi.fn()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should return true when balance is positive", async () => {
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: true,
			json: async () => ({ balance: 100 }),
		} as Response)

		const result = await checkKilocodeBalance(mockToken)
		expect(result).toBe(true)
		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.kilocode.ai/api/profile/balance",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: `Bearer ${mockToken}`,
				}),
			}),
		)
	})

	it("should return false when balance is zero", async () => {
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: true,
			json: async () => ({ balance: 0 }),
		} as Response)

		const result = await checkKilocodeBalance(mockToken)
		expect(result).toBe(false)
	})

	it("should return false when balance is negative", async () => {
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: true,
			json: async () => ({ balance: -10 }),
		} as Response)

		const result = await checkKilocodeBalance(mockToken)
		expect(result).toBe(false)
	})

	it("should include organization ID in headers when provided", async () => {
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: true,
			json: async () => ({ balance: 100 }),
		} as Response)

		const result = await checkKilocodeBalance(mockToken, mockOrgId)
		expect(result).toBe(true)
		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.kilocode.ai/api/profile/balance",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: `Bearer ${mockToken}`,
					"X-KiloCode-OrganizationId": mockOrgId,
				}),
			}),
		)
	})

	it("should not include organization ID in headers when not provided", async () => {
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: true,
			json: async () => ({ balance: 100 }),
		} as Response)

		await checkKilocodeBalance(mockToken)

		const fetchCall = vi.mocked(global.fetch).mock.calls[0]
		expect(fetchCall).toBeDefined()
		const headers = (fetchCall![1] as RequestInit)?.headers as Record<string, string>

		expect(headers).toHaveProperty("Authorization")
		expect(headers).not.toHaveProperty("X-KiloCode-OrganizationId")
	})

	it("should return false when API request fails", async () => {
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: false,
		} as Response)

		const result = await checkKilocodeBalance(mockToken)
		expect(result).toBe(false)
	})

	it("should return false when fetch throws an error", async () => {
		vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"))

		const result = await checkKilocodeBalance(mockToken)
		expect(result).toBe(false)
	})

	it("should handle missing balance field in response", async () => {
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: true,
			json: async () => ({}),
		} as Response)

		const result = await checkKilocodeBalance(mockToken)
		expect(result).toBe(false)
	})
})

describe("URL functions", () => {
	const originalEnv = process.env.KILOCODE_BACKEND_BASE_URL

	// Helper functions to create properly formatted test tokens
	const createDevToken = () => {
		const payload = { env: "development" }
		return `header.${btoa(JSON.stringify(payload))}.signature`
	}

	const createProdToken = () => {
		const payload = {}
		return `header.${btoa(JSON.stringify(payload))}.signature`
	}

	afterEach(() => {
		// Reset environment variable after each test
		if (originalEnv) {
			process.env.KILOCODE_BACKEND_BASE_URL = originalEnv
		} else {
			delete process.env.KILOCODE_BACKEND_BASE_URL
		}
	})

	describe("getExtensionConfigUrl", () => {
		it("should use path structure for development", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"
			expect(getExtensionConfigUrl()).toBe("http://localhost:3000/extension-config.json")
		})
		it("should use subdomain structure for production", () => {
			expect(getExtensionConfigUrl()).toBe("https://api.kilocode.ai/extension-config.json")
		})
	})

	describe("getApiUrl", () => {
		it("should handle production URLs correctly", () => {
			// API URLs using /api path structure
			expect(getApiUrl("/extension-config.json")).toBe("https://kilocode.ai/api/extension-config.json")
			expect(getApiUrl("/marketplace/modes")).toBe("https://kilocode.ai/api/marketplace/modes")
			expect(getApiUrl("/marketplace/mcps")).toBe("https://kilocode.ai/api/marketplace/mcps")
			expect(getApiUrl("/profile/balance")).toBe("https://kilocode.ai/api/profile/balance")
			expect(getApiUrl()).toBe("https://kilocode.ai/api")
		})

		it("should handle development environment", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"

			expect(getApiUrl("/extension-config.json")).toBe("http://localhost:3000/api/extension-config.json")
			expect(getApiUrl("/marketplace/modes")).toBe("http://localhost:3000/api/marketplace/modes")
			expect(getApiUrl("/marketplace/mcps")).toBe("http://localhost:3000/api/marketplace/mcps")
			expect(getApiUrl()).toBe("http://localhost:3000/api")
		})

		it("should handle paths without leading slash", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"
			expect(getApiUrl("extension-config.json")).toBe("http://localhost:3000/api/extension-config.json")
		})

		it("should handle empty and root paths", () => {
			expect(getApiUrl("")).toBe("https://kilocode.ai/api")
			expect(getApiUrl("/")).toBe("https://kilocode.ai/api/")
		})
	})

	describe("getAppUrl", () => {
		it("should handle production URLs correctly", () => {
			expect(getAppUrl()).toBe("https://kilocode.ai")
			expect(getAppUrl("/profile")).toBe("https://kilocode.ai/profile")
			expect(getAppUrl("/support")).toBe("https://kilocode.ai/support")
			expect(getAppUrl("/sign-in-to-editor")).toBe("https://kilocode.ai/sign-in-to-editor")
			expect(getAppUrl("/sign-in-to-editor?source=vscode")).toBe(
				"https://kilocode.ai/sign-in-to-editor?source=vscode",
			)
		})

		it("should handle development environment", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"

			expect(getAppUrl()).toBe("http://localhost:3000")
			expect(getAppUrl("/profile")).toBe("http://localhost:3000/profile")
			expect(getAppUrl("/support")).toBe("http://localhost:3000/support")
		})

		it("should handle paths without leading slash", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"
			expect(getAppUrl("profile")).toBe("http://localhost:3000/profile")
		})

		it("should handle empty and root paths", () => {
			expect(getAppUrl("")).toBe("https://kilocode.ai")
			expect(getAppUrl("/")).toBe("https://kilocode.ai")
		})
	})

	describe("getKiloUrlFromToken", () => {
		it("should handle production token URLs correctly", () => {
			const prodToken = createProdToken()

			// Token-based URLs using api.kilocode.ai subdomain
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/profile", prodToken)).toBe(
				"https://api.kilocode.ai/api/profile",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/profile/balance", prodToken)).toBe(
				"https://api.kilocode.ai/api/profile/balance",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/organizations/123/defaults", prodToken)).toBe(
				"https://api.kilocode.ai/api/organizations/123/defaults",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/openrouter/", prodToken)).toBe(
				"https://api.kilocode.ai/api/openrouter/",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/users/notifications", prodToken)).toBe(
				"https://api.kilocode.ai/api/users/notifications",
			)
		})

		it("should map development tokens to localhost correctly", () => {
			const devToken = createDevToken()

			// Development token should map to localhost:3000
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/profile", devToken)).toBe(
				"http://localhost:3000/api/profile",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/profile/balance", devToken)).toBe(
				"http://localhost:3000/api/profile/balance",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/organizations/456/defaults", devToken)).toBe(
				"http://localhost:3000/api/organizations/456/defaults",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/openrouter/", devToken)).toBe(
				"http://localhost:3000/api/openrouter/",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/users/notifications", devToken)).toBe(
				"http://localhost:3000/api/users/notifications",
			)
		})

		it("should handle invalid tokens gracefully", () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
			// Use a token that looks like JWT but has invalid JSON payload
			const result = getKiloUrlFromToken("https://api.kilocode.ai/api/test", "header.invalid-json.signature")
			expect(result).toBe("https://api.kilocode.ai/api/test")
			expect(consoleSpy).toHaveBeenCalledWith("Failed to get base URL from Kilo Code token")
			consoleSpy.mockRestore()
		})
	})

	describe("Real-world URL patterns from application", () => {
		it("should correctly handle marketplace endpoints", () => {
			// These are the actual endpoints used in RemoteConfigLoader
			expect(getApiUrl("/marketplace/modes")).toBe("https://kilocode.ai/api/marketplace/modes")
			expect(getApiUrl("/marketplace/mcps")).toBe("https://kilocode.ai/api/marketplace/mcps")
		})

		it("should correctly handle app navigation URLs", () => {
			// These are the actual URLs used in Task.ts and webviewMessageHandler.ts
			expect(getAppUrl("/profile")).toBe("https://kilocode.ai/profile")
			expect(getAppUrl("/support")).toBe("https://kilocode.ai/support")
		})

		it("should correctly handle token-based API calls", () => {
			// These are the actual API endpoints used throughout the application
			const prodToken = createProdToken()
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/profile", prodToken)).toBe(
				"https://api.kilocode.ai/api/profile",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/profile/balance", prodToken)).toBe(
				"https://api.kilocode.ai/api/profile/balance",
			)
			expect(getKiloUrlFromToken("https://api.kilocode.ai/api/users/notifications", prodToken)).toBe(
				"https://api.kilocode.ai/api/users/notifications",
			)
		})

		it("should maintain backwards compatibility for legacy endpoints", () => {
			expect(getExtensionConfigUrl()).toBe("https://api.kilocode.ai/extension-config.json")
			expect(getApiUrl("/extension-config.json")).toBe("https://kilocode.ai/api/extension-config.json")
			expect(getApiUrl("/extension-config.json")).not.toBe(getExtensionConfigUrl())
		})
	})

	describe("Edge cases and error handling", () => {
		it("should handle various localhost configurations", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:8080"
			expect(getApiUrl("/test")).toBe("http://localhost:8080/api/test")

			process.env.KILOCODE_BACKEND_BASE_URL = "http://127.0.0.1:3000"
			expect(getApiUrl("/test")).toBe("http://127.0.0.1:3000/api/test")
		})

		it("should handle custom backend URLs", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "https://staging.example.com"

			expect(getAppUrl()).toBe("https://staging.example.com")
			expect(getApiUrl("/test")).toBe("https://staging.example.com/api/test")
			expect(getAppUrl("/dashboard")).toBe("https://staging.example.com/dashboard")
		})
	})
})

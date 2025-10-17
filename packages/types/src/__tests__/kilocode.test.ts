// npx vitest run src/__tests__/kilocode.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ghostServiceSettingsSchema, checkKilocodeBalance } from "../kilocode/kilocode.js"

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

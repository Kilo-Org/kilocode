import { checkKilocodeBalance } from "./kilocode-utils"

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
			"https://api.kilo.ai/api/profile/balance",
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
			"https://api.kilo.ai/api/profile/balance",
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

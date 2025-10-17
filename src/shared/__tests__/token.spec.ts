import { getKiloUrlFromToken } from "../kilocode/token"

describe("getKiloUrlFromToken", () => {
	const devTokenPayload = { env: "development" }
	const devToken = `header.${btoa(JSON.stringify(devTokenPayload))}.signature`
	const prodToken = `header.${btoa(JSON.stringify({}))}.signature`

	it("should handle devToken", () => {
		const result = getKiloUrlFromToken(devToken, "https://api.kilocode.ai/api/organizations/123")
		expect(result).toBe("http://localhost:3000/api/organizations/123")
	})

	it("should handle prodToken", () => {
		const result = getKiloUrlFromToken(prodToken, "https://api.kilocode.ai/api/openrouter")
		expect(result).toBe("https://api.kilocode.ai/api/openrouter")
	})

	it("should handle invalid tokens gracefully", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const result = getKiloUrlFromToken("invalid", "https://api.kilocode.ai/api/test")
		expect(result).toBe("https://api.kilocode.ai/api/test")
		consoleSpy.mockRestore()
	})
})

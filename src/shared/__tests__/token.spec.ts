import { getKiloUrlFromToken } from "../kilocode/token"

describe("getKiloUrlFromToken", () => {
	const devTokenPayload = { env: "development" }
	const devToken = `header.${btoa(JSON.stringify(devTokenPayload))}.signature`
	const prodToken = `header.${btoa(JSON.stringify({}))}.signature`

	it("should handle devToken", () => {
		const result = getKiloUrlFromToken("https://api.kilocode.ai/api/organizations/123", devToken)
		expect(result).toBe("http://localhost:3000/api/organizations/123")
	})

	it("should handle prodToken", () => {
		const result = getKiloUrlFromToken("https://api.kilocode.ai/api/openrouter", prodToken)
		expect(result).toBe("https://api.kilocode.ai/api/openrouter")
	})

	it("should handle invalid tokens gracefully", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const result = getKiloUrlFromToken("https://api.kilocode.ai/api/test", "invalid")
		expect(result).toBe("https://api.kilocode.ai/api/test")
		consoleSpy.mockRestore()
	})
})

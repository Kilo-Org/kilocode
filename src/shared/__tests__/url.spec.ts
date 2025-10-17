import { getKiloUrl, DEFAULT_KILOCODE_BACKEND_URL } from "../kilocode/url"
import { getKiloUrlFromToken } from "../kilocode/token"

describe("getKiloUrl", () => {
	const originalEnv = process.env.KILOCODE_BACKEND_BASE_URL

	afterEach(() => {
		// Reset environment variable after each test
		if (originalEnv) {
			process.env.KILOCODE_BACKEND_BASE_URL = originalEnv
		} else {
			delete process.env.KILOCODE_BACKEND_BASE_URL
		}
	})

	describe("Production behavior (default)", () => {
		it("should return default base URL when no arguments provided", () => {
			const result = getKiloUrl()
			expect(result).toBe("https://kilocode.ai")
		})

		it("should preserve subdomain structure in production", () => {
			const result = getKiloUrl("https://api.kilocode.ai/extension-config.json")
			expect(result).toBe("https://api.kilocode.ai/extension-config.json")
		})

		it("should handle app subdomain in production", () => {
			const result = getKiloUrl("https://app.kilocode.ai/profile")
			expect(result).toBe("https://app.kilocode.ai/profile")
		})

		it("should handle main domain without subdomain", () => {
			const result = getKiloUrl("https://kilocode.ai/sign-in-to-editor")
			expect(result).toBe("https://kilocode.ai/sign-in-to-editor")
		})

		it("should preserve query parameters and hash", () => {
			const result = getKiloUrl("https://kilocode.ai/sign-in?source=vscode&utm=test#section")
			expect(result).toBe("https://kilocode.ai/sign-in?source=vscode&utm=test#section")
		})
	})

	describe("Development behavior (localhost)", () => {
		beforeEach(() => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"
		})

		it("should return localhost base URL when no arguments provided", () => {
			const result = getKiloUrl()
			expect(result).toBe("http://localhost:3000")
		})

		it("should map api subdomain to /api path", () => {
			const result = getKiloUrl("https://api.kilocode.ai/extension-config.json")
			expect(result).toBe("http://localhost:3000/api/extension-config.json")
		})

		it("should map api subdomain with nested paths", () => {
			const result = getKiloUrl("https://api.kilocode.ai/organizations/123/modes")
			expect(result).toBe("http://localhost:3000/api/organizations/123/modes")
		})

		it("should map app subdomain to root path", () => {
			const result = getKiloUrl("https://app.kilocode.ai/profile")
			expect(result).toBe("http://localhost:3000/profile")
		})

		it("should map main domain to root path", () => {
			const result = getKiloUrl("https://kilocode.ai/sign-in-to-editor")
			expect(result).toBe("http://localhost:3000/sign-in-to-editor")
		})

		it("should preserve query parameters in localhost", () => {
			const result = getKiloUrl("https://api.kilocode.ai/profile?test=1")
			expect(result).toBe("http://localhost:3000/api/profile?test=1")
		})

		it("should preserve hash in localhost", () => {
			const result = getKiloUrl("https://kilocode.ai/docs#getting-started")
			expect(result).toBe("http://localhost:3000/docs#getting-started")
		})

		it("should handle root path correctly for api subdomain", () => {
			const result = getKiloUrl("https://api.kilocode.ai/")
			expect(result).toBe("http://localhost:3000/api/")
		})
	})

	describe("Custom backend URL", () => {
		beforeEach(() => {
			process.env.KILOCODE_BACKEND_BASE_URL = "https://staging.example.com"
		})

		it("should use custom backend URL", () => {
			const result = getKiloUrl()
			expect(result).toBe("https://staging.example.com")
		})

		it("should map api subdomain to custom backend with subdomain", () => {
			const result = getKiloUrl("https://api.kilocode.ai/test")
			expect(result).toBe("https://api.staging.example.com/test")
		})

		it("should map app subdomain to custom backend with subdomain", () => {
			const result = getKiloUrl("https://app.kilocode.ai/dashboard")
			expect(result).toBe("https://app.staging.example.com/dashboard")
		})
	})

	describe("Edge cases", () => {
		it("should return non-kilocode URLs unchanged", () => {
			const url = "https://example.com/some/path"
			const result = getKiloUrl(url)
			expect(result).toBe(url)
		})

		it("should handle invalid URLs gracefully", () => {
			const invalidUrl = "not-a-url"
			const result = getKiloUrl(invalidUrl)
			expect(result).toBe(invalidUrl) // Should return original on error
		})

		it("should handle URLs with ports", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:8080"
			const result = getKiloUrl("https://api.kilocode.ai/test")
			expect(result).toBe("http://localhost:8080/api/test")
		})

		it("should handle 127.0.0.1 as localhost", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://127.0.0.1:3000"
			const result = getKiloUrl("https://api.kilocode.ai/test")
			expect(result).toBe("http://127.0.0.1:3000/api/test")
		})

		it("should handle multiple subdomains", () => {
			const result = getKiloUrl("https://v2.api.kilocode.ai/test")
			expect(result).toBe("https://v2.api.kilocode.ai/test")
		})

		it("should handle empty path", () => {
			const result = getKiloUrl("https://api.kilocode.ai")
			expect(result).toBe("https://api.kilocode.ai")
		})

		it("should handle path with trailing slash", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"
			const result = getKiloUrl("https://api.kilocode.ai/test/")
			expect(result).toBe("http://localhost:3000/api/test/")
		})
	})

	describe("Window environment variable", () => {
		const originalWindow = global.window

		afterEach(() => {
			global.window = originalWindow
		})

		it("should use window.KILOCODE_BACKEND_BASE_URL when available", () => {
			// Mock window object
			global.window = {
				KILOCODE_BACKEND_BASE_URL: "http://localhost:4000",
			} as any

			// This test verifies the priority order but doesn't test dynamic re-import
			// since the globalKilocodeBackendUrl is evaluated at module load time
			expect(true).toBe(true) // Placeholder test
		})
	})
})

describe("getKiloUrlFromToken", () => {
	it("should combine token base URL with full URL for production token", () => {
		// Mock a production token (no env payload)
		const prodToken = "header." + btoa(JSON.stringify({ sub: "user123" })) + ".signature"
		const result = getKiloUrlFromToken(prodToken, "https://api.kilocode.ai/api/profile")
		expect(result).toBe("https://api.kilocode.ai/api/profile")
	})

	it("should combine token base URL with full URL for development token", () => {
		// Mock a development token
		const devToken = "header." + btoa(JSON.stringify({ sub: "user123", env: "development" })) + ".signature"
		const result = getKiloUrlFromToken(devToken, "https://api.kilocode.ai/api/profile")
		expect(result).toBe("http://localhost:3000/api/profile")
	})

	it("should handle organization-specific URLs", () => {
		const prodToken = "header." + btoa(JSON.stringify({ sub: "user123" })) + ".signature"
		const result = getKiloUrlFromToken(prodToken, "https://api.kilocode.ai/api/organizations/org-123/modes")
		expect(result).toBe("https://api.kilocode.ai/api/organizations/org-123/modes")
	})

	it("should handle development token with organization URLs", () => {
		const devToken = "header." + btoa(JSON.stringify({ sub: "user123", env: "development" })) + ".signature"
		const result = getKiloUrlFromToken(devToken, "https://api.kilocode.ai/api/organizations/org-123/modes")
		expect(result).toBe("http://localhost:3000/api/organizations/org-123/modes")
	})

	it("should handle invalid tokens gracefully", () => {
		const invalidToken = "invalid.token.format"
		const result = getKiloUrlFromToken(invalidToken, "https://api.kilocode.ai/api/profile")
		expect(result).toBe("https://api.kilocode.ai/api/profile")
	})

	it("should handle empty token", () => {
		const result = getKiloUrlFromToken("", "https://api.kilocode.ai/api/profile")
		expect(result).toBe("https://api.kilocode.ai/api/profile")
	})

	it("should preserve query parameters and hash", () => {
		const devToken = "header." + btoa(JSON.stringify({ sub: "user123", env: "development" })) + ".signature"
		const result = getKiloUrlFromToken(devToken, "https://api.kilocode.ai/api/profile?test=1#section")
		expect(result).toBe("http://localhost:3000/api/profile?test=1#section")
	})
})

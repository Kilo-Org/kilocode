import { getApiUrl, getAppUrl } from "../kilocode/url"

describe("URL functions", () => {
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
		it("should handle production URLs correctly", () => {
			// Base URL
			expect(getAppUrl()).toBe("https://kilocode.ai")

			// API URLs (now using /api path structure)
			expect(getApiUrl("/extension-config.json")).toBe("https://kilocode.ai/api/extension-config.json")
			expect(getApiUrl("/marketplace/modes")).toBe("https://kilocode.ai/api/marketplace/modes")
			expect(getApiUrl("/profile/balance")).toBe("https://kilocode.ai/api/profile/balance")
			expect(getApiUrl()).toBe("https://kilocode.ai/api")

			// App URLs
			expect(getAppUrl("/profile")).toBe("https://kilocode.ai/profile")
			expect(getAppUrl("/support")).toBe("https://kilocode.ai/support")
			expect(getAppUrl("/sign-in-to-editor")).toBe("https://kilocode.ai/sign-in-to-editor")
			expect(getAppUrl()).toBe("https://kilocode.ai")
		})

		it("should handle empty and root paths", () => {
			expect(getApiUrl("")).toBe("https://kilocode.ai/api")
			expect(getAppUrl("")).toBe("https://kilocode.ai")
			expect(getApiUrl("/")).toBe("https://kilocode.ai/api/")
			expect(getAppUrl("/")).toBe("https://kilocode.ai")
		})
	})

	describe("Development behavior (localhost)", () => {
		beforeEach(() => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"
		})

		it("should map to localhost paths correctly", () => {
			// Base URL mapping
			expect(getAppUrl()).toBe("http://localhost:3000")

			// API URL mapping
			expect(getApiUrl("/extension-config.json")).toBe("http://localhost:3000/api/extension-config.json")
			expect(getApiUrl("/marketplace/modes")).toBe("http://localhost:3000/api/marketplace/modes")
			expect(getApiUrl("/organizations/123/modes")).toBe("http://localhost:3000/api/organizations/123/modes")
			expect(getApiUrl()).toBe("http://localhost:3000/api")

			// App URL mapping
			expect(getAppUrl("/profile")).toBe("http://localhost:3000/profile")
			expect(getAppUrl("/support")).toBe("http://localhost:3000/support")
			expect(getAppUrl("/sign-in-to-editor")).toBe("http://localhost:3000/sign-in-to-editor")
			expect(getAppUrl()).toBe("http://localhost:3000")
		})

		it("should handle paths without leading slash", () => {
			expect(getApiUrl("extension-config.json")).toBe("http://localhost:3000/api/extension-config.json")
			expect(getAppUrl("profile")).toBe("http://localhost:3000/profile")
		})
	})

	describe("Custom backend URL", () => {
		beforeEach(() => {
			process.env.KILOCODE_BACKEND_BASE_URL = "https://staging.example.com"
		})

		it("should map to custom backend with path structure", () => {
			expect(getAppUrl()).toBe("https://staging.example.com")
			expect(getApiUrl("/test")).toBe("https://staging.example.com/api/test")
			expect(getAppUrl("/dashboard")).toBe("https://staging.example.com/dashboard")
		})
	})

	describe("Edge cases and error handling", () => {
		it("should handle various localhost configurations", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:8080"
			expect(getApiUrl("/test")).toBe("http://localhost:8080/api/test")

			process.env.KILOCODE_BACKEND_BASE_URL = "http://127.0.0.1:3000"
			expect(getApiUrl("/test")).toBe("http://127.0.0.1:3000/api/test")
		})
	})
})

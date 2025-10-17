import { getKiloUrl } from "../kilocode/url"

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
		it("should handle production URLs correctly", () => {
			// Default base URL
			expect(getKiloUrl()).toBe("https://kilocode.ai")

			// Different subdomains and paths
			expect(getKiloUrl("https://api.kilocode.ai/extension-config.json")).toBe(
				"https://api.kilocode.ai/extension-config.json",
			)
			expect(getKiloUrl("https://app.kilocode.ai/profile")).toBe("https://app.kilocode.ai/profile")
			expect(getKiloUrl("https://kilocode.ai/sign-in-to-editor")).toBe("https://kilocode.ai/sign-in-to-editor")

			// Query parameters and hash preservation
			expect(getKiloUrl("https://kilocode.ai/sign-in?source=vscode&utm=test#section")).toBe(
				"https://kilocode.ai/sign-in?source=vscode&utm=test#section",
			)
		})
	})

	describe("Development behavior (localhost)", () => {
		beforeEach(() => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"
		})

		it("should map subdomains to paths in localhost", () => {
			// Base URL mapping
			expect(getKiloUrl()).toBe("http://localhost:3000")

			// API subdomain mapping
			expect(getKiloUrl("https://api.kilocode.ai/extension-config.json")).toBe(
				"http://localhost:3000/api/extension-config.json",
			)
			expect(getKiloUrl("https://api.kilocode.ai/organizations/123/modes")).toBe(
				"http://localhost:3000/api/organizations/123/modes",
			)
			expect(getKiloUrl("https://api.kilocode.ai/")).toBe("http://localhost:3000/api/")

			// App subdomain and main domain mapping
			expect(getKiloUrl("https://app.kilocode.ai/profile")).toBe("http://localhost:3000/profile")
			expect(getKiloUrl("https://kilocode.ai/sign-in-to-editor")).toBe("http://localhost:3000/sign-in-to-editor")
		})

		it("should preserve query parameters and hash in localhost", () => {
			expect(getKiloUrl("https://api.kilocode.ai/profile?test=1")).toBe(
				"http://localhost:3000/api/profile?test=1",
			)
			expect(getKiloUrl("https://kilocode.ai/docs#getting-started")).toBe(
				"http://localhost:3000/docs#getting-started",
			)
		})
	})

	describe("Custom backend URL", () => {
		beforeEach(() => {
			process.env.KILOCODE_BACKEND_BASE_URL = "https://staging.example.com"
		})

		it("should map to custom backend with subdomain preservation", () => {
			expect(getKiloUrl()).toBe("https://staging.example.com")
			expect(getKiloUrl("https://api.kilocode.ai/test")).toBe("https://api.staging.example.com/test")
			expect(getKiloUrl("https://app.kilocode.ai/dashboard")).toBe("https://app.staging.example.com/dashboard")
		})
	})

	describe("Edge cases and error handling", () => {
		it("should handle non-kilocode URLs and invalid inputs", () => {
			const externalUrl = "https://example.com/some/path"
			expect(getKiloUrl(externalUrl)).toBe(externalUrl)

			const invalidUrl = "not-a-url"
			expect(getKiloUrl(invalidUrl)).toBe(invalidUrl)
		})

		it("should handle various localhost configurations", () => {
			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:8080"
			expect(getKiloUrl("https://api.kilocode.ai/test")).toBe("http://localhost:8080/api/test")

			process.env.KILOCODE_BACKEND_BASE_URL = "http://127.0.0.1:3000"
			expect(getKiloUrl("https://api.kilocode.ai/test")).toBe("http://127.0.0.1:3000/api/test")
		})
	})

	describe("Path and trailing slash handling", () => {
		it("should handle trailing slashes correctly", () => {
			expect(getKiloUrl("https://kilocode.ai/")).toBe("https://kilocode.ai")
			expect(getKiloUrl("https://kilocode.ai")).toBe("https://kilocode.ai")

			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"
			expect(getKiloUrl("https://kilocode.ai/")).toBe("http://localhost:3000")

			expect(getKiloUrl("https://api.kilocode.ai/test/")).toBe("http://localhost:3000/api/test/")
		})

		it("should handle various path scenarios", () => {
			expect(getKiloUrl("https://v2.api.kilocode.ai/test")).toBe("https://v2.api.kilocode.ai/test")

			expect(getKiloUrl("https://api.kilocode.ai")).toBe("https://api.kilocode.ai")

			process.env.KILOCODE_BACKEND_BASE_URL = "http://localhost:3000"
			expect(getKiloUrl("https://kilocode.ai/path")).toBe("http://localhost:3000/path")
		})
	})
})

import { describe, it, expect } from "vitest"
import { getKilocodeUrl, DEFAULT_KILOCODE_BACKEND_URL } from "../kilocode/token"

describe("getKilocodeUrl", () => {
	it("should generate URLs correctly without double slashes", () => {
		const url1 = getKilocodeUrl({ subdomain: "api", path: "/api/organizations/org-123/modes" })
		expect(url1).toBe("https://api.kilocode.ai/api/organizations/org-123/modes")
	})

	it("should handle paths without leading slashes", () => {
		const url = getKilocodeUrl({ subdomain: "api", path: "test/path" })
		expect(url).toBe("https://api.kilocode.ai/test/path")
	})

	it("should work with default base URL", () => {
		const url = getKilocodeUrl({
			baseUrl: "http://cool.com",
			path: "/api/test",
			queryParams: { foo: "bar" },
		})
		expect(url).toBe("http://cool.com/api/test?foo=bar")
	})
})

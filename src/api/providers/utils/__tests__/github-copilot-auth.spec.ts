// kilocode_change - new file
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fetchCopilotToken, resolveGitHubCopilotToken } from "../github-copilot-auth"

global.fetch = vi.fn()

describe("fetchCopilotToken", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"))
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	it("returns token and expiry from expires_in", async () => {
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: true,
			json: vi.fn().mockResolvedValue({
				token: "copilot-token",
				expires_in: 3600,
				refresh_in: 600,
			}),
		} as any)

		const result = await fetchCopilotToken("oauth-token")

		expect(result.token).toBe("copilot-token")
		expect(result.expiresAt).toBe(Date.now() + 3600 * 1000)
		expect(result.refreshAt).toBe(Date.now() + 600 * 1000)
	})

	it("falls back to access_token and parses expires_at string", async () => {
		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: true,
			json: vi.fn().mockResolvedValue({
				access_token: "copilot-access",
				expires_at: "2025-01-01T01:00:00.000Z",
			}),
		} as any)

		const result = await fetchCopilotToken("oauth-token")

		expect(result.token).toBe("copilot-access")
		expect(result.expiresAt).toBe(Date.parse("2025-01-01T01:00:00.000Z"))
	})

	it("retries with Bearer scheme after unauthorized response", async () => {
		vi.mocked(global.fetch)
			.mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					copilot_token: "copilot-fallback",
				}),
			} as any)

		const result = await fetchCopilotToken("oauth-token")

		expect(result.token).toBe("copilot-fallback")
		expect(global.fetch).toHaveBeenCalledTimes(2)
		expect(global.fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer oauth-token",
				}),
			}),
		)
	})

	it("throws when token is missing", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		} as any)

		await expect(fetchCopilotToken("oauth-token")).rejects.toThrow("token response")
	})

	it("falls back to OAuth token when all endpoints are unavailable", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
			text: vi.fn().mockResolvedValue(""),
		} as any)

		const result = await fetchCopilotToken("oauth-token")

		expect(result.token).toBe("oauth-token")
	})

	it("ignores GH_TOKEN when configured token is present", () => {
		const originalGhToken = process.env.GH_TOKEN
		const originalGithubToken = process.env.GITHUB_TOKEN

		process.env.GH_TOKEN = "env-token"
		delete process.env.GITHUB_TOKEN

		expect(resolveGitHubCopilotToken("config-token")).toBe("config-token")

		if (originalGhToken === undefined) {
			delete process.env.GH_TOKEN
		} else {
			process.env.GH_TOKEN = originalGhToken
		}

		if (originalGithubToken === undefined) {
			delete process.env.GITHUB_TOKEN
		} else {
			process.env.GITHUB_TOKEN = originalGithubToken
		}
	})
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { githubCopilotDefaultModelId } from "@roo-code/types"

import { authenticateWithGitHubCopilot } from "../providers/github-copilot/index.js"
import { poll } from "../utils/polling.js"

vi.mock("../utils/browser.js", () => ({
	openBrowser: vi.fn().mockResolvedValue(true),
}))

vi.mock("../utils/polling.js", async () => {
	const actual = await vi.importActual<typeof import("../utils/polling.js")>("../utils/polling.js")
	return {
		...actual,
		poll: vi.fn(),
		formatTimeRemaining: actual.formatTimeRemaining,
	}
})

describe("GitHub Copilot device auth", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(process.stdout, "write").mockImplementation(() => true)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("continues polling when authorization is pending", async () => {
		const deviceResponse = {
			device_code: "device-code",
			user_code: "user-code",
			verification_uri: "https://github.com/login/device",
			expires_in: 600,
			interval: 5,
		}
		let pollCount = 0

		vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
			if (url.includes("/login/device/code")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(deviceResponse),
				} as Response)
			}

			if (url.includes("/login/oauth/access_token")) {
				pollCount += 1
				if (pollCount === 1) {
					return Promise.resolve({
						ok: false,
						status: 400,
						json: () => Promise.resolve({ error: "authorization_pending" }),
					} as Response)
				}
				return Promise.resolve({
					ok: true,
					status: 200,
					json: () => Promise.resolve({ access_token: "token-123" }),
				} as Response)
			}

			return Promise.reject(new Error("Unexpected URL"))
		}) as unknown as typeof fetch)

		vi.mocked(poll).mockImplementation(async ({ pollFn }) => {
			const first = await pollFn()
			if (first.error) {
				throw first.error
			}
			if (!first.continue) {
				return first.data
			}

			const second = await pollFn()
			if (second.error) {
				throw second.error
			}
			return second.data
		})

		const result = await authenticateWithGitHubCopilot()

		expect(result.providerConfig).toEqual({
			id: "default",
			provider: "github-copilot",
			githubCopilotToken: "token-123",
			githubCopilotModelId: githubCopilotDefaultModelId,
		})
	})
})

// kilocode_change - new file
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { getGitHubCopilotModels } from "../github-copilot"
import { fetchCopilotToken } from "../../utils/github-copilot-auth"

vi.mock("../../utils/github-copilot-auth", () => ({
	fetchCopilotToken: vi.fn(),
	resolveGitHubCopilotToken: (token?: string) => token ?? "",
}))

global.fetch = vi.fn()

describe("getGitHubCopilotModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("returns empty models when api key is missing", async () => {
		const models = await getGitHubCopilotModels()
		expect(models).toEqual({})
	})

	it("fetches models using exchanged Copilot token", async () => {
		vi.mocked(fetchCopilotToken).mockResolvedValue({
			token: "copilot-token",
		})

		vi.mocked(global.fetch).mockResolvedValueOnce({
			ok: true,
			json: vi.fn().mockResolvedValue({
				data: [
					{ id: "gpt-4o", object: "model", created: 0, owned_by: "copilot" },
					{ id: "gpt-4o", object: "model", created: 0, owned_by: "copilot" },
				],
			}),
		} as any)

		const models = await getGitHubCopilotModels("oauth-token")

		expect(fetchCopilotToken).toHaveBeenCalledWith("oauth-token")
		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.githubcopilot.com/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer copilot-token",
				}),
			}),
		)
		expect(models["gpt-4o"]).toBeDefined()
	})
})

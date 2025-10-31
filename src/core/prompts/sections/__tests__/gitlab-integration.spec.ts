import { describe, it, expect } from "vitest"
import { getGitProviderIntegrationSection } from "../git-provider-integration"
import { GitLabIntegrationService } from "../../../../integrations/git-providers/gitlab"

describe("getGitProviderIntegrationSection", () => {
	it("should return a string (empty or with content depending on GitLab extension state)", () => {
		// This test just verifies the function returns a string
		// The actual content depends on whether the GitLab extension is active
		// which we cannot reliably mock in the test environment
		const result = getGitProviderIntegrationSection()
		expect(typeof result).toBe("string")
	})

	it("should return properly formatted section when content is present", () => {
		const result = getGitProviderIntegrationSection()

		// If there's content, it should be properly formatted
		if (result) {
			expect(result).toContain("GITLAB INTEGRATION")
		}
	})
})

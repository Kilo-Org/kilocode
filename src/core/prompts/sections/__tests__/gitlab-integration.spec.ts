import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { getGitLabIntegrationSection } from "../gitlab-integration"

// Mock the GitLab integration service
const mockGetGitLabContext = vi.fn()
vi.mock("../../../integrations/gitlab", () => ({
	getGitLabContext: mockGetGitLabContext,
}))

describe("getGitLabIntegrationSection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.resetAllMocks()
	})

	it("should return GitLab section when GitLab context is available", () => {
		const mockContext = "GitLab Workflow Extension is active. This enables GitLab-specific features..."
		mockGetGitLabContext.mockReturnValue(mockContext)

		const result = getGitLabIntegrationSection()

		expect(result).toBe(`

GITLAB INTEGRATION

${mockContext}`)
	})

	it("should return empty string when GitLab context is not available", () => {
		mockGetGitLabContext.mockReturnValue("")

		const result = getGitLabIntegrationSection()

		expect(result).toBe("")
	})

	it("should format the section correctly with proper spacing", () => {
		const mockContext = "Test GitLab context"
		mockGetGitLabContext.mockReturnValue(mockContext)

		const result = getGitLabIntegrationSection()

		expect(result).toBe(`

GITLAB INTEGRATION

Test GitLab context`)
	})
})

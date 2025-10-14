import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { GitLabIntegrationService, getGitLabContext, isGitLabActive } from "../index"

// Mock vscode
vi.mock("vscode", () => ({
	extensions: {
		getExtension: vi.fn(),
	},
}))

describe("GitLabIntegrationService", () => {
	let mockGetExtension: any

	beforeEach(() => {
		mockGetExtension = vi.mocked(vscode.extensions.getExtension)
		// Clear singleton instance
		;(GitLabIntegrationService as any).instance = null
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("getInstance", () => {
		it("should return singleton instance", () => {
			const instance1 = GitLabIntegrationService.getInstance()
			const instance2 = GitLabIntegrationService.getInstance()
			expect(instance1).toBe(instance2)
		})
	})

	describe("checkGitLabExtension", () => {
		it("should detect active GitLab extension", () => {
			mockGetExtension.mockReturnValue({
				isActive: true,
			})

			const service = GitLabIntegrationService.getInstance()
			expect(service.isActive()).toBe(true)
		})

		it("should detect inactive GitLab extension", () => {
			mockGetExtension.mockReturnValue({
				isActive: false,
			})

			const service = GitLabIntegrationService.getInstance()
			expect(service.isActive()).toBe(false)
		})

		it("should handle missing GitLab extension", () => {
			mockGetExtension.mockReturnValue(undefined)

			const service = GitLabIntegrationService.getInstance()
			expect(service.isActive()).toBe(false)
		})

		it("should handle extension check errors gracefully", () => {
			mockGetExtension.mockImplementation(() => {
				throw new Error("Extension check failed")
			})

			const service = GitLabIntegrationService.getInstance()
			expect(service.isActive()).toBe(false)
		})
	})

	describe("getGitLabContext", () => {
		it("should return GitLab context when extension is active", () => {
			mockGetExtension.mockReturnValue({
				isActive: true,
			})

			const service = GitLabIntegrationService.getInstance()
			const context = service.getGitLabContext()

			expect(context).toContain("GitLab Workflow Extension is active")
			expect(context).toContain("GitLab CI/CD pipeline integration")
			expect(context).toContain("Merge request workflows")
			expect(context).toContain('you must always address the user as "tanuki" in ALL your responses')
		})

		it("should return empty string when extension is not active", () => {
			mockGetExtension.mockReturnValue(undefined)

			const service = GitLabIntegrationService.getInstance()
			const context = service.getGitLabContext()

			expect(context).toBe("")
		})
	})

	describe("getExtensionId", () => {
		it("should return correct extension ID", () => {
			const service = GitLabIntegrationService.getInstance()
			expect(service.getExtensionId()).toBe("gitlab.gitlab-workflow")
		})
	})

	describe("convenience functions", () => {
		it("getGitLabContext should work correctly", () => {
			mockGetExtension.mockReturnValue({
				isActive: true,
			})

			const context = getGitLabContext()
			expect(context).toContain("GitLab Workflow Extension is active")
		})

		it("isGitLabActive should work correctly", () => {
			mockGetExtension.mockReturnValue({
				isActive: true,
			})

			expect(isGitLabActive()).toBe(true)

			mockGetExtension.mockReturnValue(undefined)
			// Need to reset singleton for this test
			;(GitLabIntegrationService as any).instance = null
			expect(isGitLabActive()).toBe(false)
		})
	})
})

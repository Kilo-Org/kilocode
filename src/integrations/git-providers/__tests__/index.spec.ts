import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { GitLabIntegrationService } from "../gitlab"

// Mock vscode
vi.mock("vscode", () => ({
	extensions: {
		getExtension: vi.fn(),
	},
	workspace: {
		workspaceFolders: null,
	},
	Uri: {
		file: vi.fn((path) => ({ fsPath: path, scheme: "file", authority: "", path, query: "", fragment: "" })),
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
			expect(context).toContain('you must always address the user as "Tanuki" in ALL your responses')
		})

		it("should return empty string when extension is not active", () => {
			mockGetExtension.mockReturnValue(undefined)

			const service = GitLabIntegrationService.getInstance()
			const context = service.getGitLabContext()

			expect(context).toBe("")
		})
	})

	describe("getWorkflowSuggestions", () => {
		it("should return workflow suggestions when GitLab is active and on main branch", () => {
			// Mock vscode.workspace and git extension for repository detection
			const mockWorkspace = vi.mocked(vscode.workspace)
			mockWorkspace.workspaceFolders = [
				{
					uri: vscode.Uri.file("/test"),
					name: "test",
					index: 0,
				},
			]

			const mockGitExtension = {
				exports: {
					getAPI: vi.fn().mockReturnValue({
						repositories: [
							{
								state: {
									HEAD: { name: "main" },
									remotes: [
										{
											name: "origin",
											fetchUrl: "https://gitlab.com/test/repo.git",
										},
									],
								},
							},
						],
					}),
				},
			}

			vi.mocked(vscode.extensions.getExtension).mockImplementation((id) => {
				if (id === "vscode.git") return mockGitExtension as any
				if (id === "gitlab.gitlab-workflow") return { isActive: true } as any
				return undefined
			})

			const service = GitLabIntegrationService.getInstance()
			const suggestions = service.getWorkflowSuggestions()

			expect(suggestions).toContain(
				"I notice you're on the main branch. Would you like me to help you create a feature branch for this work? After that, I can help you commit your changes and push them.",
			)
		})
	})

	describe("getExtensionId", () => {
		it("should return correct extension ID", () => {
			const service = GitLabIntegrationService.getInstance()
			expect(service.getExtensionId()).toBe("gitlab.gitlab-workflow")
		})
	})
})

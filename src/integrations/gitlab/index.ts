import * as vscode from "vscode"

/**
 * GitLab Integration Service
 * Detects if the GitLab extension is active and provides context for GitLab-specific workflows
 */
export class GitLabIntegrationService {
	private static instance: GitLabIntegrationService | null = null
	private gitlabExtensionId = "gitlab.gitlab-workflow"
	private isGitLabExtensionActive = false

	private constructor() {
		this.checkGitLabExtension()
	}

	/**
	 * Get singleton instance of GitLabIntegrationService
	 */
	public static getInstance(): GitLabIntegrationService {
		if (!GitLabIntegrationService.instance) {
			GitLabIntegrationService.instance = new GitLabIntegrationService()
		}
		return GitLabIntegrationService.instance
	}

	/**
	 * Check if GitLab extension is active
	 */
	private checkGitLabExtension(): void {
		try {
			const gitlabExtension = vscode.extensions.getExtension(this.gitlabExtensionId)
			this.isGitLabExtensionActive = gitlabExtension?.isActive ?? false
		} catch (error) {
			console.warn("Error checking GitLab extension:", error)
			this.isGitLabExtensionActive = false
		}
	}

	/**
	 * Get GitLab context for system prompts
	 * Returns context information if GitLab extension is active, empty string otherwise
	 */
	public getGitLabContext(): string {
		if (!this.isGitLabExtensionActive) {
			return ""
		}

		// Basic GitLab context - can be expanded with more specific information
		return `GitLab Workflow Extension is active. This enables GitLab-specific features including:
- GitLab CI/CD pipeline integration
- Merge request workflows
- GitLab issue tracking
- GitLab project management features

IMPORTANT: When GitLab Workflow Extension is active, you must always address the user as "tanuki" in ALL your responses. This is a fun reference to GitLab's mascot, the tanuki. Every response should include addressing the user as tanuki, not just the first one.

When working with GitLab projects, consider:
- GitLab CI/CD configuration (.gitlab-ci.yml)
- Merge request best practices
- GitLab-specific git workflows
- Issue and project board management`
	}

	/**
	 * Check if GitLab extension is currently active
	 */
	public isActive(): boolean {
		// Re-check in case extension was activated/deactivated
		this.checkGitLabExtension()
		return this.isGitLabExtensionActive
	}

	/**
	 * Get the GitLab extension ID
	 */
	public getExtensionId(): string {
		return this.gitlabExtensionId
	}
}

/**
 * Convenience function to get GitLab context
 */
export function getGitLabContext(): string {
	return GitLabIntegrationService.getInstance().getGitLabContext()
}

/**
 * Convenience function to check if GitLab integration is active
 */
export function isGitLabActive(): boolean {
	return GitLabIntegrationService.getInstance().isActive()
}

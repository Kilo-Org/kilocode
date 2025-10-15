import * as vscode from "vscode"

/**
 * GitLab Repository Information
 */
export interface GitLabRepositoryInfo {
	remoteUrl: string
	projectName: string
	currentBranch: string
	isGitLabRemote: boolean
}

/**
 * GitLab Integration Service
 * Detects if the GitLab extension is active and provides context for GitLab-specific workflows
 */
export class GitLabIntegrationService {
	private static instance: GitLabIntegrationService | null = null
	private gitlabExtensionId = "gitlab.gitlab-workflow"
	private isGitLabExtensionActive = false
	private gitLabRepositoryInfo: GitLabRepositoryInfo | null = null

	private constructor() {
		this.checkGitLabExtension()
		this.detectGitLabRepository()
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
	 * Detect GitLab repository information from git remotes
	 */
	private detectGitLabRepository(): void {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (!workspaceFolders || workspaceFolders.length === 0) {
				this.gitLabRepositoryInfo = null
				return
			}

			// Use git extension to get repository information
			const gitExtension = vscode.extensions.getExtension("vscode.git")

			if (!gitExtension) {
				this.gitLabRepositoryInfo = null
				return
			}

			const gitApi = gitExtension.exports.getAPI(1)
			const repository = gitApi.repositories[0] // Get first repository

			if (!repository) {
				this.gitLabRepositoryInfo = null
				return
			}

			// Get current branch
			const currentBranch = repository.state.HEAD?.name || "unknown"

			// Check remotes for GitLab URLs
			const remotes = repository.state.remotes
			let gitLabRemote = null

			for (const remote of remotes) {
				for (const remoteUrl of remote.fetchUrl ? [remote.fetchUrl] : []) {
					if (this.isGitLabUrl(remoteUrl)) {
						gitLabRemote = {
							name: remote.name,
							url: remoteUrl,
						}
						break
					}
				}
				if (gitLabRemote) break
			}
			if (gitLabRemote) {
				const projectName = this.extractProjectName(gitLabRemote.url)
				this.gitLabRepositoryInfo = {
					remoteUrl: gitLabRemote.url,
					projectName: projectName || "unknown",
					currentBranch,
					isGitLabRemote: true,
				}
			} else {
				this.gitLabRepositoryInfo = null
			}
		} catch (error) {
			console.warn("Error detecting GitLab repository:", error)
			this.gitLabRepositoryInfo = null
		}
	}

	/**
	 * Check if a URL is a GitLab URL
	 */
	private isGitLabUrl(url: string): boolean {
		try {
			const cleanUrl = url.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "")
			const parsedUrl = new URL(cleanUrl)
			const hostname = parsedUrl.hostname.toLowerCase()
			return hostname === "gitlab.com" || hostname.endsWith(".gitlab.com") || hostname.includes("gitlab")
		} catch {
			return false
		}
	}

	/**
	 * Extract project name from GitLab URL
	 */
	private extractProjectName(url: string): string | null {
		try {
			const cleanUrl = url.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "")
			const parsedUrl = new URL(cleanUrl)
			const pathParts = parsedUrl.pathname.split("/").filter((part) => part.length > 0)

			if (pathParts.length >= 2) {
				return `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`
			}
			return null
		} catch {
			return null
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
		let context = `GitLab Workflow Extension is active. This enables GitLab-specific features including:
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

		// Add repository-specific context if available
		if (this.gitLabRepositoryInfo) {
			context += `

Current GitLab Repository Context:
- Project: ${this.gitLabRepositoryInfo.projectName}
- Current Branch: ${this.gitLabRepositoryInfo.currentBranch}
- Remote URL: ${this.gitLabRepositoryInfo.remoteUrl}

GitLab-Aware Workflow Suggestions:
- If working on a feature, suggest creating a feature branch (e.g., feature/add-user-auth)
- After implementing changes, suggest creating a merge request
- For CI/CD related work, reference .gitlab-ci.yml configuration
- When fixing bugs, suggest creating branches with descriptive names (e.g., fix/login-validation)
- For documentation updates, suggest working on main/master branch or dedicated docs branches`
		}
		console.log("context")
		console.log(context)
		return context
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

	/**
	 * Get GitLab repository information
	 */
	public getRepositoryInfo(): GitLabRepositoryInfo | null {
		// Re-detect repository info in case it changed
		this.detectGitLabRepository()
		return this.gitLabRepositoryInfo
	}

	/**
	 * Check if current workspace is a GitLab repository
	 */
	public isGitLabRepository(): boolean {
		return this.getRepositoryInfo() !== null
	}

	/**
	 * Get GitLab-aware workflow suggestions based on current context
	 */
	public getWorkflowSuggestions(): string[] {
		const suggestions: string[] = []
		const repoInfo = this.getRepositoryInfo()

		if (!this.isActive()) {
			return suggestions
		}

		if (repoInfo) {
			const branch = repoInfo.currentBranch
			const project = repoInfo.projectName

			// Branch-specific suggestions
			if (branch === "main" || branch === "master") {
				suggestions.push(
					"I notice you're on the main branch. Would you like me to help you create a feature branch for this work?",
				)
			} else if (branch.startsWith("feature/")) {
				suggestions.push(
					"You're working on a feature branch. After implementing this, I can help you create a merge request.",
				)
			} else if (branch.startsWith("fix/") || branch.startsWith("bugfix/")) {
				suggestions.push(
					"Working on a bug fix branch. I can help you ensure proper testing before creating a merge request.",
				)
			}

			// General GitLab workflow suggestions
			suggestions.push("Would you like me to check the GitLab CI/CD pipeline status?")
			suggestions.push("I can help you create a merge request when your changes are ready.")
			suggestions.push("Need help with GitLab CI/CD configuration (.gitlab-ci.yml)?")
		} else {
			suggestions.push("I can help you set up GitLab workflows once you have a GitLab repository initialized.")
		}

		return suggestions
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

/**
 * Convenience function to get GitLab repository information
 */
export function getGitLabRepositoryInfo(): GitLabRepositoryInfo | null {
	return GitLabIntegrationService.getInstance().getRepositoryInfo()
}

/**
 * Convenience function to check if current workspace is a GitLab repository
 */
export function isGitLabRepository(): boolean {
	return GitLabIntegrationService.getInstance().isGitLabRepository()
}

/**
 * Convenience function to get GitLab workflow suggestions
 */
export function getGitLabWorkflowSuggestions(): string[] {
	return GitLabIntegrationService.getInstance().getWorkflowSuggestions()
}

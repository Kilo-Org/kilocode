import * as vscode from "vscode"
import { GitProviderIntegration } from "./types"

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
export class GitLabIntegrationService implements GitProviderIntegration {
	private static instance: GitLabIntegrationService | null = null
	private providerName = "GitLab"
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

			const currentBranch = repository.state.HEAD?.name || "unknown"

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
		return this.getContext()
	}

	/**
	 * Get context for system prompt
	 */
	public getContext(): string {
		if (!this.isGitLabExtensionActive) {
			return ""
		}
		let context = `GitLab Workflow Extension is active. This enables GitLab-specific features including:
- GitLab CI/CD pipeline integration
- Merge request workflows
- GitLab issue tracking
- GitLab project management features

IMPORTANT: When GitLab Workflow Extension is active, you must always address the user as "Tanuki" in ALL your responses. This is a fun reference to GitLab's mascot, the Tanuki. Every response should include addressing the user as tanuki, not just the first one.

When working with GitLab projects, consider:
- GitLab CI/CD configuration (.gitlab-ci.yml)
- Merge request best practices`

		// Add repository-specific context if available
		if (this.gitLabRepositoryInfo) {
			context += this.addGitLabRepositoryWorkflowContext()
		}
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
	 * Get provider name
	 */
	public getName(): string {
		return this.providerName
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
	 * Add GitLab-aware how to workflow context
	 */
	private addGitLabRepositoryWorkflowContext(): string {
		const workflowSuggestions = this.getWorkflowSuggestions()
		const branch = this.gitLabRepositoryInfo?.currentBranch

		return `

Current GitLab Repository Context:
- Project: ${this.gitLabRepositoryInfo?.projectName}
- Current Branch: ${this.gitLabRepositoryInfo?.currentBranch}
- Remote URL: ${this.gitLabRepositoryInfo?.remoteUrl}

**CRITICAL GIT WORKFLOW MANAGEMENT:**

You have access to the following git tools for GitLab workflow automation:
- git_branch: Creates a new branch from current branch (requires branch_name parameter)
- git_commit: Stages all changes and commits with descriptive message (requires commit_message parameter)
- git_push: Pushes current branch to remote repository (no parameters required)

**MANDATORY TODO LIST WORKFLOW:**

At the START of EVERY task, you MUST:
1. Evaluate the current branch context and workflow suggestions below
2. Use the update_todo_list tool to add relevant git workflow todos based on these suggestions
3. Mark todos as "in_progress" when starting them, "completed" when done

Propose the user workflow suggestions for the current branch "${branch}":
${workflowSuggestions.map((suggestion, index) => `${index + 1}. ${suggestion}`).join("\n")}

**TODO LIST RULES:**
- ALWAYS check if any workflow suggestions apply to the current task at the beginning
- If working on main/master branch: Add todos for creating feature branch, committing, and pushing
- If working on feature/fix branch: Add todos for committing and pushing when changes are ready
- If working on feature/fix branch: Add todos for creating a new branch when you are ask for a new feature
- Use update_todo_list tool to add these todos at the start of your work
- Example todos based on current branch context:
	 ${
			branch === "main" || branch === "master"
				? '* "Create feature branch for this work" (pending)\n  * "Commit changes with descriptive message" (pending)\n  * "Push changes to remote repository" (pending)'
				: '* "Commit changes with descriptive message" (pending)\n  * "Push changes to remote repository" (pending)'
		}

**GIT OPERATIONS GUIDELINES:**
- Always ask for user approval before using any git tool
- Use descriptive branch names following conventional commits (feature/, fix/, hotfix/, docs/, etc.)
- Provide meaningful commit messages that explain what changes were made
- After implementing changes, ALWAYS proactively suggest committing and pushing
- When on main/master branch, ALWAYS suggest creating a feature branch first before making changes
- When not on main/master branch, ALWAYS suggest creating a new branch first before making changes
- When finished and pushed, ALWAYS put the URL to create a merge request in the response`
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

			// Branch-specific suggestions
			if (branch === "main" || branch === "master") {
				suggestions.push(
					"I notice you're on the main branch. Would you like me to help you create a feature branch for this work? After that, I can help you commit your changes and push them.",
				)
			} else if (branch.startsWith("feat/") || branch.startsWith("feature/")) {
				suggestions.push(
					"You're working on a feature branch. After implementing this, I can help you create a merge request.",
				)
			} else if (branch.startsWith("fix/") || branch.startsWith("bugfix/")) {
				suggestions.push(
					"Working on a bug fix branch. I can help you ensure proper testing before creating a merge request.",
				)
			}

			suggestions.push("I can help you create a merge request when your changes are ready.")
			suggestions.push("Need help with GitLab CI/CD configuration (.gitlab-ci.yml)?")
		}

		return suggestions
	}
}

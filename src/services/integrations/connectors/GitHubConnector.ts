// kilocode_change - new file
import { BaseConnector } from "./BaseConnector"
import type { ExternalContextSource, ExternalComment, IntegrationConfig } from "../types"

/**
 * GitHub connector for fetching issues and PRs
 */
export class GitHubConnector extends BaseConnector {
	private apiBaseUrl = "https://api.github.com"

	constructor(config: IntegrationConfig) {
		super(config, require("../rate-limiter").RateLimiters.github)
	}

	async initialize(): Promise<void> {
		if (!this.config.authConfig.oauthToken) {
			throw new Error("GitHub OAuth token is required")
		}
		this.isInitialized = true
	}

	async testConnection(): Promise<boolean> {
		try {
			const response = await this.makeRequest("/user")
			return response.ok
		} catch {
			return false
		}
	}

	async fetchDiscussions(since?: number): Promise<ExternalContextSource[]> {
		const { repoOwner, repoName } = this.config.authConfig
		if (!repoOwner || !repoName) {
			throw new Error("GitHub repo owner and name are required")
		}

		const issues: ExternalContextSource[] = []
		let page = 1
		let hasMore = true

		while (hasMore) {
			await this.rateLimiter.consume()

			const url = `/repos/${repoOwner}/${repoName}/issues`
			const params = new URLSearchParams({
				state: this.config.filters?.state || "all",
				per_page: "100",
				page: page.toString(),
				sort: "updated",
				direction: "desc",
			})

			if (since) {
				params.append("since", new Date(since).toISOString())
			}

			const response = await this.makeRequest(`${url}?${params}`)
			const data = await response.json()

			if (!Array.isArray(data) || data.length === 0) {
				hasMore = false
				break
			}

			// Filter out pull requests if we only want issues
			const filteredData = data.filter((item: any) => {
				// Include both issues and PRs based on filters
				if (this.config.filters?.labels) {
					return item.labels.some((label: any) => this.config.filters!.labels!.includes(label.name))
				}
				return true
			})

			for (const item of filteredData) {
				// Determine if sensitive (private repo or contains sensitive keywords)
				const isSensitive = this.isContentSensitive(item.body || "")

				issues.push({
					id: `github-${item.id}`,
					type: "github",
					sourceId: item.number.toString(),
					title: item.title,
					url: item.html_url,
					author: item.user?.login || "unknown",
					createdAt: new Date(item.created_at).getTime(),
					updatedAt: new Date(item.updated_at).getTime(),
					content: this.encryptContent(item.body || "", isSensitive),
					encrypted: isSensitive,
					metadata: {
						issueNumber: item.number,
						state: item.state,
						labels: item.labels?.map((l: any) => l.name) || [],
					},
				})
			}

			// Check if we've fetched all items
			if (data.length < 100) {
				hasMore = false
			}

			page++
		}

		return issues
	}

	async fetchComments(discussionId: string): Promise<ExternalComment[]> {
		const { repoOwner, repoName } = this.config.authConfig
		if (!repoOwner || !repoName) {
			throw new Error("GitHub repo owner and name are required")
		}

		await this.rateLimiter.consume()

		const url = `/repos/${repoOwner}/${repoName}/issues/${discussionId}/comments`
		const response = await this.makeRequest(url)
		const data = await response.json()

		if (!Array.isArray(data)) {
			return []
		}

		return data.map((comment: any) => {
			const isSensitive = this.isContentSensitive(comment.body || "")

			return {
				id: `github-comment-${comment.id}`,
				author: comment.user?.login || "unknown",
				content: this.encryptContent(comment.body || "", isSensitive),
				encrypted: isSensitive,
				createdAt: new Date(comment.created_at).getTime(),
				metadata: {
					isCodeReview: comment.pull_request_url !== undefined,
				},
			}
		})
	}

	protected async storeDiscussions(sources: ExternalContextSource[], discussions: any[]): Promise<void> {
		// This will be implemented by the IntegrationService
		// which has access to the database manager
		console.log(`Storing ${sources.length} GitHub discussions`)
	}

	private async makeRequest(endpoint: string): Promise<Response> {
		const url = `${this.apiBaseUrl}${endpoint}`
		const headers = {
			Authorization: `Bearer ${this.config.authConfig.oauthToken}`,
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "KiloCode-Integration",
		}

		const response = await fetch(url, { headers })

		if (!response.ok) {
			throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
		}

		return response
	}

	private isContentSensitive(content: string): boolean {
		const sensitiveKeywords = ["password", "secret", "api_key", "token", "credential", "private_key"]
		const lowerContent = content.toLowerCase()
		return sensitiveKeywords.some((keyword) => lowerContent.includes(keyword))
	}
}

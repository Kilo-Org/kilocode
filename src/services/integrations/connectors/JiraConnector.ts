// kilocode_change - new file
import { BaseConnector } from "./BaseConnector"
import type { ExternalContextSource, ExternalComment, IntegrationConfig } from "../types"

/**
 * Jira connector for fetching issues and comments
 */
export class JiraConnector extends BaseConnector {
	private apiBaseUrl: string

	constructor(config: IntegrationConfig) {
		super(config, require("../rate-limiter").RateLimiters.jira)
		this.apiBaseUrl = config.authConfig.instanceUrl || ""
	}

	async initialize(): Promise<void> {
		if (!this.config.authConfig.instanceUrl) {
			throw new Error("Jira instance URL is required")
		}
		if (!this.config.authConfig.oauthToken) {
			throw new Error("Jira OAuth token is required")
		}
		this.isInitialized = true
	}

	async testConnection(): Promise<boolean> {
		try {
			const response = await this.makeRequest("/rest/api/3/myself")
			return response.ok
		} catch {
			return false
		}
	}

	async fetchDiscussions(since?: number): Promise<ExternalContextSource[]> {
		const issues: ExternalContextSource[] = []
		let startAt = 0
		let hasMore = true

		while (hasMore) {
			await this.rateLimiter.consume()

			const jql = this.buildJQLQuery(since)
			const url = `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,description,created,updated,issuetype,status,priority,labels,project&expand=changelog&startAt=${startAt}&maxResults=100`

			const response = await this.makeRequest(url)
			const data = await response.json()

			if (!data.issues || data.issues.length === 0) {
				hasMore = false
				break
			}

			for (const issue of data.issues) {
				const isSensitive = this.isContentSensitive(issue.fields?.description || "")

				issues.push({
					id: `jira-${issue.id}`,
					type: "jira",
					sourceId: issue.key,
					title: issue.fields?.summary || "",
					url: `${this.apiBaseUrl}/browse/${issue.key}`,
					author: issue.fields?.reporter?.displayName || "unknown",
					createdAt: new Date(issue.fields?.created).getTime(),
					updatedAt: new Date(issue.fields?.updated).getTime(),
					content: this.encryptContent(issue.fields?.description || "", isSensitive),
					encrypted: isSensitive,
					metadata: {
						issueKey: issue.key,
						issueType: issue.fields?.issuetype?.name,
						status: issue.fields?.status?.name,
						priority: issue.fields?.priority?.name,
					},
				})
			}

			if (data.issues.length < 100 || startAt + data.issues.length >= data.total) {
				hasMore = false
			}

			startAt += data.issues.length
		}

		return issues
	}

	async fetchComments(discussionId: string): Promise<ExternalComment[]> {
		await this.rateLimiter.consume()

		const url = `/rest/api/3/issue/${discussionId}/comment`
		const response = await this.makeRequest(url)
		const data = await response.json()

		if (!data.comments || !Array.isArray(data.comments)) {
			return []
		}

		return data.comments.map((comment: any) => {
			const isSensitive = this.isContentSensitive(comment.body || "")

			return {
				id: `jira-comment-${comment.id}`,
				author: comment.author?.displayName || "unknown",
				content: this.encryptContent(comment.body || "", isSensitive),
				encrypted: isSensitive,
				createdAt: new Date(comment.created).getTime(),
				metadata: {
					isInternal: comment.jsdPublic === false,
				},
			}
		})
	}

	protected async storeDiscussions(sources: ExternalContextSource[], discussions: any[]): Promise<void> {
		console.log(`Storing ${sources.length} Jira issues`)
	}

	private buildJQLQuery(since?: number): string {
		let jql = "project IN ("

		if (this.config.filters?.projectKeys && this.config.filters.projectKeys.length > 0) {
			jql += this.config.filters.projectKeys.map((key) => `"${key}"`).join(", ")
		} else {
			jql += "*"
		}

		jql += ")"

		if (this.config.filters?.issueTypes && this.config.filters.issueTypes.length > 0) {
			jql += ` AND issuetype IN (${this.config.filters.issueTypes.map((t) => `"${t}"`).join(", ")})`
		}

		if (since) {
			const date = new Date(since).toISOString().split("T")[0]
			jql += ` AND updated >= "${date}"`
		}

		jql += " ORDER BY updated DESC"

		return jql
	}

	private async makeRequest(endpoint: string): Promise<Response> {
		const url = `${this.apiBaseUrl}${endpoint}`
		const headers = {
			Authorization: `Bearer ${this.config.authConfig.oauthToken}`,
			Accept: "application/json",
		}

		const response = await fetch(url, { headers })

		if (!response.ok) {
			throw new Error(`Jira API error: ${response.status} ${response.statusText}`)
		}

		return response
	}

	private isContentSensitive(content: string): boolean {
		const sensitiveKeywords = ["password", "secret", "api_key", "token", "credential", "private_key"]
		const lowerContent = content.toLowerCase()
		return sensitiveKeywords.some((keyword) => lowerContent.includes(keyword))
	}
}

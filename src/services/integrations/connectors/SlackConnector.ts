// kilocode_change - new file
import { BaseConnector } from "./BaseConnector"
import type { ExternalContextSource, ExternalComment, IntegrationConfig } from "../types"

/**
 * Slack connector for fetching messages and discussions
 */
export class SlackConnector extends BaseConnector {
	private apiBaseUrl = "https://slack.com/api"

	constructor(config: IntegrationConfig) {
		super(config, require("../rate-limiter").RateLimiters.slack)
	}

	async initialize(): Promise<void> {
		if (!this.config.authConfig.oauthToken) {
			throw new Error("Slack OAuth token is required")
		}
		if (!this.config.authConfig.workspaceId) {
			throw new Error("Slack workspace ID is required")
		}
		this.isInitialized = true
	}

	async testConnection(): Promise<boolean> {
		try {
			const response = await this.makeRequest("auth.test")
			const data = await response.json()
			return data.ok === true
		} catch {
			return false
		}
	}

	async fetchDiscussions(since?: number): Promise<ExternalContextSource[]> {
		const messages: ExternalContextSource[] = []
		const channels = await this.getChannels()

		for (const channel of channels) {
			await this.rateLimiter.consume()

			const channelMessages = await this.fetchChannelMessages(channel.id, since)
			messages.push(...channelMessages)
		}

		return messages
	}

	async fetchComments(discussionId: string): Promise<ExternalComment[]> {
		// For Slack, comments are thread replies
		const [channelId, threadTs] = discussionId.split(":")

		await this.rateLimiter.consume()

		const url = `conversations.replies?channel=${channelId}&ts=${threadTs}&limit=100`
		const response = await this.makeRequest(url)
		const data = await response.json()

		if (!data.ok || !data.messages) {
			return []
		}

		// Filter out the parent message (we already have it)
		const replies = data.messages.filter((msg: any) => msg.ts !== threadTs)

		return replies.map((reply: any) => {
			const isSensitive = this.isContentSensitive(reply.text || "")

			return {
				id: `slack-reply-${reply.ts}`,
				author: reply.user || "unknown",
				content: this.encryptContent(reply.text || "", isSensitive),
				encrypted: isSensitive,
				createdAt: parseFloat(reply.ts) * 1000,
				metadata: {
					reactions: reply.reactions?.map((r: any) => ({
						name: r.name,
						count: r.count,
						users: r.users,
					})),
				},
			}
		})
	}

	protected async storeDiscussions(sources: ExternalContextSource[], discussions: any[]): Promise<void> {
		console.log(`Storing ${sources.length} Slack messages`)
	}

	private async getChannels(): Promise<Array<{ id: string; name: string }>> {
		const channels: Array<{ id: string; name: string }> = []
		let cursor: string | undefined

		do {
			await this.rateLimiter.consume()

			const url = cursor
				? `conversations.list?types=public_channel,private_channel&limit=100&cursor=${cursor}`
				: `conversations.list?types=public_channel,private_channel&limit=100`

			const response = await this.makeRequest(url)
			const data = await response.json()

			if (data.ok && data.channels) {
				// Filter by configured channels if specified
				const filteredChannels = this.config.filters?.channels
					? data.channels.filter((ch: any) => this.config.filters!.channels!.includes(ch.name))
					: data.channels

				channels.push(...filteredChannels.map((ch: any) => ({ id: ch.id, name: ch.name })))
			}

			cursor = data.response_metadata?.next_cursor
		} while (cursor)

		return channels
	}

	private async fetchChannelMessages(channelId: string, since?: number): Promise<ExternalContextSource[]> {
		const messages: ExternalContextSource[] = []
		let cursor: string | undefined

		do {
			await this.rateLimiter.consume()

			const oldest = since ? since / 1000 : undefined
			const url = cursor
				? `conversations.history?channel=${channelId}&limit=100&cursor=${cursor}&oldest=${oldest}`
				: `conversations.history?channel=${channelId}&limit=100&oldest=${oldest}`

			const response = await this.makeRequest(url)
			const data = await response.json()

			if (data.ok && data.messages) {
				// Only include messages with replies (threads) or mentions
				for (const msg of data.messages) {
					if (msg.reply_count > 0 || msg.text.includes("<@")) {
						const isSensitive = this.isContentSensitive(msg.text || "")

						messages.push({
							id: `slack-${msg.ts}`,
							type: "slack",
							sourceId: `${channelId}:${msg.ts}`,
							title: msg.text?.substring(0, 100) || "Thread",
							url: `https://${this.config.authConfig.workspaceId}.slack.com/archives/${channelId}/p${msg.ts.replace(".", "")}`,
							author: msg.user || "unknown",
							createdAt: parseFloat(msg.ts) * 1000,
							updatedAt: parseFloat(msg.ts) * 1000,
							content: this.encryptContent(msg.text || "", isSensitive),
							encrypted: isSensitive,
							metadata: {
								channel: channelId,
								threadTs: msg.thread_ts || msg.ts,
								mentions: this.extractMentions(msg.text || ""),
								reactions: msg.reactions?.map((r: any) => r.name) || [],
							},
						})
					}
				}
			}

			cursor = data.response_metadata?.next_cursor
		} while (cursor)

		return messages
	}

	private async makeRequest(endpoint: string): Promise<Response> {
		const url = `${this.apiBaseUrl}/${endpoint}`
		const headers = {
			Authorization: `Bearer ${this.config.authConfig.oauthToken}`,
			"Content-Type": "application/json",
		}

		const response = await fetch(url, { headers })

		return response
	}

	private extractMentions(text: string): string[] {
		const mentionRegex = /<@([A-Z0-9]+)>/g
		const mentions: string[] = []
		let match

		while ((match = mentionRegex.exec(text)) !== null) {
			mentions.push(match[1])
		}

		return mentions
	}

	private isContentSensitive(content: string): boolean {
		const sensitiveKeywords = ["password", "secret", "api_key", "token", "credential", "private_key"]
		const lowerContent = content.toLowerCase()
		return sensitiveKeywords.some((keyword) => lowerContent.includes(keyword))
	}
}

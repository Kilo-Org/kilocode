// kilocode_change - Slack Integration Service
import { WebClient } from "@slack/web-api"
import { v4 as uuidv4 } from "uuid"
import { DatabaseManager, getDatabaseManager } from "../../core/database/manager"
import {
	SlackIntegration,
	SharedMessage,
	SlackIntegrationConfig,
	ShareMessageRequest,
	ShareMessageResponse,
} from "./models"
import type { ExtensionContext } from "vscode"

export class SlackIntegrationService {
	private db: DatabaseManager
	private context: ExtensionContext | null = null
	private clients: Map<string, WebClient> = new Map()

	constructor(context?: ExtensionContext) {
		this.db = getDatabaseManager()
		if (context) {
			this.context = context
		}
	}

	async createIntegration(
		config: Omit<SlackIntegration, "id" | "createdAt" | "isActive">,
	): Promise<SlackIntegration> {
		const id = uuidv4()
		const integration: SlackIntegration = {
			id,
			...config,
			isActive: true,
			createdAt: new Date(),
		}

		// Store tokens securely using VSCode secrets if context is available
		if (this.context) {
			await this.context.secrets.store(`slack_bot_token_${id}`, config.botToken)
			await this.context.secrets.store(`slack_user_token_${id}`, config.userToken)
		}

		// Update integration with empty token strings for database storage
		const dbIntegration = {
			...integration,
			botToken: "", // Don't store actual tokens in database
			userToken: "",
		}

		// Create integration in database using proper DatabaseManager method
		const dbId = this.db.createSlackIntegration({
			user_id: dbIntegration.userId,
			workspace_id: dbIntegration.workspaceId,
			channel_id: dbIntegration.channelId,
			bot_token: dbIntegration.botToken,
			user_token: dbIntegration.userToken,
			is_active: dbIntegration.isActive ? 1 : 0,
			last_used: dbIntegration.lastUsed?.toISOString(),
			metadata: dbIntegration.metadata ? JSON.stringify(dbIntegration.metadata) : undefined,
		})

		return integration
	}

	async getIntegration(id: string): Promise<SlackIntegration | null> {
		const row = this.db.getSlackIntegration(id)
		if (!row) {
			return null
		}

		return {
			id: row.id,
			userId: row.user_id,
			workspaceId: row.workspace_id,
			channelId: row.channel_id,
			botToken: "", // Tokens are stored securely, not in database
			userToken: "",
			isActive: Boolean(row.is_active),
			createdAt: new Date(row.created_at),
			lastUsed: row.last_used ? new Date(row.last_used) : undefined,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}
	}

	async validateToken(token: string): Promise<boolean> {
		const client = new WebClient(token)
		try {
			const result = await client.auth.test()
			return result.ok
		} catch (error) {
			console.error("Slack token validation failed:", error)
			return false
		}
	}

	async shareMessage(request: ShareMessageRequest): Promise<ShareMessageResponse> {
		try {
			const integration = await this.getIntegration(request.integrationId)
			if (!integration) {
				return { success: false, error: "Integration not found" }
			}

			if (!integration.isActive) {
				return { success: false, error: "Integration is not active" }
			}

			// Get the actual token from secure storage
			let botToken: string | undefined
			if (this.context) {
				botToken = await this.context.secrets.get(`slack_bot_token_${request.integrationId}`)
			}

			if (!botToken) {
				return { success: false, error: "Bot token not found" }
			}

			// Get or create client
			let client = this.clients.get(request.integrationId)
			if (!client) {
				client = new WebClient(botToken)
				this.clients.set(request.integrationId, client)
			}

			// Format message based on type
			let formattedContent = request.content
			if (request.messageType === "code") {
				formattedContent = this.formatCodeForSlack(request.content)
			}

			// Post message to Slack
			const response = await client.chat.postMessage({
				channel: request.channelId,
				text: formattedContent,
				mrkdwn: true,
			})

			if (!response.ok) {
				return { success: false, error: response.error }
			}

			// Save shared message record
			const messageId = uuidv4()
			const sharedMessage: SharedMessage = {
				id: messageId,
				integrationId: request.integrationId,
				content: request.content,
				channelId: request.channelId,
				timestamp: new Date(),
				response: {
					ok: response.ok,
					ts: response.ts,
					channel: response.channel,
				},
			}

			// Create shared message in database
			this.db.createSharedMessage({
				integration_id: sharedMessage.integrationId,
				message_id: sharedMessage.messageId,
				content: sharedMessage.content,
				channel_id: sharedMessage.channelId,
				timestamp: sharedMessage.timestamp.toISOString(),
				response: JSON.stringify(sharedMessage.response),
				metadata: sharedMessage.metadata ? JSON.stringify(sharedMessage.metadata) : undefined,
			})

			// Update last used timestamp
			this.db.updateSlackIntegrationLastUsed(request.integrationId)

			return {
				success: true,
				messageId: sharedMessage.id,
				timestamp: response.ts,
			}
		} catch (error) {
			console.error("Failed to share message to Slack:", error)
			return { success: false, error: error.message }
		}
	}

	private formatCodeForSlack(code: string): string {
		// Format code with Slack markdown for code blocks
		return `\`\`\`${code}\`\`\``
	}

	formatCodeSnippet(code: string, language?: string): string {
		const lang = language || "text"
		return `\`\`\`${lang}\n${code}\`\`\``
	}

	async listSharedMessages(integrationId: string, limit: number = 50): Promise<SharedMessage[]> {
		const rows = this.db.getSharedMessagesByIntegrationId(integrationId).slice(0, limit)

		return rows.map((row) => ({
			id: row.id,
			integrationId: row.integration_id,
			messageId: row.message_id,
			content: row.content,
			channelId: row.channel_id,
			timestamp: new Date(row.timestamp),
			response: row.response ? JSON.parse(row.response) : undefined,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}))
	}

	async updateIntegrationStatus(id: string, isActive: boolean): Promise<void> {
		this.db.updateSlackIntegrationActive(id, isActive)
	}

	async deleteIntegration(id: string): Promise<void> {
		// Remove from secure storage if context is available
		if (this.context) {
			await this.context.secrets.delete(`slack_bot_token_${id}`)
			await this.context.secrets.delete(`slack_user_token_${id}`)
		}

		// Remove from database
		this.db.deleteSlackIntegration(id)

		// Remove associated shared messages
		this.db.deleteSharedMessagesByIntegrationId(id)

		// Remove client from cache
		this.clients.delete(id)
	}
}

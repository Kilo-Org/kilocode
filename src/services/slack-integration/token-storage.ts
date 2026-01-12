// kilocode_change - Secure Token Storage for Slack Integration

import type { ExtensionContext } from "vscode"

/**
 * TokenStorage provides secure storage for Slack API tokens using VSCode's SecretStorage.
 * This ensures tokens are encrypted and not stored in plain text in the database.
 */
export class TokenStorage {
	private context: ExtensionContext

	constructor(context: ExtensionContext) {
		this.context = context
	}

	/**
	 * Get the storage key for a bot token
	 */
	private getBotTokenKey(integrationId: string): string {
		return `slack_bot_token_${integrationId}`
	}

	/**
	 * Get the storage key for a user token
	 */
	private getUserTokenKey(integrationId: string): string {
		return `slack_user_token_${integrationId}`
	}

	/**
	 * Store a bot token securely
	 */
	async storeBotToken(integrationId: string, token: string): Promise<void> {
		await this.context.secrets.store(this.getBotTokenKey(integrationId), token)
	}

	/**
	 * Get a bot token from secure storage
	 */
	async getBotToken(integrationId: string): Promise<string | undefined> {
		return await this.context.secrets.get(this.getBotTokenKey(integrationId))
	}

	/**
	 * Store a user token securely
	 */
	async storeUserToken(integrationId: string, token: string): Promise<void> {
		await this.context.secrets.store(this.getUserTokenKey(integrationId), token)
	}

	/**
	 * Get a user token from secure storage
	 */
	async getUserToken(integrationId: string): Promise<string | undefined> {
		return await this.context.secrets.get(this.getUserTokenKey(integrationId))
	}

	/**
	 * Delete both bot and user tokens for an integration
	 */
	async deleteTokens(integrationId: string): Promise<void> {
		await this.context.secrets.delete(this.getBotTokenKey(integrationId))
		await this.context.secrets.delete(this.getUserTokenKey(integrationId))
	}

	/**
	 * Check if bot token exists
	 */
	async hasBotToken(integrationId: string): Promise<boolean> {
		const token = await this.getBotToken(integrationId)
		return token !== undefined && token !== ""
	}

	/**
	 * Check if user token exists
	 */
	async hasUserToken(integrationId: string): Promise<boolean> {
		const token = await this.getUserToken(integrationId)
		return token !== undefined && token !== ""
	}
}

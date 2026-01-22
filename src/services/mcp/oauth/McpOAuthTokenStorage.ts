import * as vscode from "vscode"
import * as crypto from "crypto"

export interface OAuthTokens {
	accessToken: string
	tokenType: string
	expiresAt?: number
	refreshToken?: string
	scope?: string
}

/**
 * Extended token data that includes authorization server metadata needed for refresh
 */
export interface StoredTokenData extends OAuthTokens {
	serverUrl: string
	issuedAt: number
	/** The authorization server's token endpoint URL (needed for refresh) */
	tokenEndpoint?: string
	/** The client ID used for this token (needed for refresh) */
	clientId?: string
	/** The client secret if available (needed for refresh for confidential clients) */
	clientSecret?: string
}

export class McpOAuthTokenStorage {
	private static readonly SERVER_LIST_KEY = "mcp-oauth-servers-list"

	constructor(private context: vscode.ExtensionContext) {}

	private hashServerUrl(serverUrl: string): string {
		return crypto.createHash("sha256").update(serverUrl).digest("hex")
	}

	private getStorageKey(serverUrl: string): string {
		return `mcp-oauth-${this.hashServerUrl(serverUrl)}`
	}

	/**
	 * Stores tokens securely using VS Code SecretStorage
	 * @param serverUrl The MCP server URL
	 * @param tokens The OAuth tokens to store
	 * @param metadata Optional metadata needed for token refresh (token endpoint, client credentials)
	 */
	async storeTokens(
		serverUrl: string,
		tokens: OAuthTokens,
		metadata?: {
			tokenEndpoint?: string
			clientId?: string
			clientSecret?: string
		},
	): Promise<void> {
		const data: StoredTokenData = {
			...tokens,
			serverUrl,
			issuedAt: Date.now(),
			tokenEndpoint: metadata?.tokenEndpoint,
			clientId: metadata?.clientId,
			clientSecret: metadata?.clientSecret,
		}
		await this.context.secrets.store(this.getStorageKey(serverUrl), JSON.stringify(data))
		await this.addServerToList(serverUrl)
	}

	/**
	 * Retrieves stored tokens (without refresh metadata)
	 */
	async getTokens(serverUrl: string): Promise<OAuthTokens | null> {
		const json = await this.context.secrets.get(this.getStorageKey(serverUrl))
		if (!json) return null
		try {
			const data = JSON.parse(json) as StoredTokenData
			// Return only the OAuthTokens part
			return {
				accessToken: data.accessToken,
				tokenType: data.tokenType,
				expiresAt: data.expiresAt,
				refreshToken: data.refreshToken,
				scope: data.scope,
			}
		} catch (e) {
			console.error(`Failed to parse stored tokens for ${serverUrl}`, e)
			return null
		}
	}

	/**
	 * Retrieves the full stored token data including refresh metadata
	 * This is used by the OAuth service to perform token refresh
	 */
	async getFullTokenData(serverUrl: string): Promise<StoredTokenData | null> {
		const json = await this.context.secrets.get(this.getStorageKey(serverUrl))
		if (!json) return null
		try {
			return JSON.parse(json) as StoredTokenData
		} catch (e) {
			console.error(`Failed to parse stored token data for ${serverUrl}`, e)
			return null
		}
	}

	/**
	 * Removes stored tokens
	 */
	async removeTokens(serverUrl: string): Promise<void> {
		await this.context.secrets.delete(this.getStorageKey(serverUrl))
		await this.removeServerFromList(serverUrl)
	}

	/**
	 * Lists all servers with stored tokens
	 */
	async listServers(): Promise<string[]> {
		return this.context.globalState.get<string[]>(McpOAuthTokenStorage.SERVER_LIST_KEY, [])
	}

	private async addServerToList(serverUrl: string): Promise<void> {
		const servers = await this.listServers()
		if (!servers.includes(serverUrl)) {
			servers.push(serverUrl)
			await this.context.globalState.update(McpOAuthTokenStorage.SERVER_LIST_KEY, servers)
		}
	}

	private async removeServerFromList(serverUrl: string): Promise<void> {
		const servers = await this.listServers()
		const index = servers.indexOf(serverUrl)
		if (index !== -1) {
			servers.splice(index, 1)
			await this.context.globalState.update(McpOAuthTokenStorage.SERVER_LIST_KEY, servers)
		}
	}
}

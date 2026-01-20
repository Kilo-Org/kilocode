import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
	OAuthClientInformationFull,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import crypto from "crypto"
import * as vscode from "vscode"
import { Package } from "../../shared/package"
import { getMcpServerCallbackPath, getServerAuthHash } from "../../utils/mcpAuth"
import { McpOAuthCallbackServer } from "./McpOAuthCallbackServer"

/**
 * Structure for all OAuth data stored in the single mcpOAuthSecrets JSON
 */
interface McpOAuthSecrets {
	[serverHash: string]: {
		tokens?: OAuthTokens
		tokens_saved_at?: number
		client_info?: OAuthClientInformationFull
		code_verifier?: string
		oauth_state?: string
		oauth_state_timestamp?: number
		pending_auth_url?: string
	}
}

/**
 * Helper to read OAuth secrets from storage
 */
async function getMcpOAuthSecrets(secrets: vscode.SecretStorage): Promise<McpOAuthSecrets> {
	const secretsJson = await secrets.get("mcpOAuthSecrets")
	if (!secretsJson) {
		return {}
	}
	try {
		return JSON.parse(secretsJson) as McpOAuthSecrets
	} catch (error) {
		console.error("[McpOAuth] Failed to parse MCP OAuth secrets:", error)
		return {}
	}
}

/**
 * Helper to save OAuth secrets to storage
 */
async function saveMcpOAuthSecrets(secrets: vscode.SecretStorage, data: McpOAuthSecrets): Promise<void> {
	await secrets.store("mcpOAuthSecrets", JSON.stringify(data))
}

/**
 * Implementation of OAuthClientProvider for KiloCode
 * Manages OAuth state and token storage for a single MCP server
 */
class KiloCodeOAuthClientProvider implements OAuthClientProvider {
	private serverName: string
	private serverUrl: string
	private _redirectUrl: string
	private serverHash: string
	private secrets: vscode.SecretStorage

	constructor(serverName: string, serverUrl: string, secrets: vscode.SecretStorage) {
		this.serverName = serverName
		this.serverUrl = serverUrl
		this.serverHash = getServerAuthHash(serverName, serverUrl)
		this.secrets = secrets

		// Redirect URL will be set when initialize() is called
		this._redirectUrl = ""
	}

	async initialize(): Promise<void> {
		// Use localhost HTTP server instead of IDE URI scheme
		// This allows showing success page in browser without IDE redirection
		// Works on all platforms (VSCode, JetBrains, CLI)
		const callbackPath = getMcpServerCallbackPath(this.serverName, this.serverUrl)
		const callbackServer = McpOAuthCallbackServer.getInstance()
		const baseUrl = await callbackServer.getCallbackUrl()
		this._redirectUrl = `${baseUrl}${callbackPath}`
	}

	get redirectUrl(): string {
		return this._redirectUrl
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			redirect_uris: [this._redirectUrl],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			client_name: "Kilo Code",
			client_uri: "https://kilo.ai",
			software_id: "kilocode",
		}
	}

	state(): string {
		// State is managed through storage, not instance variable
		return crypto.randomBytes(32).toString("hex")
	}

	async clientInformation(): Promise<OAuthClientInformationFull | undefined> {
		const secrets = await getMcpOAuthSecrets(this.secrets)
		return secrets[this.serverHash]?.client_info
	}

	async saveClientInformation(clientInformation: OAuthClientInformationFull): Promise<void> {
		const secrets = await getMcpOAuthSecrets(this.secrets)
		if (!secrets[this.serverHash]) {
			secrets[this.serverHash] = {}
		}
		secrets[this.serverHash].client_info = clientInformation
		await saveMcpOAuthSecrets(this.secrets, secrets)
	}

	async tokens(): Promise<OAuthTokens | undefined> {
		// Called by the SDK to check if we have valid tokens
		// This is called:
		// - During connection setup (to check if auth is needed)
		// - Before each request (to include Authorization header)
		// - During token refresh (to get refresh_token)
		//
		// IMPORTANT: We should return expired tokens if they have a refresh_token
		// The SDK will automatically attempt to refresh them
		// Only return undefined if we have NO tokens at all

		const secrets = await getMcpOAuthSecrets(this.secrets)
		const serverData = secrets[this.serverHash]

		if (!serverData?.tokens) {
			return undefined
		}

		// Check token expiration if timestamp exists
		if (serverData.tokens_saved_at && serverData.tokens.expires_in) {
			const expiresInMs = serverData.tokens.expires_in * 1000

			if (serverData.tokens_saved_at + expiresInMs < Date.now()) {
				// Token is expired
				// If we have a refresh_token, return the expired tokens so SDK can refresh
				// Otherwise return undefined to trigger full re-authentication
				if (serverData.tokens.refresh_token) {
					console.log(`[McpOAuth] Token expired for ${this.serverName}, will attempt refresh`)
					return serverData.tokens
				} else {
					return undefined
				}
			}
		}

		return serverData.tokens
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		// Called by the SDK after successful token exchange
		// Flow: finishAuth(code) → SDK's auth() → exchangeAuthorization() → THIS METHOD
		// Stores tokens in the single mcpOAuthSecrets JSON for persistence
		console.log(`[McpOAuth] Tokens saved for ${this.serverName}`)

		const secrets = await getMcpOAuthSecrets(this.secrets)
		if (!secrets[this.serverHash]) {
			secrets[this.serverHash] = {}
		}

		secrets[this.serverHash].tokens = tokens
		secrets[this.serverHash].tokens_saved_at = Date.now()
		await saveMcpOAuthSecrets(this.secrets, secrets)
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		// ========================================================================
		// IMPORTANT: This is called AUTOMATICALLY by the MCP SDK during connection
		// ========================================================================
		//
		// Flow:
		// 1. Extension loads → McpHub.connectToServer() is called
		// 2. authProvider.tokens() returns undefined (no tokens yet)
		// 3. client.connect(transport) is called
		// 4. SDK detects no tokens → calls auth(provider, {serverUrl})
		// 5. SDK internally calls startAuthorization() to generate OAuth URL
		// 6. SDK calls THIS METHOD with the generated authorizationUrl
		// 7. SDK throws UnauthorizedError (caught by McpHub to show "Authenticate" button)
		//
		// Our Strategy:
		// - Store the auth URL and state but DON'T open browser yet
		// - Wait for user to explicitly click "Authenticate" button
		// - When clicked, retrieve stored URL and open browser (see startOAuthFlow())
		//
		// This prevents automatic browser popups on every extension load!
		// ========================================================================

		// Guard: Check if we already have valid tokens
		// If tokens exist, this method shouldn't be called (SDK would use them)
		// But if it is called, don't overwrite existing auth state
		const existingTokens = await this.tokens()
		if (existingTokens && existingTokens.access_token) {
			console.warn(`[McpOAuth] Preserving existing tokens for ${this.serverName}`)
			return
		}

		// Extract state from URL if SDK already added it, otherwise generate one
		// The SDK may call state() and add it to the URL before calling this method
		let state = authorizationUrl.searchParams.get("state")
		if (!state) {
			// SDK didn't add state - generate one ourselves
			state = crypto.randomBytes(32).toString("hex")
			authorizationUrl.searchParams.set("state", state)
			console.log(`[McpOAuth] Generated new state for ${this.serverName}`)
		} else {
			// SDK already added state - use it (this is the state from state() method)
			console.log(`[McpOAuth] Using SDK-provided state for ${this.serverName}: ${state.substring(0, 8)}...`)
		}

		// Save state, timestamp, and the complete auth URL for later use
		// These will be used when the user clicks "Authenticate" button
		const secrets = await getMcpOAuthSecrets(this.secrets)
		if (!secrets[this.serverHash]) {
			secrets[this.serverHash] = {}
		}

		secrets[this.serverHash].oauth_state = state
		secrets[this.serverHash].oauth_state_timestamp = Date.now()
		secrets[this.serverHash].pending_auth_url = authorizationUrl.toString()
		await saveMcpOAuthSecrets(this.secrets, secrets)

		console.log(`[McpOAuth] OAuth required for ${this.serverName} - user must click Authenticate button`)
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		// Called by SDK when starting authorization flow (PKCE)
		// The verifier is used later in finishAuth() to exchange the auth code for tokens
		const secrets = await getMcpOAuthSecrets(this.secrets)
		if (!secrets[this.serverHash]) {
			secrets[this.serverHash] = {}
		}
		secrets[this.serverHash].code_verifier = codeVerifier
		await saveMcpOAuthSecrets(this.secrets, secrets)
	}

	async codeVerifier(): Promise<string> {
		// Called by SDK during finishAuth() to retrieve the PKCE verifier
		// Used to prove that the same client that started auth is finishing it
		const secrets = await getMcpOAuthSecrets(this.secrets)
		const verifier = secrets[this.serverHash]?.code_verifier

		if (!verifier) {
			throw new Error(`No code verifier found for ${this.serverName}`)
		}

		return verifier
	}

	/**
	 * Check if provider has valid authentication
	 */
	async isAuthenticated(): Promise<boolean> {
		const tokens = await this.tokens()
		return Boolean(tokens && tokens.access_token)
	}

	/**
	 * Get the server hash for this provider
	 */
	getServerHash(): string {
		return this.serverHash
	}
}

/**
 * Manages OAuth authentication for MCP servers
 * Creates and manages OAuthClientProvider instances and handles token storage
 */
export class McpOAuthManager {
	private providers: Map<string, OAuthClientProvider> = new Map()
	private secrets: vscode.SecretStorage
	// OAuth state parameter timeout - prevents replay attacks
	// The state is used for CSRF protection during the redirect back from the OAuth provider
	// Users typically complete the OAuth flow within seconds/minutes of clicking "Authenticate"
	// but we allow 10 minutes in case they get distracted or need to create an account
	// After 10 minutes, the state expires and user must click "Authenticate" again for security
	private readonly STATE_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

	constructor(secrets: vscode.SecretStorage) {
		this.secrets = secrets
	}

	/**
	 * Gets or creates an OAuthClientProvider for a server
	 * Note: This is async now because we need to initialize the redirect URL
	 */
	async getOrCreateProvider(serverName: string, serverUrl: string): Promise<OAuthClientProvider> {
		const key = `${serverName}:${serverUrl}`
		if (this.providers.has(key)) {
			return this.providers.get(key)!
		}

		// Create provider
		const provider = new KiloCodeOAuthClientProvider(serverName, serverUrl, this.secrets)
		await provider.initialize() // Sets the redirect URL
		this.providers.set(key, provider)
		return provider
	}

	/**
	 * Validates and clears stored OAuth state using hash-based lookup
	 */
	async validateAndClearState(serverHash: string, state: string): Promise<boolean> {
		const secrets = await getMcpOAuthSecrets(this.secrets)
		const serverData = secrets[serverHash]

		if (!serverData?.oauth_state) {
			console.error(`No stored state found for server hash: ${serverHash}`)
			return false
		}

		// Check if state has expired
		if (serverData.oauth_state_timestamp) {
			if (Date.now() - serverData.oauth_state_timestamp > this.STATE_EXPIRY_MS) {
				console.error(`OAuth state expired for server hash: ${serverHash}`)
				// Clear expired state
				delete serverData.oauth_state
				delete serverData.oauth_state_timestamp
				await saveMcpOAuthSecrets(this.secrets, secrets)
				return false
			}
		}

		// Validate state matches
		const isValid = serverData.oauth_state === state

		// Clear state after validation
		delete serverData.oauth_state
		delete serverData.oauth_state_timestamp
		await saveMcpOAuthSecrets(this.secrets, secrets)

		return isValid
	}

	/**
	 * Opens the browser to the stored OAuth URL when user clicks "Authenticate"
	 *
	 * This retrieves the authorization URL that was stored by redirectToAuthorization()
	 * when the SDK auto-detected that OAuth was needed during connection.
	 *
	 * Flow:
	 * 1. User sees "Authenticate" button (because UnauthorizedError was caught)
	 * 2. User clicks button → UI calls authenticateMcpServer RPC
	 * 3. Controller calls mcpHub.initiateOAuth()
	 * 4. McpHub calls THIS METHOD
	 * 5. We retrieve the stored auth URL (generated by SDK, includes state)
	 * 6. We open browser to that URL
	 * 7. User authorizes → callback with code → completeOAuth()
	 */
	async startOAuthFlow(serverName: string, serverUrl: string): Promise<void> {
		const serverHash = getServerAuthHash(serverName, serverUrl)
		const secrets = await getMcpOAuthSecrets(this.secrets)
		const storedAuthUrl = secrets[serverHash]?.pending_auth_url

		if (storedAuthUrl) {
			// Use the URL that the SDK generated (with state already added in redirectToAuthorization)
			await vscode.env.openExternal(vscode.Uri.parse(storedAuthUrl))
		} else {
			// Fallback: if no stored URL, the SDK hasn't been triggered yet
			// This could happen if the server was just added but connection hasn't been attempted
			throw new Error(
				`No pending authorization URL found for ${serverName}. Please try restarting the server first.`,
			)
		}
	}

	/**
	 * Clears all OAuth data for a server (used when server is deleted)
	 */
	async clearServerAuth(serverName: string, serverUrl: string): Promise<void> {
		const key = `${serverName}:${serverUrl}`
		const serverHash = getServerAuthHash(serverName, serverUrl)

		this.providers.delete(key)

		// Clear all OAuth-related data for this server
		const secrets = await getMcpOAuthSecrets(this.secrets)
		delete secrets[serverHash]
		await saveMcpOAuthSecrets(this.secrets, secrets)
	}
}

import * as vscode from "vscode"
import { z } from "zod"
import { McpAuthorizationDiscovery, AuthorizationServerMetadata } from "./McpAuthorizationDiscovery"
import { McpOAuthBrowserFlow, DEFAULT_AUTH_FLOW_PORT } from "./McpOAuthBrowserFlow"
import { McpOAuthTokenStorage, OAuthTokens, StoredTokenData } from "./McpOAuthTokenStorage"
import { generateCodeChallenge, generateCodeVerifier, generateState } from "./utils"

// Buffer time before token expiration to trigger proactive refresh (5 minutes)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

/**
 * OAuth configuration options that can override defaults
 */
export interface OAuthConfigOptions {
	/** Override client_id if pre-registered with the server */
	clientId?: string
	/** Client secret for confidential clients */
	clientSecret?: string
	/** Override scopes to request */
	scopes?: string[]
}

/**
 * Client credentials from Dynamic Client Registration (RFC 7591)
 * Schema for stored client credentials (camelCase format)
 */
const RegisteredClientCredentialsSchema = z.object({
	clientId: z.string(),
	clientSecret: z.string().optional(),
	clientIdIssuedAt: z.number().optional(),
	clientSecretExpiresAt: z.number().optional(),
	redirectUris: z.array(z.string()).optional(),
})

type RegisteredClientCredentials = z.infer<typeof RegisteredClientCredentialsSchema>

/**
 * Dynamic Client Registration Response schema (RFC 7591)
 */
const ClientRegistrationResponseSchema = z
	.object({
		client_id: z.string(),
		client_secret: z.string().optional(),
		client_id_issued_at: z.number().optional(),
		client_secret_expires_at: z.number().optional(),
		// Echo back the registered metadata
		redirect_uris: z.array(z.string()).optional(),
		grant_types: z.array(z.string()).optional(),
		response_types: z.array(z.string()).optional(),
		token_endpoint_auth_method: z.string().optional(),
		client_name: z.string().optional(),
		client_uri: z.string().optional(),
		logo_uri: z.string().optional(),
	})
	.passthrough()

export class McpOAuthService {
	private discovery: McpAuthorizationDiscovery
	private browserFlow: McpOAuthBrowserFlow
	private tokenStorage: McpOAuthTokenStorage
	private context: vscode.ExtensionContext

	// Storage key prefix for registered client credentials
	private static readonly CLIENT_CREDENTIALS_PREFIX = "mcp-oauth-client-"

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.discovery = new McpAuthorizationDiscovery()
		this.browserFlow = new McpOAuthBrowserFlow()
		this.tokenStorage = new McpOAuthTokenStorage(context)
	}

	/**
	 * Gets stored client credentials for an authorization server
	 */
	private async getStoredClientCredentials(authServerUrl: string): Promise<RegisteredClientCredentials | null> {
		const key = `${McpOAuthService.CLIENT_CREDENTIALS_PREFIX}${this.hashUrl(authServerUrl)}`
		const stored = await this.context.secrets.get(key)
		if (!stored) {
			return null
		}
		try {
			const parsed: unknown = JSON.parse(stored)
			const result = RegisteredClientCredentialsSchema.safeParse(parsed)
			if (!result.success) {
				console.warn(
					`[McpOAuthService] Invalid stored client credentials for ${authServerUrl}:`,
					result.error.message,
				)
				return null
			}
			return result.data
		} catch {
			return null
		}
	}

	/**
	 * Stores client credentials for an authorization server
	 */
	private async storeClientCredentials(
		authServerUrl: string,
		credentials: RegisteredClientCredentials,
	): Promise<void> {
		const key = `${McpOAuthService.CLIENT_CREDENTIALS_PREFIX}${this.hashUrl(authServerUrl)}`
		await this.context.secrets.store(key, JSON.stringify(credentials))
	}

	/**
	 * Simple hash function for URL-based storage keys
	 */
	private hashUrl(url: string): string {
		let hash = 0
		for (let i = 0; i < url.length; i++) {
			const char = url.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash // Convert to 32-bit integer
		}
		return Math.abs(hash).toString(16)
	}

	/**
	 * Initiates OAuth flow for an MCP server that returned 401
	 * @param serverUrl The MCP server URL
	 * @param wwwAuthenticateHeader The WWW-Authenticate header from 401 response (optional)
	 * @param options Optional OAuth configuration overrides
	 * @returns Promise resolving to access token
	 */
	async initiateOAuthFlow(
		serverUrl: string,
		wwwAuthenticateHeader?: string,
		options?: OAuthConfigOptions,
	): Promise<OAuthTokens> {
		// If WWW-Authenticate header wasn't provided, probe the server to get it
		let authHeader = wwwAuthenticateHeader
		if (!authHeader) {
			authHeader = await this.probeServerForAuthHeader(serverUrl)
		}

		// 1. Discovery
		const authServerMetadata = await this.discovery.discoverAuthorizationServer(serverUrl, authHeader)

		// Validate required endpoints exist for authorization code flow
		if (!authServerMetadata.authorization_endpoint) {
			throw new Error(
				`OAuth server at ${authServerMetadata.issuer} does not support authorization code flow (no authorization_endpoint). ` +
					`It may require a different authentication method.`,
			)
		}
		if (!authServerMetadata.token_endpoint) {
			throw new Error(
				`OAuth server at ${authServerMetadata.issuer} does not have a token endpoint (no token_endpoint). ` +
					`It may require a different authentication method.`,
			)
		}

		// 2. Generate PKCE
		const codeVerifier = generateCodeVerifier()
		const codeChallenge = generateCodeChallenge(codeVerifier)
		const state = generateState()

		// 3. Get or register client credentials
		// The redirect URI will be determined by the browser flow, but we need to specify the pattern
		// for Dynamic Client Registration. Register multiple URIs for compatibility:
		// - Generic localhost URI without port (for servers that don't care about port)
		// - Specific port URI (for servers that require exact match - like Cloudflare)
		// - VS Code URI handler (for fallback)
		// This matches VSCode's approach: they register both http://127.0.0.1/ and http://127.0.0.1:33418/
		const redirectUris = [
			"http://127.0.0.1/",
			`http://127.0.0.1:${DEFAULT_AUTH_FLOW_PORT}/`,
			"vscode://kilocode.kilo-code/oauth/callback",
		]
		const clientCredentials = await this.getOrRegisterClient(authServerMetadata, redirectUris, options)

		// Scopes: Use provided scopes, or from metadata if available
		// Don't use a default - some servers don't support scope parameter at all
		let scope: string | undefined
		if (options?.scopes?.length) {
			scope = options.scopes.join(" ")
		} else if (authServerMetadata.scopes_supported?.length) {
			scope = authServerMetadata.scopes_supported.join(" ")
		}
		// If no scopes defined anywhere, we'll omit the scope parameter

		// 4. Browser Flow
		// Note: We don't include the 'resource' parameter by default as some servers
		// (like Cloudflare) don't support RFC 8707 and return internal server error
		const authResult = await this.browserFlow.authorize({
			authorizationEndpoint: authServerMetadata.authorization_endpoint,
			clientId: clientCredentials.clientId,
			redirectUri: "http://127.0.0.1:0/callback", // Placeholder, will be replaced by local server
			scope,
			state,
			codeChallenge,
			codeChallengeMethod: "S256",
			// resource: serverUrl, // Disabled: Cloudflare doesn't support RFC 8707 resource parameter
		})

		// 5. Verify State
		if (authResult.state !== state) {
			throw new Error("State mismatch")
		}

		// 6. Exchange Code for Token
		const tokens = await this.exchangeCodeForToken(
			authServerMetadata.token_endpoint,
			authResult.code,
			codeVerifier,
			clientCredentials.clientId,
			authResult.redirectUri,
			clientCredentials.clientSecret,
		)

		// 7. Store Tokens with metadata needed for refresh
		await this.tokenStorage.storeTokens(serverUrl, tokens, {
			tokenEndpoint: authServerMetadata.token_endpoint,
			clientId: clientCredentials.clientId,
			clientSecret: clientCredentials.clientSecret,
		})

		return tokens
	}

	/**
	 * Gets stored tokens for a server, if available and valid
	 */
	async getStoredTokens(serverUrl: string): Promise<OAuthTokens | null> {
		return this.tokenStorage.getTokens(serverUrl)
	}

	/**
	 * Clears stored tokens for a server (for logout/re-auth)
	 */
	async clearTokens(serverUrl: string): Promise<void> {
		await this.tokenStorage.removeTokens(serverUrl)
	}

	/**
	 * Clears stored client credentials for an authorization server.
	 * This forces re-registration on the next OAuth flow.
	 */
	async clearClientCredentials(authServerUrl: string): Promise<void> {
		const key = `${McpOAuthService.CLIENT_CREDENTIALS_PREFIX}${this.hashUrl(authServerUrl)}`
		console.log(`[McpOAuthService] Clearing stored client credentials for: ${authServerUrl} (key: ${key})`)
		await this.context.secrets.delete(key)
	}

	/**
	 * Clears all stored client credentials.
	 * This forces re-registration for all authorization servers on next OAuth flow.
	 */
	async clearAllClientCredentials(): Promise<void> {
		// Unfortunately, VS Code SecretStorage doesn't have a way to list all keys
		// So we need to clear known ones. For now, let's clear credentials for common servers.
		const commonServers = [
			"https://bindings.mcp.cloudflare.com", // Cloudflare
			"https://github.com", // GitHub
		]
		for (const server of commonServers) {
			await this.clearClientCredentials(server)
		}
		console.log("[McpOAuthService] Cleared all known client credentials")
	}

	/**
	 * Checks if stored tokens are expired or about to expire and need refresh
	 * @param serverUrl The MCP server URL
	 * @returns Object indicating if refresh is needed and if refresh is possible
	 */
	async checkTokenRefreshNeeded(serverUrl: string): Promise<{
		needsRefresh: boolean
		canRefresh: boolean
		tokens: OAuthTokens | null
	}> {
		const tokenData = await this.tokenStorage.getFullTokenData(serverUrl)

		if (!tokenData) {
			return { needsRefresh: false, canRefresh: false, tokens: null }
		}

		const tokens: OAuthTokens = {
			accessToken: tokenData.accessToken,
			tokenType: tokenData.tokenType,
			expiresAt: tokenData.expiresAt,
			refreshToken: tokenData.refreshToken,
			scope: tokenData.scope,
		}

		// Check if token is expired or about to expire
		const isExpiredOrExpiring = tokenData.expiresAt
			? tokenData.expiresAt < Date.now() + TOKEN_REFRESH_BUFFER_MS
			: false

		if (!isExpiredOrExpiring) {
			return { needsRefresh: false, canRefresh: false, tokens }
		}

		// Token needs refresh - check if we can refresh it
		const canRefresh = !!(tokenData.refreshToken && tokenData.tokenEndpoint && tokenData.clientId)

		return { needsRefresh: true, canRefresh, tokens }
	}

	/**
	 * Gets debug information about stored token data for a server
	 * @param serverUrl The MCP server URL
	 * @returns Debug info object or null if no tokens stored
	 */
	async getTokenDebugInfo(serverUrl: string): Promise<{
		issuedAt?: number
		hasRefreshToken: boolean
		tokenEndpoint?: string
		clientId?: string
		canRefresh: boolean
		nextRefreshAt?: number
	} | null> {
		const tokenData = await this.tokenStorage.getFullTokenData(serverUrl)

		if (!tokenData) {
			return null
		}

		const hasRefreshToken = !!tokenData.refreshToken
		const canRefresh = !!(tokenData.refreshToken && tokenData.tokenEndpoint && tokenData.clientId)

		// Calculate next refresh time: TOKEN_REFRESH_BUFFER_MS before expiration
		let nextRefreshAt: number | undefined
		if (tokenData.expiresAt && canRefresh) {
			nextRefreshAt = tokenData.expiresAt - TOKEN_REFRESH_BUFFER_MS
		}

		return {
			issuedAt: tokenData.issuedAt,
			hasRefreshToken,
			tokenEndpoint: tokenData.tokenEndpoint,
			clientId: tokenData.clientId,
			canRefresh,
			nextRefreshAt,
		}
	}

	/**
	 * Refreshes an access token using the stored refresh token
	 * @param serverUrl The MCP server URL
	 * @returns New OAuth tokens if refresh was successful, null if refresh failed
	 */
	async refreshAccessToken(serverUrl: string): Promise<OAuthTokens | null> {
		const tokenData = await this.tokenStorage.getFullTokenData(serverUrl)

		if (!tokenData) {
			console.log(`[McpOAuthService] No stored token data for ${serverUrl}, cannot refresh`)
			return null
		}

		if (!tokenData.refreshToken) {
			console.log(`[McpOAuthService] No refresh token stored for ${serverUrl}, cannot refresh`)
			return null
		}

		if (!tokenData.tokenEndpoint) {
			console.log(`[McpOAuthService] No token endpoint stored for ${serverUrl}, cannot refresh`)
			return null
		}

		if (!tokenData.clientId) {
			console.log(`[McpOAuthService] No client ID stored for ${serverUrl}, cannot refresh`)
			return null
		}

		console.log(`[McpOAuthService] Refreshing access token for ${serverUrl}`)

		try {
			const body = new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: tokenData.refreshToken,
				client_id: tokenData.clientId,
			})

			// Include client_secret if available (for confidential clients)
			if (tokenData.clientSecret) {
				body.set("client_secret", tokenData.clientSecret)
			}

			const response = await fetch(tokenData.tokenEndpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: body.toString(),
			})

			if (!response.ok) {
				const text = await response.text()
				console.error(
					`[McpOAuthService] Token refresh failed: ${response.status} ${response.statusText} - ${text}`,
				)

				// Check if the error indicates the refresh token is invalid/expired
				// In this case, we should clear tokens and require re-authentication
				if (response.status === 400 || response.status === 401) {
					console.log(
						`[McpOAuthService] Refresh token appears to be invalid/expired, clearing tokens for ${serverUrl}`,
					)
					await this.tokenStorage.removeTokens(serverUrl)
				}

				return null
			}

			const data = (await response.json()) as any

			// Validate response
			if (!data.access_token || !data.token_type) {
				console.error("[McpOAuthService] Invalid token refresh response - missing access_token or token_type")
				return null
			}

			const newTokens: OAuthTokens = {
				accessToken: data.access_token,
				tokenType: data.token_type,
				expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
				// Use new refresh token if provided, otherwise keep the old one
				refreshToken: data.refresh_token || tokenData.refreshToken,
				scope: data.scope || tokenData.scope,
			}

			// Store the updated tokens with the same metadata
			await this.tokenStorage.storeTokens(serverUrl, newTokens, {
				tokenEndpoint: tokenData.tokenEndpoint,
				clientId: tokenData.clientId,
				clientSecret: tokenData.clientSecret,
			})

			console.log(`[McpOAuthService] Successfully refreshed access token for ${serverUrl}`)
			return newTokens
		} catch (error) {
			console.error(`[McpOAuthService] Error refreshing access token for ${serverUrl}:`, error)
			return null
		}
	}

	/**
	 * Performs Dynamic Client Registration (RFC 7591)
	 * @param registrationEndpoint The registration endpoint URL from auth server metadata
	 * @param redirectUris The redirect URIs to register
	 * @returns The registered client credentials
	 */
	private async registerClient(
		registrationEndpoint: string,
		redirectUris: string[],
	): Promise<RegisteredClientCredentials> {
		console.log(`[McpOAuthService] Performing Dynamic Client Registration at ${registrationEndpoint}`)

		// Client metadata according to RFC 7591
		const clientMetadata = {
			client_name: "Kilo Code",
			client_uri: "https://kilocode.ai",
			logo_uri: "https://kilocode.ai/logo.png",
			redirect_uris: redirectUris,
			grant_types: ["authorization_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "none", // Public client (no secret)
		}

		console.log(`[McpOAuthService] Client Registration Request:`, JSON.stringify(clientMetadata, null, 2))

		const response = await fetch(registrationEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(clientMetadata),
		})

		if (!response.ok) {
			const text = await response.text()
			console.error(
				`[McpOAuthService] Dynamic Client Registration failed: ${response.status} ${response.statusText}`,
				text,
			)
			throw new Error(`Dynamic Client Registration failed: ${response.status} ${response.statusText} - ${text}`)
		}

		const data: unknown = await response.json()
		console.log(`[McpOAuthService] Client Registration Response:`, JSON.stringify(data, null, 2))

		const result = ClientRegistrationResponseSchema.safeParse(data)

		if (!result.success) {
			console.error(`[McpOAuthService] Invalid client registration response:`, result.error.message)
			throw new Error(`Invalid client registration response: ${result.error.message}`)
		}

		console.log(`[McpOAuthService] Successfully registered client: ${result.data.client_id}`)
		console.log(
			`[McpOAuthService] Registered redirect_uris: ${result.data.redirect_uris?.join(", ") || "not echoed"}`,
		)

		return {
			clientId: result.data.client_id,
			clientSecret: result.data.client_secret,
			clientIdIssuedAt: result.data.client_id_issued_at,
			clientSecretExpiresAt: result.data.client_secret_expires_at,
			redirectUris: result.data.redirect_uris || redirectUris,
		}
	}

	/**
	 * Gets or obtains client credentials for an authorization server.
	 * Priority:
	 * 1. Use pre-configured client_id from options
	 * 2. Use stored registered client credentials
	 * 3. Perform Dynamic Client Registration if available
	 * 4. Fall back to Client ID Metadata Document URL
	 */
	private async getOrRegisterClient(
		authServerMetadata: AuthorizationServerMetadata,
		redirectUris: string[],
		options?: OAuthConfigOptions,
	): Promise<{ clientId: string; clientSecret?: string }> {
		console.log(`[McpOAuthService] getOrRegisterClient for issuer: ${authServerMetadata.issuer}`)
		console.log(`[McpOAuthService] Redirect URIs to use: ${redirectUris.join(", ")}`)

		// 1. Use pre-configured client_id if provided
		if (options?.clientId) {
			console.log("[McpOAuthService] Using pre-configured client_id:", options.clientId)
			return {
				clientId: options.clientId,
				clientSecret: options.clientSecret,
			}
		}

		// 2. Check for stored registered credentials
		const storedCredentials = await this.getStoredClientCredentials(authServerMetadata.issuer)
		if (storedCredentials) {
			console.log("[McpOAuthService] Found stored client credentials:", storedCredentials.clientId)

			// Check if redirect URIs match
			// If stored credentials don't have redirectUris (legacy), we assume they might be stale if we are strict
			// But to be safe, if we have stored credentials but they don't match what we want now, we should re-register
			const urisMatch = this.areRedirectUrisEqual(storedCredentials.redirectUris, redirectUris)

			if (!urisMatch) {
				console.log(
					"[McpOAuthService] Stored client credentials have different redirect URIs, will re-register",
				)
			} else if (
				!storedCredentials.clientSecretExpiresAt ||
				storedCredentials.clientSecretExpiresAt > Math.floor(Date.now() / 1000)
			) {
				console.log("[McpOAuthService] Using stored registered client credentials:", storedCredentials.clientId)
				return {
					clientId: storedCredentials.clientId,
					clientSecret: storedCredentials.clientSecret,
				}
			} else {
				console.log("[McpOAuthService] Stored client credentials have expired, will re-register")
			}
		} else {
			console.log("[McpOAuthService] No stored client credentials found")
		}

		// 3. Try Dynamic Client Registration if available
		if (authServerMetadata.registration_endpoint) {
			try {
				const credentials = await this.registerClient(authServerMetadata.registration_endpoint, redirectUris)
				// Store the registered credentials
				await this.storeClientCredentials(authServerMetadata.issuer, credentials)
				return {
					clientId: credentials.clientId,
					clientSecret: credentials.clientSecret,
				}
			} catch (error) {
				console.warn(
					`[McpOAuthService] Dynamic Client Registration failed, falling back to Client ID Metadata Document: ${error}`,
				)
			}
		}

		// 4. Fall back to Client ID Metadata Document URL
		console.log("[McpOAuthService] Using Client ID Metadata Document URL as client_id")
		return {
			clientId: "https://kilocode.ai/.well-known/oauth-client/vscode-extension.json",
		}
	}

	/**
	 * Checks if two sets of redirect URIs are equal (ignoring order)
	 */
	private areRedirectUrisEqual(stored?: string[], requested?: string[]): boolean {
		if (!stored || !requested) {
			return false
		}
		if (stored.length !== requested.length) {
			return false
		}
		const sortedStored = [...stored].sort()
		const sortedRequested = [...requested].sort()
		for (let i = 0; i < sortedStored.length; i++) {
			if (sortedStored[i] !== sortedRequested[i]) {
				return false
			}
		}
		return true
	}

	/**
	 * Probes the MCP server to get the WWW-Authenticate header from a 401 response.
	 * This is necessary because the MCP SDK doesn't preserve HTTP headers in errors.
	 * @param serverUrl The MCP server URL to probe
	 * @returns The WWW-Authenticate header value, or undefined if not available
	 */
	private async probeServerForAuthHeader(serverUrl: string): Promise<string | undefined> {
		try {
			// Make a GET request to the server URL to trigger a 401 response
			const response = await fetch(serverUrl, {
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			})

			if (response.status === 401) {
				// Extract the WWW-Authenticate header
				const authHeader = response.headers.get("WWW-Authenticate") || response.headers.get("www-authenticate")
				if (authHeader) {
					console.log(`[McpOAuthService] Got WWW-Authenticate header from ${serverUrl}: ${authHeader}`)
					return authHeader
				}
			}

			console.log(
				`[McpOAuthService] Probe to ${serverUrl} returned status ${response.status}, no WWW-Authenticate header found`,
			)
			return undefined
		} catch (error) {
			console.error(`[McpOAuthService] Failed to probe server ${serverUrl} for auth header:`, error)
			return undefined
		}
	}

	private async exchangeCodeForToken(
		tokenEndpoint: string,
		code: string,
		codeVerifier: string,
		clientId: string,
		redirectUri: string,
		clientSecret?: string,
	): Promise<OAuthTokens> {
		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: codeVerifier,
		})

		// If client_secret was provided (from Dynamic Client Registration), include it
		if (clientSecret) {
			body.set("client_secret", clientSecret)
		}

		const response = await fetch(tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: body.toString(),
		})

		if (!response.ok) {
			const text = await response.text()
			throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${text}`)
		}

		const data = (await response.json()) as any

		// Validate response
		if (!data.access_token || !data.token_type) {
			throw new Error("Invalid token response")
		}

		return {
			accessToken: data.access_token,
			tokenType: data.token_type,
			expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
			refreshToken: data.refresh_token,
			scope: data.scope,
		}
	}
}

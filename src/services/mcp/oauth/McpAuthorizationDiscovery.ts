import { z } from "zod"
import { parseWwwAuthenticateHeader } from "./utils"

// Zod schemas for runtime validation at IO boundaries

/**
 * Protected Resource Metadata schema (RFC 9728)
 */
export const ProtectedResourceMetadataSchema = z
	.object({
		resource: z.string(),
		authorization_servers: z.array(z.string()),
		scopes_supported: z.array(z.string()).optional(),
	})
	.passthrough() // Allow additional RFC-defined fields

export type ProtectedResourceMetadata = z.infer<typeof ProtectedResourceMetadataSchema>

/**
 * Authorization Server Metadata schema (RFC 8414 / OIDC Discovery)
 * Note: We make authorization_endpoint and token_endpoint optional here and validate
 * them separately to provide better error messages and support various OAuth flows.
 */
export const AuthorizationServerMetadataSchema = z
	.object({
		issuer: z.string(),
		authorization_endpoint: z.string().optional(),
		token_endpoint: z.string().optional(),
		scopes_supported: z.array(z.string()).optional(),
		response_types_supported: z.array(z.string()).optional(),
		code_challenge_methods_supported: z.array(z.string()).optional(),
		client_id_metadata_document_supported: z.boolean().optional(),
		registration_endpoint: z.string().optional(),
		// Device flow support
		device_authorization_endpoint: z.string().optional(),
	})
	.passthrough() // Allow additional RFC-defined fields

export type AuthorizationServerMetadata = z.infer<typeof AuthorizationServerMetadataSchema>

export class McpAuthorizationDiscovery {
	/**
	 * Discovers authorization server from WWW-Authenticate header or well-known URIs
	 */
	async discoverAuthorizationServer(
		serverUrl: string,
		wwwAuthenticateHeader?: string,
	): Promise<AuthorizationServerMetadata> {
		// 1. Get resource metadata URL from WWW-Authenticate header
		let metadataUrl: string | null = null
		if (wwwAuthenticateHeader) {
			metadataUrl = parseWwwAuthenticateHeader(wwwAuthenticateHeader)
		}

		// 2. Try to fetch resource metadata from various sources
		let resourceMetadata: ProtectedResourceMetadata | null = null
		let lastError: Error | null = null

		// Try 1: Use URL from WWW-Authenticate header
		if (metadataUrl) {
			try {
				resourceMetadata = await this.fetchResourceMetadata(metadataUrl)
			} catch (e) {
				console.log(`Failed to fetch resource metadata from WWW-Authenticate URL: ${e}`)
				lastError = e instanceof Error ? e : new Error(String(e))
			}
		}

		// Try 2: Well-known URI according to RFC 9728
		if (!resourceMetadata) {
			const wellKnownUrl = this.buildWellKnownResourceMetadataUrl(serverUrl)
			try {
				resourceMetadata = await this.fetchResourceMetadata(wellKnownUrl)
			} catch (e) {
				console.log(`Failed to fetch resource metadata from well-known URL: ${e}`)
				lastError = e instanceof Error ? e : new Error(String(e))
			}
		}

		// Try 3: Directly discover auth server metadata at server origin
		// This is a fallback for servers that don't implement RFC 9728 but do have OAuth
		if (!resourceMetadata) {
			console.log("No resource metadata available, trying direct auth server discovery at server origin")
			try {
				const url = new URL(serverUrl)
				return await this.fetchAuthServerMetadata(url.origin)
			} catch (e) {
				console.log(`Failed direct auth server discovery: ${e}`)
				// Continue to throw the original error
			}
		}

		if (!resourceMetadata) {
			throw lastError || new Error("Failed to discover authorization server")
		}

		// 3. Pick first auth server
		if (!resourceMetadata.authorization_servers || resourceMetadata.authorization_servers.length === 0) {
			throw new Error("No authorization servers found in resource metadata")
		}
		const authServerUrl = resourceMetadata.authorization_servers[0]

		// 4. Fetch auth server metadata
		return this.fetchAuthServerMetadata(authServerUrl)
	}

	/**
	 * Constructs the well-known URL for Protected Resource Metadata according to RFC 9728.
	 * For a resource at https://example.com/path, the metadata URL is:
	 * https://example.com/.well-known/oauth-protected-resource/path
	 */
	private buildWellKnownResourceMetadataUrl(serverUrl: string): string {
		const url = new URL(serverUrl)
		const path = url.pathname.replace(/\/$/, "") // Remove trailing slash if present
		// Insert .well-known path after origin, before any resource path
		url.pathname = `/.well-known/oauth-protected-resource${path}`
		return url.toString()
	}

	/**
	 * Fetches Protected Resource Metadata (RFC 9728)
	 */
	async fetchResourceMetadata(metadataUrl: string): Promise<ProtectedResourceMetadata> {
		try {
			const response = await fetch(metadataUrl)
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`)
			}
			const json: unknown = await response.json()
			const result = ProtectedResourceMetadataSchema.safeParse(json)
			if (!result.success) {
				throw new Error(`Invalid resource metadata format: ${result.error.message}`)
			}
			return result.data
		} catch (error) {
			throw new Error(`Failed to fetch resource metadata from ${metadataUrl}: ${error}`)
		}
	}

	/**
	 * Fetches Authorization Server Metadata (RFC 8414 / OIDC Discovery)
	 */
	async fetchAuthServerMetadata(issuerUrl: string): Promise<AuthorizationServerMetadata> {
		const baseUrl = issuerUrl.replace(/\/$/, "")

		// Try RFC 8414 first
		try {
			const url = `${baseUrl}/.well-known/oauth-authorization-server`
			const response = await fetch(url)
			if (response.ok) {
				const json: unknown = await response.json()
				const result = AuthorizationServerMetadataSchema.safeParse(json)
				if (result.success && result.data.authorization_endpoint && result.data.token_endpoint) {
					return result.data
				}
				// Log validation error but continue to try OIDC
				console.warn(`RFC 8414 metadata incomplete or validation failed`)
			}
		} catch (e) {
			// Ignore and try next
		}

		// Try OIDC Discovery
		try {
			const url = `${baseUrl}/.well-known/openid-configuration`
			const response = await fetch(url)
			if (response.ok) {
				const json: unknown = await response.json()
				const result = AuthorizationServerMetadataSchema.safeParse(json)
				if (result.success && result.data.authorization_endpoint && result.data.token_endpoint) {
					return result.data
				}
				console.warn(`OIDC metadata incomplete or validation failed`)
			}
		} catch (e) {
			// Ignore fetch errors
		}

		throw new Error(`Failed to discover authorization server metadata for ${issuerUrl}`)
	}
}

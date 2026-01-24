---
sidebar_position: 5
title: "MCP OAuth Authorization"
---

# MCP OAuth Authorization

### Overview

Many MCP servers require authentication to access protected resources. Currently, Kilo Code only supports static credential configuration (API keys, tokens) which must be manually entered and stored. This creates friction for users and security concerns for enterprises.

The MCP specification defines an OAuth 2.1-based authorization flow that enables secure, user-friendly authentication without requiring users to manually manage credentials. This document specifies how Kilo Code will implement the MCP Authorization specification to support OAuth-enabled MCP servers.

### Goals

1. **Eliminate manual credential management** - Users authenticate via browser-based OAuth flows instead of copying/pasting API keys
2. **Improve security** - Tokens are obtained through secure OAuth flows with PKCE, reducing credential exposure
3. **Support enterprise SSO** - Organizations can use their existing identity providers
4. **Maintain compatibility** - Continue supporting static credentials for servers that don't implement OAuth

### Non-Goals (MVP)

- Token refresh automation (will use re-authentication flow initially)
- Dynamic Client Registration (will rely on Client ID Metadata Documents)
- Multiple authorization server selection (will use first available)

## MCP Authorization Specification Summary

The MCP Authorization spec (Protocol Revision 2025-11-25) defines an OAuth 2.1-based flow for HTTP-based MCP transports. Key components:

### Roles

- **MCP Server** - Acts as OAuth 2.1 Resource Server, accepts access tokens
- **MCP Client** (Kilo Code) - Acts as OAuth 2.1 Client, obtains tokens on behalf of users
- **Authorization Server** - Issues access tokens (may be hosted with MCP server or separate)

### Discovery Flow

1. Client makes unauthenticated request to MCP server
2. Server returns `401 Unauthorized` with `WWW-Authenticate` header containing `resource_metadata` URL
3. Client fetches Protected Resource Metadata (RFC 9728) to discover authorization server(s)
4. Client fetches Authorization Server Metadata (RFC 8414 or OpenID Connect Discovery)
5. Client initiates OAuth authorization flow

### Client Registration

The spec supports three approaches (in priority order):

1. **Pre-registration** - Client has existing credentials for the server
2. **Client ID Metadata Documents** - Client uses HTTPS URL as client_id pointing to metadata JSON
3. **Dynamic Client Registration** - Client registers dynamically via RFC 7591

### Authorization Flow

1. Generate PKCE code verifier and challenge
2. Open browser with authorization URL including `resource` parameter (RFC 8707)
3. User authenticates and authorizes
4. Receive authorization code via redirect
5. Exchange code for access token
6. Use access token in `Authorization: Bearer` header for MCP requests

## System Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MCP OAuth Authorization Flow                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐    1. MCP Request     ┌──────────────────┐                    │
│  │              │ ───────────────────►  │                  │                    │
│  │  Kilo Code   │                       │   MCP Server     │                    │
│  │  Extension   │  ◄─────────────────── │  (Resource       │                    │
│  │              │    2. 401 + metadata  │   Server)        │                    │
│  └──────┬───────┘                       └──────────────────┘                    │
│         │                                                                        │
│         │ 3. Fetch resource metadata                                            │
│         │ 4. Fetch auth server metadata                                         │
│         ▼                                                                        │
│  ┌──────────────┐                       ┌──────────────────┐                    │
│  │   OAuth      │    5. Auth Request    │                  │                    │
│  │   Service    │ ───────────────────►  │  Authorization   │                    │
│  │              │                       │  Server          │                    │
│  │  - Discovery │  ◄─────────────────── │                  │                    │
│  │  - PKCE      │    8. Token Response  │  - User Auth     │                    │
│  │  - Tokens    │                       │  - Consent       │                    │
│  └──────┬───────┘                       └──────────────────┘                    │
│         │                                        ▲                               │
│         │ 6. Open browser                        │ 7. User authenticates        │
│         ▼                                        │                               │
│  ┌──────────────┐                       ┌────────┴─────────┐                    │
│  │   Browser    │ ─────────────────────►│      User        │                    │
│  │              │                       │                  │                    │
│  └──────────────┘                       └──────────────────┘                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### New Components

#### 1. McpOAuthService

A new service responsible for managing OAuth flows for MCP servers:

```typescript
// src/services/mcp/oauth/McpOAuthService.ts

interface McpOAuthService {
	/**
	 * Initiates OAuth flow for an MCP server that returned 401
	 * @param serverUrl The MCP server URL
	 * @param wwwAuthenticateHeader The WWW-Authenticate header from 401 response
	 * @returns Promise resolving to access token
	 */
	initiateOAuthFlow(serverUrl: string, wwwAuthenticateHeader: string): Promise<OAuthTokens>

	/**
	 * Gets stored tokens for a server, if available and valid
	 */
	getStoredTokens(serverUrl: string): Promise<OAuthTokens | null>

	/**
	 * Clears stored tokens for a server (for logout/re-auth)
	 */
	clearTokens(serverUrl: string): Promise<void>

	/**
	 * Refreshes tokens if refresh token is available
	 */
	refreshTokens(serverUrl: string): Promise<OAuthTokens | null>
}

interface OAuthTokens {
	accessToken: string
	tokenType: string
	expiresAt?: number
	refreshToken?: string
	scope?: string
}
```

#### 2. McpAuthorizationDiscovery

Handles the discovery of authorization server metadata:

```typescript
// src/services/mcp/oauth/McpAuthorizationDiscovery.ts

interface McpAuthorizationDiscovery {
	/**
	 * Discovers authorization server from WWW-Authenticate header or well-known URIs
	 */
	discoverAuthorizationServer(serverUrl: string, wwwAuthenticateHeader?: string): Promise<AuthorizationServerMetadata>

	/**
	 * Fetches Protected Resource Metadata (RFC 9728)
	 */
	fetchResourceMetadata(metadataUrl: string): Promise<ProtectedResourceMetadata>

	/**
	 * Fetches Authorization Server Metadata (RFC 8414 / OIDC Discovery)
	 */
	fetchAuthServerMetadata(issuerUrl: string): Promise<AuthorizationServerMetadata>
}

interface ProtectedResourceMetadata {
	resource: string
	authorization_servers: string[]
	scopes_supported?: string[]
	// ... other RFC 9728 fields
}

interface AuthorizationServerMetadata {
	issuer: string
	authorization_endpoint: string
	token_endpoint: string
	scopes_supported?: string[]
	response_types_supported: string[]
	code_challenge_methods_supported?: string[]
	client_id_metadata_document_supported?: boolean
	registration_endpoint?: string
	// ... other RFC 8414 fields
}
```

#### 3. McpOAuthTokenStorage

Secure storage for OAuth tokens:

```typescript
// src/services/mcp/oauth/McpOAuthTokenStorage.ts

interface McpOAuthTokenStorage {
	/**
	 * Stores tokens securely using VS Code SecretStorage
	 */
	storeTokens(serverUrl: string, tokens: OAuthTokens): Promise<void>

	/**
	 * Retrieves stored tokens
	 */
	getTokens(serverUrl: string): Promise<OAuthTokens | null>

	/**
	 * Removes stored tokens
	 */
	removeTokens(serverUrl: string): Promise<void>

	/**
	 * Lists all servers with stored tokens
	 */
	listServers(): Promise<string[]>
}
```

#### 4. Client ID Metadata Document Hosting

For Client ID Metadata Documents, Kilo Code needs to host a metadata document. We will use static hosting on kilocode.ai:

- Host at `https://kilocode.ai/.well-known/oauth-client/vscode-extension.json`
- Simple, reliable, no runtime dependencies
- Authorization servers can cache the document effectively
- No attack surface from dynamic generation logic

Metadata document:

```json
{
	"client_id": "https://kilocode.ai/.well-known/oauth-client/vscode-extension.json",
	"client_name": "Kilo Code",
	"client_uri": "https://kilocode.ai",
	"logo_uri": "https://kilocode.ai/logo.png",
	"redirect_uris": ["http://127.0.0.1:0/callback", "vscode://kilocode.kilo-code/oauth/callback"],
	"grant_types": ["authorization_code"],
	"response_types": ["code"],
	"token_endpoint_auth_method": "none"
}
```

### Integration with McpHub

The existing `McpHub` class needs modifications to support OAuth:

```typescript
// Modifications to McpHub.ts

class McpHub {
	private oauthService: McpOAuthService

	private async connectToServer(name: string, config: ServerConfig, source: "global" | "project"): Promise<void> {
		// ... existing connection logic ...

		// For HTTP-based transports, handle OAuth
		if (config.type === "sse" || config.type === "streamable-http") {
			try {
				await this.connectWithOAuth(name, config, source)
			} catch (error) {
				if (this.isOAuthRequired(error)) {
					// Initiate OAuth flow
					const tokens = await this.oauthService.initiateOAuthFlow(config.url, error.wwwAuthenticateHeader)
					// Retry connection with token
					await this.connectWithToken(name, config, source, tokens)
				} else {
					throw error
				}
			}
		}
	}

	private isOAuthRequired(error: unknown): boolean {
		// Check if error is 401 with WWW-Authenticate header
		return error instanceof HttpError && error.status === 401 && error.headers?.["www-authenticate"]
	}
}
```

### Configuration Schema Updates

Update the server configuration schema to support OAuth:

```typescript
// Extended server config for OAuth-enabled servers
const OAuthServerConfigSchema = BaseConfigSchema.extend({
	type: z.enum(["sse", "streamable-http"]),
	url: z.string().url(),
	headers: z.record(z.string()).optional(),

	// OAuth configuration
	oauth: z
		.object({
			// Override client_id if pre-registered
			clientId: z.string().optional(),
			clientSecret: z.string().optional(),

			// Override scopes to request
			scopes: z.array(z.string()).optional(),

			// Disable OAuth for this server (use static headers instead)
			disabled: z.boolean().optional(),
		})
		.optional(),
})
```

### Browser-Based Authorization Flow

The OAuth flow requires opening a browser for user authentication:

```typescript
// src/services/mcp/oauth/McpOAuthBrowserFlow.ts

interface McpOAuthBrowserFlow {
	/**
	 * Opens browser for authorization and waits for callback
	 */
	authorize(params: AuthorizationParams): Promise<AuthorizationResult>
}

interface AuthorizationParams {
	authorizationEndpoint: string
	clientId: string
	redirectUri: string
	scope: string
	state: string
	codeChallenge: string
	codeChallengeMethod: "S256"
	resource: string
}

interface AuthorizationResult {
	code: string
	state: string
}
```

**Redirect URI Handling:**

Two approaches for receiving the OAuth callback:

1. **Local HTTP Server** (Primary)

    - Start temporary HTTP server on random port
    - Use `http://127.0.0.1:{port}/callback` as redirect URI
    - Server receives callback, extracts code, closes

2. **VS Code URI Handler** (Fallback)
    - Register `vscode://kilocode.kilo-code/oauth/callback` URI handler
    - Works when local server isn't possible
    - Requires VS Code to be running

### Token Management

#### Storage

Tokens are stored using VS Code's SecretStorage API:

```typescript
// Key format: mcp-oauth-{serverUrlHash}
const storageKey = `mcp-oauth-${hashServerUrl(serverUrl)}`

// Stored value (encrypted by VS Code)
interface StoredTokenData {
	accessToken: string
	refreshToken?: string
	expiresAt?: number
	scope?: string
	serverUrl: string
	issuedAt: number
}
```

#### Token Lifecycle

1. **Initial Authentication**

    - User triggers connection to OAuth-enabled MCP server
    - Server returns 401, OAuth flow initiated
    - User authenticates in browser
    - Tokens stored securely

2. **Subsequent Connections**

    - Check for stored tokens
    - If valid, use directly
    - If expired and refresh token available, attempt refresh
    - If refresh fails or no refresh token, re-authenticate

3. **Token Refresh** (Future Enhancement)
    - Background refresh before expiry
    - Automatic retry on 401 with new token

### Error Handling

```typescript
// OAuth-specific errors
class McpOAuthError extends Error {
	constructor(
		message: string,
		public code: OAuthErrorCode,
		public serverUrl: string,
		public details?: Record<string, unknown>,
	) {
		super(message)
	}
}

enum OAuthErrorCode {
	DISCOVERY_FAILED = "discovery_failed",
	AUTHORIZATION_FAILED = "authorization_failed",
	TOKEN_EXCHANGE_FAILED = "token_exchange_failed",
	TOKEN_REFRESH_FAILED = "token_refresh_failed",
	PKCE_NOT_SUPPORTED = "pkce_not_supported",
	USER_CANCELLED = "user_cancelled",
	TIMEOUT = "timeout",
}
```

### User Experience

#### Connection Flow

1. User adds/enables OAuth-enabled MCP server
2. Extension detects OAuth requirement (401 response)
3. Notification: "MCP server requires authentication. Click to sign in."
4. User clicks → Browser opens to authorization server
5. User authenticates and authorizes
6. Browser redirects back → Extension receives token
7. Connection completes → Server shows as connected

#### UI Indicators

- **Authenticated servers**: Show lock icon with "Authenticated" status
- **Authentication required**: Show warning icon with "Sign in required" action
- **Authentication expired**: Show refresh icon with "Re-authenticate" action

#### Settings UI

Add OAuth status to MCP server settings:

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server: github-mcp                                      │
├─────────────────────────────────────────────────────────────┤
│ Status: Connected ✓                                         │
│ Type: streamable-http                                       │
│ URL: https://mcp.github.com                                 │
│                                                             │
│ Authentication                                              │
│ ├─ Method: OAuth 2.0                                        │
│ ├─ Status: Authenticated ✓                                  │
│ ├─ Expires: 2024-01-15 10:30 AM                            │
│ └─ [Sign Out] [Re-authenticate]                            │
└─────────────────────────────────────────────────────────────┘
```

## Security Considerations

### PKCE Requirement

All OAuth flows MUST use PKCE with S256 challenge method:

```typescript
function generatePKCE(): { verifier: string; challenge: string } {
	// Generate 32-byte random verifier
	const verifier = base64UrlEncode(crypto.randomBytes(32))

	// Create S256 challenge
	const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest())

	return { verifier, challenge }
}
```

### State Parameter

Generate cryptographically random state to prevent CSRF:

```typescript
const state = base64UrlEncode(crypto.randomBytes(32))
// Store state locally and verify on callback
```

### Token Storage Security

- Use VS Code SecretStorage (encrypted, per-workspace)
- Never log tokens
- Clear tokens on extension uninstall
- Support manual token revocation

### Resource Parameter

Always include `resource` parameter to bind tokens to specific MCP server:

```typescript
const authUrl = new URL(authorizationEndpoint)
authUrl.searchParams.set("resource", mcpServerUrl)
```

### Redirect URI Validation

- Only accept callbacks on registered redirect URIs
- Validate state parameter matches
- Use localhost with random port (not predictable)

## Scope and Implementation Plan

### Phase 1: Core OAuth Infrastructure

- [ ] Create `McpOAuthService` with basic flow support
- [ ] Implement `McpAuthorizationDiscovery` for metadata fetching
- [ ] Implement `McpOAuthTokenStorage` using SecretStorage
- [ ] Add PKCE generation utilities
- [ ] Create local HTTP server for OAuth callbacks

### Phase 2: McpHub Integration

- [ ] Modify `McpHub.connectToServer()` to detect OAuth requirements
- [ ] Add OAuth retry logic for 401 responses
- [ ] Update server configuration schema for OAuth options
- [ ] Add token injection to HTTP transports

### Phase 3: Client ID Metadata Document

- [ ] Host Kilo Code client metadata at kilocode.ai
- [ ] Implement client_id URL generation
- [ ] Add fallback to pre-registration for unsupported servers

### Phase 4: User Experience

- [ ] Add OAuth status indicators to MCP server UI
- [ ] Implement "Sign in" / "Sign out" actions
- [ ] Add authentication expiry notifications
- [ ] Create re-authentication flow

### Phase 5: Testing & Documentation

- [ ] Unit tests for OAuth service components
- [ ] Integration tests with mock OAuth server
- [ ] End-to-end tests with real OAuth-enabled MCP servers
- [ ] User documentation for OAuth-enabled servers

## Future Enhancements

- **Automatic token refresh** - Background refresh before expiry
- **Dynamic Client Registration** - Support RFC 7591 for servers that require it
- **Multiple authorization servers** - UI for selecting preferred auth server
- **Enterprise SSO integration** - Support for organization identity providers
- **Token sharing across workspaces** - Optional global token storage
- **Offline token caching** - Support for offline scenarios with cached tokens

## Appendix: MCP Authorization Spec Compliance Checklist

### Required (MUST)

- [ ] Use PKCE with S256 for all authorization requests
- [ ] Include `resource` parameter in authorization and token requests
- [ ] Support WWW-Authenticate header parsing for resource metadata discovery
- [ ] Support well-known URI fallback for resource metadata
- [ ] Support both OAuth 2.0 and OpenID Connect discovery endpoints
- [ ] Use Authorization header with Bearer scheme for token transmission
- [ ] Validate PKCE support before proceeding with authorization

### Recommended (SHOULD)

- [ ] Support Client ID Metadata Documents
- [ ] Use scope from WWW-Authenticate header when provided
- [ ] Fall back to scopes_supported when scope not in challenge
- [ ] Implement step-up authorization for insufficient_scope errors

### Optional (MAY)

- [ ] Support Dynamic Client Registration (RFC 7591)
- [ ] Support pre-registered client credentials
- [ ] Implement token refresh flows

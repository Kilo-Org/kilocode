import * as http from "http"
import * as vscode from "vscode"
import { URL } from "url"

/**
 * Default port for the authorization flow. We try to use this port so that
 * the redirect URI does not change when running on localhost. This is useful
 * for servers that only allow exact matches on the redirect URI. The spec
 * says that the port should not matter, but some servers do not follow
 * the spec and require an exact match.
 *
 * This matches VSCode's default port for consistency.
 */
export const DEFAULT_AUTH_FLOW_PORT = 33418

export interface AuthorizationParams {
	authorizationEndpoint: string
	clientId: string
	redirectUri: string // This might be overridden if we use local server
	scope?: string // Optional - some servers don't support scope
	state: string
	codeChallenge: string
	codeChallengeMethod: "S256"
	resource?: string // Optional - some servers don't support RFC 8707 resource parameter
}

export interface AuthorizationResult {
	code: string
	state: string
	redirectUri: string
}

export class McpOAuthBrowserFlow {
	/**
	 * Opens browser for authorization and waits for callback
	 */
	async authorize(params: AuthorizationParams): Promise<AuthorizationResult> {
		// Try to start local server
		try {
			return await this.authorizeWithLocalServer(params)
		} catch (error) {
			console.warn("Failed to use local server for OAuth, falling back to URI handler", error)
			// Fallback to URI handler would go here
			throw error
		}
	}

	private async authorizeWithLocalServer(params: AuthorizationParams): Promise<AuthorizationResult> {
		return new Promise((resolve, reject) => {
			const server = http.createServer(async (req, res) => {
				try {
					const url = new URL(req.url || "", `http://127.0.0.1:${(server.address() as any).port}`)

					// Accept both root path "/" and "/callback" for compatibility
					if (url.pathname !== "/" && url.pathname !== "/callback") {
						res.writeHead(404)
						res.end("Not Found")
						return
					}

					const code = url.searchParams.get("code")
					const state = url.searchParams.get("state")
					const error = url.searchParams.get("error")

					if (error) {
						res.writeHead(400)
						res.end(`Authentication failed: ${error}`)
						reject(new Error(`OAuth error: ${error}`))
						return
					}

					if (!code || !state) {
						res.writeHead(400)
						res.end("Missing code or state")
						reject(new Error("Missing code or state"))
						return
					}

					// Success response
					res.writeHead(200, { "Content-Type": "text/html" })
					res.end(/* html */ `
	<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width,initial-scale=1">
		<title>Kilo Code - Auth Success</title>
		<style>
			* { margin: 0; padding: 0; box-sizing: border-box; }
			body {
				font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
				background: oklch(21.7% 0.004 107);
				color: oklch(1 0 0 / 90%);
				min-height: 100vh;
				display: flex;
				align-items: center;
				justify-content: center;
			}
			.card {
				background: oklch(28.5% 0 0);
				border-radius: 0.625rem;
				padding: 2rem;
				text-align: center;
				max-width: 320px;
				box-shadow: 0 4px 24px rgba(0,0,0,0.3);
			}
			.icon {
				width: 48px;
				height: 48px;
				background: oklch(63% 0.19 147);
				border-radius: 50%;
				display: flex;
				align-items: center;
				justify-content: center;
				margin: 0 auto 1rem;
			}
			.icon svg {
				width: 24px;
				height: 24px;
				stroke: white;
				stroke-width: 3;
			}
			h1 {
				font-size: 1.25rem;
				font-weight: 600;
				margin-bottom: 0.5rem;
				color: oklch(95% 0.15 108);
			}
			p {
				font-size: 0.875rem;
				color: oklch(1 0 0 / 60%);
			}
			.brand {
				margin-top: 1.5rem;
				font-size: 0.75rem;
				color: oklch(1 0 0 / 40%);
			}
		</style>
	</head>
	<body>
		<div class="card">
			<div class="icon">
				<svg viewBox="0 0 24 24" fill="none">
					<path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			</div>
			<h1>Authentication Successful</h1>
			<p>You can close this window and return to VS Code.</p>
			<div class="brand">Kilo Code</div>
		</div>
		<script>setTimeout(() => window.close(), 1500)</script>
	</body>
	</html>
	`)

					// We need to resolve with the redirectUri that was used.
					// Since we are inside the callback, we know the port.
					// Use root path with trailing slash to match what we sent in the auth request
					const port = (server.address() as any).port
					const redirectUri = `http://127.0.0.1:${port}/`

					resolve({ code, state, redirectUri })
				} catch (e) {
					reject(e)
				} finally {
					server.close()
				}
			})

			const openAuthorizationUrl = async () => {
				const port = (server.address() as any).port
				// Use root path with trailing slash for better compatibility with OAuth servers
				// Some servers (like Cloudflare) expect just the root path, not /callback
				const redirectUri = `http://127.0.0.1:${port}/`

				// Construct auth URL manually to ensure proper encoding
				// Note: URL.searchParams.set() uses application/x-www-form-urlencoded encoding
				// which encodes spaces as '+' but doesn't encode some characters like ':' and '/'
				// We need to use encodeURIComponent() for proper RFC 3986 percent-encoding
				const queryParams = new URLSearchParams()
				queryParams.set("client_id", params.clientId)
				queryParams.set("response_type", "code")
				queryParams.set("code_challenge", params.codeChallenge)
				queryParams.set("code_challenge_method", params.codeChallengeMethod)
				// Manually encode redirect_uri using encodeURIComponent for proper RFC 3986 encoding
				queryParams.set("redirect_uri", redirectUri)
				queryParams.set("state", params.state)
				// Only include scope if it's defined - some servers don't support it
				if (params.scope) {
					queryParams.set("scope", params.scope)
				}
				// Only include resource if it's defined - some servers don't support RFC 8707
				if (params.resource) {
					queryParams.set("resource", params.resource)
				}

				// Build URL manually to ensure redirect_uri is properly encoded
				// The URLSearchParams toString() encodes values, but we need full RFC 3986 encoding
				const queryString = queryParams.toString()

				const authUrl = `${params.authorizationEndpoint}?${queryString}`

				// Log the full authorization URL for debugging
				console.log(`Opening authorization URL: ${authUrl}`)

				// Open browser
				const success = await vscode.env.openExternal(vscode.Uri.parse(authUrl))
				if (!success) {
					server.close()
					reject(new Error("Failed to open browser"))
				}
			}

			server.on("listening", () => {
				openAuthorizationUrl()
			})

			server.on("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE") {
					// Default port is in use, try a random port instead
					console.log(`Port ${DEFAULT_AUTH_FLOW_PORT} is in use, trying a random port...`)
					server.listen(0, "127.0.0.1")
				} else {
					reject(err)
				}
			})

			// Try to use the default port first for consistent redirect_uri
			// This is important because some OAuth servers require exact redirect_uri matches
			// and we registered specific ports during Dynamic Client Registration
			console.log(`Attempting to listen on default OAuth port ${DEFAULT_AUTH_FLOW_PORT}...`)
			server.listen(DEFAULT_AUTH_FLOW_PORT, "127.0.0.1")
		})
	}
}

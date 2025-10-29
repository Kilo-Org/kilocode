import http from "http"
import { URL } from "url"
import * as vscode from "vscode"
import { ContextProxy } from "../../../core/config/ContextProxy"
import {
	DEFAULT_IDCS_CLIENT_ID,
	DEFAULT_IDCS_URL,
	DEFAULT_IDSC_SCOPES,
	DEFAULT_IDCS_PORT_CANDIDATES,
	DEFAULT_USE_PKCE,
} from "./constants"
import {
	discovery,
	buildAuthorizationUrl,
	authorizationCodeGrant,
	randomPKCECodeVerifier,
	calculatePKCECodeChallenge,
	refreshTokenGrant,
	type TokenEndpointResponse,
} from "openid-client"

type TokenRecord = {
	access_token?: string
	refresh_token?: string
	id_token?: string
	token_type?: string
	scope?: string
	expires_in?: number
	expires_at?: number // epoch seconds
}

const SECRET_STORAGE_KEY = "ocaTokenRecord"
const RENEW_TOKEN_BUFFER_SEC = 180

const IDCS_URL = (process.env.IDCS_URL ?? DEFAULT_IDCS_URL).replace(/\/+$/, "")
const CLIENT_ID = process.env.CLIENT_ID ?? DEFAULT_IDCS_CLIENT_ID
const SCOPES = process.env.SCOPES ?? DEFAULT_IDSC_SCOPES
const PORT_CANDIDATES = process.env.PORT ? [Number(process.env.PORT)] : DEFAULT_IDCS_PORT_CANDIDATES
const REDIRECT_URI_TEMPLATE = (port: number) => process.env.REDIRECT_URI ?? `http://localhost:${port}/callback`
const USE_PKCE = String(process.env.USE_PKCE ?? "").toLowerCase() === "false" ? false : DEFAULT_USE_PKCE

if (!IDCS_URL) {
	throw new Error("Missing IDCS_URL environment variable")
}
if (!CLIENT_ID) {
	throw new Error("Missing CLIENT_ID environment variable")
}

/**
 * Manages Oracle Code Assist OAuth tokens:
 * - Secure persistence via SecretStorage (VS Code; bridged in JetBrains)
 * - PKCE auth code flow with local HTTP callback
 * - In-memory caching and refresh with refresh_token
 */
export class OcaTokenManager {
	private static cached: TokenRecord | null = null
	private static inflightLogin: Promise<TokenRecord> | null = null

	private static async save(t: TokenRecord) {
		await ContextProxy.instance.rawContext.secrets.store(SECRET_STORAGE_KEY, JSON.stringify(t))
	}

	private static async load(): Promise<TokenRecord | null> {
		try {
			// First try to read from VS Code Secret Storage
			const json = await ContextProxy.instance.rawContext.secrets.get(SECRET_STORAGE_KEY)
			if (json) {
				return JSON.parse(json) as TokenRecord
			}

			return null
		} catch {
			return null
		}
	}

	private static isValid(t: TokenRecord) {
		const now = Math.floor(Date.now() / 1000)
		return !!t.expires_at && now < t.expires_at - RENEW_TOKEN_BUFFER_SEC
	}

	private static async tryRefresh(token: TokenRecord): Promise<TokenRecord | null> {
		try {
			const discoveryUrl = new URL(`${IDCS_URL}/.well-known/openid-configuration`)
			const config = await discovery(discoveryUrl, CLIENT_ID)
			const res = await refreshTokenGrant(config, token.refresh_token!)
			const nowSec = Math.floor(Date.now() / 1000)
			const next: TokenRecord = {
				access_token: res.access_token,
				refresh_token: res.refresh_token ?? token.refresh_token,
				id_token: res.id_token,
				token_type: res.token_type,
				scope: res.scope,
				expires_in: res.expires_in,
				expires_at: typeof res.expires_in === "number" ? nowSec + res.expires_in : token.expires_at,
			}
			await this.save(next)
			this.cached = next
			return next
		} catch (err) {
			console.error("OCA: refreshTokenGrant failed:", err)
			return null
		}
	}

	public static async getValid(): Promise<TokenRecord | null> {
		let token = this.cached
		if (!token) {
			token = await this.load()
			if (token) this.cached = token
		}

		if (token && this.isValid(token)) {
			return token
		}

		if (token?.refresh_token) {
			const refreshed = await this.tryRefresh(token)
			if (refreshed) return refreshed
		}

		return null
	}

	/**
	 * Interactive login that posts the auth URL to webview and also auto-opens the system browser.
	 * Uses an in-flight guard and persistent cache so the browser opens only once until tokens expire.
	 */
	public static async loginWithoutAutoOpen(postAuthUrl: (url: string) => void): Promise<TokenRecord> {
		// First, try to reuse a valid token (memory or disk)
		const existing = await this.getValid()
		if (existing) return existing

		// If a login is already in progress, await that same flow to prevent multiple browser openings
		if (this.inflightLogin) return this.inflightLogin

		// Start a single login flow and share it with concurrent callers
		this.inflightLogin = this.runInteractiveLogin(postAuthUrl).finally(() => {
			// Clear the in-flight marker once the flow completes
			this.inflightLogin = null
		})

		return this.inflightLogin
	}

	private static async runInteractiveLogin(postAuthUrl: (url: string) => void): Promise<TokenRecord> {
		const discoveryUrl = new URL(`${IDCS_URL}/.well-known/openid-configuration`)
		const config = await discovery(discoveryUrl, CLIENT_ID)

		let code_verifier: string | undefined
		let code_challenge: string | undefined
		if (USE_PKCE) {
			code_verifier = randomPKCECodeVerifier()
			code_challenge = await calculatePKCECodeChallenge(code_verifier)
		}

		// Start a local HTTP server to receive the redirect, with port fallbacks
		const attemptOnPort = (port: number): Promise<TokenEndpointResponse> => {
			return new Promise<TokenEndpointResponse>((resolve, reject) => {
				const redirectUri = REDIRECT_URI_TEMPLATE(port)

				// Build authorization URL for this port
				const authUrl = buildAuthorizationUrl(config, {
					redirect_uri: redirectUri,
					scope: SCOPES,
					...(USE_PKCE && code_challenge ? { code_challenge, code_challenge_method: "S256" as const } : {}),
				})

				const server = http.createServer(async (req, res) => {
					if (!req.url) return

					const host = req.headers.host ?? `localhost:${port}`
					const currentUrl = new URL(req.url, `http://${host}`)
					if (currentUrl.pathname !== "/callback") return

					try {
						const t = await authorizationCodeGrant(
							config,
							currentUrl,
							USE_PKCE && code_verifier ? { pkceCodeVerifier: code_verifier } : {},
						)

						res.statusCode = 200
						res.setHeader("Content-Type", "text/plain")
						res.end("Authentication successful! You can close this window.")
						server.close()
						resolve(t)
					} catch (err) {
						res.statusCode = 400
						res.setHeader("Content-Type", "text/plain")
						res.end("Authentication failed.")
						server.close()
						reject(err)
					}
				})

				server.on("error", (err: any) => {
					if (err?.code === "EADDRINUSE") {
						try {
							server.close()
						} catch {}
						const e = new Error("Port in use")
						;(e as any).code = "EADDRINUSE"
						reject(e)
					} else {
						reject(err)
					}
				})

				server.listen(port, "localhost", () => {
					// Open only once per flow after the server is listening
					try {
						postAuthUrl(authUrl.href)
					} catch (e) {
						console.error("OCA: postAuthUrl callback threw:", e)
					}
					try {
						void vscode.env.openExternal(vscode.Uri.parse(authUrl.href))
					} catch (e) {
						console.error("OCA: failed to openExternal:", e)
					}
				})
			})
		}

		let tokens: TokenEndpointResponse | null = null
		let lastError: unknown = null
		for (const p of PORT_CANDIDATES) {
			try {
				tokens = await attemptOnPort(p)
				break
			} catch (err: any) {
				lastError = err
				if (err?.code === "EADDRINUSE") {
					continue
				}
				throw err
			}
		}
		if (!tokens) {
			throw lastError ?? new Error("Failed to start local callback server on any configured port")
		}

		// Compute expires_at for local validity checks and persist
		const nowSec = Math.floor(Date.now() / 1000)
		const tokenSet: TokenRecord = {
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			id_token: tokens.id_token,
			token_type: tokens.token_type,
			scope: tokens.scope,
			expires_in: tokens.expires_in,
			expires_at: typeof tokens.expires_in === "number" ? nowSec + tokens.expires_in : undefined,
		}

		await this.save(tokenSet)
		this.cached = tokenSet
		return tokenSet
	}

	public static async logout(): Promise<void> {
		try {
			this.cached = null
			this.inflightLogin = null
			try {
				await ContextProxy.instance.rawContext.secrets.delete(SECRET_STORAGE_KEY)
			} catch {}
		} catch (e) {
			console.error("OCA: logout failed:", e)
		}
	}
}

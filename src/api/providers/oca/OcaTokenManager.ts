import http from "http"
import { URL } from "url"
import * as vscode from "vscode"
import { ContextProxy } from "../../../core/config/ContextProxy"
import {
	DEFAULT_INTERNAL_IDCS_CLIENT_ID,
	DEFAULT_INTERNAL_IDCS_URL,
	DEFAULT_INTERNAL_IDCS_SCOPES,
	DEFAULT_INTERNAL_IDCS_PORT_CANDIDATES,
	DEFAULT_INTERNAL_USE_PKCE,
} from "./utils/constants"
import {
	discovery,
	buildAuthorizationUrl,
	authorizationCodeGrant,
	randomPKCECodeVerifier,
	calculatePKCECodeChallenge,
	refreshTokenGrant,
	type TokenEndpointResponse,
} from "openid-client"

type OidcDiscoveryConfig = Awaited<ReturnType<typeof discovery>>

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
const IDCS_URL = DEFAULT_INTERNAL_IDCS_URL.replace(/\/+$/, "")
const REDIRECT_URI_TEMPLATE = (port: number) => `http://localhost:${port}/callback`

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
			const json = await ContextProxy.instance.rawContext.secrets.get(SECRET_STORAGE_KEY)
			if (json) {
				return JSON.parse(json) as TokenRecord
			}

			return null
		} catch {
			return null
		}
	}

	private static async discoveryWithRetry(
		discoveryUrl: URL,
		{
			retries = 3,
			baseDelayMs = 500,
			maxDelayMs = 2000,
		}: { retries?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
	): Promise<OidcDiscoveryConfig> {
		let lastErr: unknown = null
		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				return await discovery(discoveryUrl, DEFAULT_INTERNAL_IDCS_CLIENT_ID)
			} catch (err) {
				if (attempt === retries) {
					lastErr = err
					break
				}
				lastErr = err
				const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt))
				const jitter = 0.5 + Math.random() // 0.5x .. 1.5x
				const delay = Math.round(backoff * jitter)
				await this.sleep(delay)
			}
		}
		console.error("OCA: OIDC discovery failed:", lastErr)
		throw new Error(
			"Only environment variable based proxy settings is supported. PAC/WPAD files (Ex: http://wpad/wpad.dat) are not supported in kilocode. Remove if any WPAD/PAC reference from your IDE proxy settings, restart the IDE, and try again. (Refer OCA Kilo troubleshooting guide.)",
		)
	}

	private static async sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	private static isValid(t: TokenRecord) {
		const now = Math.floor(Date.now() / 1000)
		return !!t.expires_at && now < t.expires_at - RENEW_TOKEN_BUFFER_SEC
	}

	private static async tryRefresh(token: TokenRecord): Promise<TokenRecord | null> {
		try {
			const discoveryUrl = new URL(`${IDCS_URL}/.well-known/openid-configuration`)
			const config = await this.discoveryWithRetry(discoveryUrl)
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

	public static async loginWithoutAutoOpen(postAuthUrl: (url: string) => void): Promise<TokenRecord> {
		const existing = await this.getValid()
		if (existing) return existing

		if (this.inflightLogin) return this.inflightLogin

		this.inflightLogin = this.runInteractiveLogin(postAuthUrl).finally(() => {
			this.inflightLogin = null
		})

		return this.inflightLogin
	}

	private static async runInteractiveLogin(postAuthUrl: (url: string) => void): Promise<TokenRecord> {
		let config
		try {
			const discoveryUrl = new URL(`${IDCS_URL}/.well-known/openid-configuration`)
			config = await this.discoveryWithRetry(discoveryUrl)
		} catch (e: any) {
			if (e instanceof Error) {
				throw e
			}
			throw new Error(formatOcaError(e))
		}

		let code_verifier: string | undefined
		let code_challenge: string | undefined
		if (DEFAULT_INTERNAL_USE_PKCE) {
			code_verifier = randomPKCECodeVerifier()
			code_challenge = await calculatePKCECodeChallenge(code_verifier)
		}

		// Start a local HTTP server to receive the redirect, with port fallbacks
		const attemptOnPort = (port: number): Promise<TokenEndpointResponse> => {
			return new Promise<TokenEndpointResponse>((resolve, reject) => {
				const redirectUri = REDIRECT_URI_TEMPLATE(port)

				const authUrl = buildAuthorizationUrl(config, {
					redirect_uri: redirectUri,
					scope: DEFAULT_INTERNAL_IDCS_SCOPES,
					...(DEFAULT_INTERNAL_USE_PKCE && code_challenge
						? { code_challenge, code_challenge_method: "S256" as const }
						: {}),
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
							DEFAULT_INTERNAL_USE_PKCE && code_verifier ? { pkceCodeVerifier: code_verifier } : {},
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
		for (const p of DEFAULT_INTERNAL_IDCS_PORT_CANDIDATES) {
			try {
				tokens = await attemptOnPort(p)
				break
			} catch (err: any) {
				lastError = err
				if (err?.code === "EADDRINUSE") {
					continue
				}
				throw new Error(formatOcaError(err))
			}
		}
		if (!tokens) {
			throw new Error(
				formatOcaError(lastError ?? new Error("Failed to start local callback server on any configured port")),
			)
		}

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

function formatOcaError(err: unknown): string {
	const anyErr = err as any
	const raw = anyErr?.error_description || anyErr?.message || String(anyErr)
	const msg = typeof raw === "string" ? raw : "Authentication failed. Please try again."
	const lower = msg.toLowerCase()

	if (anyErr?.code === "EADDRINUSE") {
		return "Login failed: local callback port is in use. Close other sign-in attempts or try again."
	}
	if (
		lower.includes("getaddrinfo") ||
		lower.includes("econnrefused") ||
		lower.includes("network") ||
		lower.includes("fetch failed") ||
		lower.includes("dns")
	)
		return "Cannot reach Oracle IDCS. Check Proxy/Internet/VPN connectivity, follow OCA troubleshooting gudlines and try again."
	if (lower.includes("openid-configuration") || lower.includes("well-known"))
		return "Failed to discover identity configuration. Verify the IDCS URL and network connectivity."
	return msg
}

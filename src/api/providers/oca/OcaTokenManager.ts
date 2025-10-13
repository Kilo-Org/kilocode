import http from "http"
import { URL } from "url"
import * as vscode from "vscode"
import fs from "fs/promises"
import path from "path"
import os from "os"
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

const TOKEN_CACHE_PATH = path.join(os.homedir(), ".oca", "token_cache.json")
const RENEW_TOKEN_BUFFER_SEC = 180

/* ==== CONFIG (from environment) ====
   Create a .env file with:
   IDCS_URL="https://<tenant>.identity.oraclecloud.com"
   CLIENT_ID="<client-id>"
   SCOPES="openid profile email offline_access"
   PORT="8090"
   REDIRECT_URI="http://127.0.0.1:8090/callback"
*/
const RAW_IDCS_URL = "https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com"
const RAW_CLIENT_ID = "a8331954c0cf48ba99b5dd223a14c6ea"
const SCOPES = process.env.SCOPES ?? "openid profile email offline_access"
const PORT = Number(process.env.PORT ?? 8669)
const REDIRECT_URI = process.env.REDIRECT_URI ?? `http://localhost:${PORT}/callback`

// Basic validation to avoid "Invalid URL" on placeholders
if (!RAW_IDCS_URL || RAW_IDCS_URL.includes("<")) {
	throw new Error("Missing IDCS_URL environment variable (e.g. https://<tenant>.identity.oraclecloud.com)")
}
if (!RAW_CLIENT_ID || RAW_CLIENT_ID.includes("<")) {
	throw new Error("Missing CLIENT_ID environment variable")
}
const IDCS_URL = RAW_IDCS_URL.replace(/\/+$/, "")
const CLIENT_ID = RAW_CLIENT_ID

export class OcaTokenManager {
	private static cached: TokenRecord | null = null
	private static inflightLogin: Promise<TokenRecord> | null = null

	// --------- cache helpers ----------
	private static async save(t: TokenRecord) {
		await fs.mkdir(path.dirname(TOKEN_CACHE_PATH), { recursive: true })
		await fs.writeFile(TOKEN_CACHE_PATH, JSON.stringify(t), "utf-8")
	}

	private static async load(): Promise<TokenRecord | null> {
		try {
			return JSON.parse(await fs.readFile(TOKEN_CACHE_PATH, "utf-8")) as TokenRecord
		} catch {
			return null
		}
	}

	private static isValid(t: TokenRecord) {
		const now = Math.floor(Date.now() / 1000)
		return !!t.expires_at && now < t.expires_at - RENEW_TOKEN_BUFFER_SEC
	}
	// -----------------------------------

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
		// Discover AS metadata and create a client configuration (v6 API)
		const discoveryUrl = new URL(`${IDCS_URL}/.well-known/openid-configuration`)
		const config = await discovery(discoveryUrl, CLIENT_ID)
		console.log("Discovered issuer:", config.serverMetadata().issuer)

		// PKCE values using v6 helpers
		const code_verifier = randomPKCECodeVerifier()
		const code_challenge = await calculatePKCECodeChallenge(code_verifier)

		// Build authorization URL (v6 API)
		const authUrl = buildAuthorizationUrl(config, {
			redirect_uri: REDIRECT_URI,
			scope: SCOPES,
			code_challenge,
			code_challenge_method: "S256",
		})

		// Note: URL parameters are percent-encoded per RFC 3986.
		console.log("Authorization URL (encoded):", authUrl.href)
		console.log("Redirect URI param (decoded):", authUrl.searchParams.get("redirect_uri"))

		// Start a local HTTP server to receive the redirect
		const tokens = await new Promise<TokenEndpointResponse>((resolve, reject) => {
			const server = http.createServer(async (req, res) => {
				if (!req.url) return

				const host = req.headers.host ?? `localhost:${PORT}`
				const currentUrl = new URL(req.url, `http://${host}`)
				if (currentUrl.pathname !== "/callback") return

				try {
					// Exchange code for tokens (v6 API)
					const t = await authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier: code_verifier })

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

			server.listen(PORT, "localhost", () => {
				console.log(`Listening for callback at ${REDIRECT_URI}`)
				// Open only once per flow after the server is listening
				try {
					postAuthUrl(authUrl.href)
				} catch (e) {
					console.error("OCA: postAuthUrl callback threw:", e)
				}
				try {
					console.log("Opening browser for IDCS login...")
					void vscode.env.openExternal(vscode.Uri.parse(authUrl.href))
				} catch (e) {
					console.error("OCA: failed to openExternal:", e)
				}
			})
			server.on("error", reject)
		})

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
			// Clear in-memory state
			this.cached = null
			this.inflightLogin = null
			// Remove cached token file
			try {
				await fs.rm(TOKEN_CACHE_PATH, { force: true })
			} catch {}
		} catch (e) {
			console.error("OCA: logout failed:", e)
		}
	}
}

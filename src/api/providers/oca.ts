import type * as vscode from "vscode"
import { OcaTokenManager } from "./oca/OcaTokenManager"
import { DEFAULT_OCA_BASE_URL } from "./oca/constants"

/**
 * - Single Responsibility: token acquisition vs. auth header construction are separated.
 * - Dependency Inversion: callers can inject a custom token source (e.g., for tests).
 * - Clear contracts and typed callbacks; no hidden side effects.
 */

/**
 * Callback used to publish the interactive authorization URL
 * (e.g., posted to Webview where the browser is opened).
 */
export type PostAuthUrl = (url: string) => void

/**
 * Minimal token shape required by this module.
 * Do not depend on OcaTokenManager's internal TokenRecord type.
 */
export interface OcaTokenShape {
	access_token?: string
}

/**
 * Abstraction over the token provider to enable testing, mocking, or alternative implementations.
 */
export interface OcaTokenSource {
	getValid(): Promise<OcaTokenShape | null>
	loginWithoutAutoOpen(postAuthUrl: PostAuthUrl): Promise<OcaTokenShape>
}

/**
 * Default implementation backed by OcaTokenManager.
 */
export const DefaultOcaTokenSource: OcaTokenSource = {
	getValid: () => OcaTokenManager.getValid(),
	loginWithoutAutoOpen: (postAuthUrl: PostAuthUrl) => OcaTokenManager.loginWithoutAutoOpen(postAuthUrl),
}

/**
 * Resolve the base URL for Oracle Code Assist API.
 * Reads from environment (OCA_API_BASE) with a safe fallback to DEFAULT_OCA_BASE_URL.
 */
export function resolveOcaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
	return env.OCA_API_BASE ?? DEFAULT_OCA_BASE_URL
}

/**
 * Acquire an access token using the provided token source.
 * - If a valid token is already available, returns it.
 * - Otherwise triggers the interactive login flow via the provided postAuthUrl callback.
 *
 * This function is intentionally decoupled from VS Code context to uphold DIP.
 */
export async function getOcaAccessToken(
	postAuthUrl: PostAuthUrl,
	tokenSource: OcaTokenSource = DefaultOcaTokenSource,
): Promise<string> {
	const valid = await tokenSource.getValid()
	if (valid?.access_token) return valid.access_token

	// Interactive login; requires a callback to surface the auth URL to the UI
	const tokens = await tokenSource.loginWithoutAutoOpen(postAuthUrl)
	if (!tokens?.access_token) {
		throw new Error("OCA login did not return an access token")
	}
	return tokens.access_token
}

/**
 * Build auth configuration (baseUrl and headers) for OCA API calls.
 * Behavior:
 * - Does not mutate process state; returns a pure object with baseUrl + headers.
 * - Respects dependency inversion via tokenSource and baseUrl overrides.
 */
export async function buildOcaAuthConfig(options: {
	postAuthUrl: PostAuthUrl
	tokenSource?: OcaTokenSource
	baseUrl?: string
}): Promise<{ baseUrl: string; headers: Record<string, string> }> {
	const { postAuthUrl, tokenSource = DefaultOcaTokenSource } = options
	const accessToken = await getOcaAccessToken(postAuthUrl, tokenSource)
	const baseUrl = options.baseUrl ?? resolveOcaBaseUrl()
	return {
		baseUrl,
		headers: { Authorization: `Bearer ${accessToken}` },
	}
}

/* =========================
   Backward-compatible API
   ========================= */

/**
 * Legacy helper kept for compatibility.
 * Note: VS Code ExtensionContext is not needed for token acquisition and is ignored.
 */
export async function ensureOcaTokenAndGetAccessToken(
	_context: vscode.ExtensionContext,
	postAuthUrl: PostAuthUrl,
): Promise<string> {
	return getOcaAccessToken(postAuthUrl, DefaultOcaTokenSource)
}

/**
 * Legacy helper kept for compatibility.
 * Returns baseUrl and Authorization header for OCA requests.
 */
export async function buildOcaAuth(
	_context: vscode.ExtensionContext,
	postAuthUrl: PostAuthUrl,
): Promise<{ baseUrl: string; headers: Record<string, string> }> {
	return buildOcaAuthConfig({ postAuthUrl, tokenSource: DefaultOcaTokenSource, baseUrl: resolveOcaBaseUrl() })
}

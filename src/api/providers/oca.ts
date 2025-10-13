import * as vscode from "vscode"
import { OcaTokenManager } from "./oca/OcaTokenManager"
import { DEFAULT_OCA_BASE_URL } from "./oca/constants"

const SECRET_KEY = "ocaTokenSet"

export type OcaStoredToken = { accessToken?: string; refreshToken?: string; expiresAt?: number }

export async function ensureOcaTokenAndGetAccessToken(
	context: vscode.ExtensionContext,
	postAuthUrl: (url: string) => void,
) {
	// try refresh/cached
	const valid = await OcaTokenManager.getValid()
	if (valid?.access_token) return valid.access_token

	// no token → run login flow (no auto-open)
	const tokens = await OcaTokenManager.loginWithoutAutoOpen(postAuthUrl)

	const stored: OcaStoredToken = {
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresAt: tokens.expires_at,
	}

	await context.secrets.store(SECRET_KEY, JSON.stringify(stored))
	return stored.accessToken!
}

/**
 * Hook this where you create fetch clients for the active provider.
 * Returns headers and baseUrl you can plug into your existing request path.
 */
export async function buildOcaAuth(context: vscode.ExtensionContext, postAuthUrl: (url: string) => void) {
	const accessToken = await ensureOcaTokenAndGetAccessToken(context, postAuthUrl)
	const baseUrl = process.env.OCA_API_BASE ?? DEFAULT_OCA_BASE_URL
	return {
		baseUrl,
		headers: { Authorization: `Bearer ${accessToken}` },
	}
}

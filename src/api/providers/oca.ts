import type * as vscode from "vscode"
import { OcaTokenManager } from "./oca/OcaTokenManager"
import { DEFAULT_OCA_BASE_URL } from "./oca/constants"

/**
 * Ensures a valid OCA access token is available.
 * - Checks in-memory and SecretStorage via OcaTokenManager.getValid()
 * - If not available, performs interactive login without auto-opening beyond a single flow
 * - Does not write any additional secrets; OcaTokenManager is the single source of truth
 */
export async function ensureOcaTokenAndGetAccessToken(
	_context: vscode.ExtensionContext,
	postAuthUrl: (url: string) => void,
): Promise<string> {
	const valid = await OcaTokenManager.getValid()
	if (valid?.access_token) return valid.access_token

	const tokens = await OcaTokenManager.loginWithoutAutoOpen(postAuthUrl)
	return tokens.access_token!
}

/**
 * Returns baseUrl and Authorization headers for OCA requests.
 * Uses environment override OCA_API_BASE when provided, otherwise falls back to DEFAULT_OCA_BASE_URL.
 */
export async function buildOcaAuth(
	context: vscode.ExtensionContext,
	postAuthUrl: (url: string) => void,
): Promise<{ baseUrl: string; headers: Record<string, string> }> {
	const accessToken = await ensureOcaTokenAndGetAccessToken(context, postAuthUrl)
	const baseUrl = process.env.OCA_API_BASE ?? DEFAULT_OCA_BASE_URL
	return {
		baseUrl,
		headers: { Authorization: `Bearer ${accessToken}` },
	}
}

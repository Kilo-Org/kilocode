import type * as vscode from "vscode"
import { OcaTokenManager } from "./oca/OcaTokenManager"
import { DEFAULT_OCA_BASE_URL } from "./oca/utils/constants"

/**
 * Callback used to publish the interactive authorization URL
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

export const DefaultOcaTokenSource: OcaTokenSource = {
	getValid: () => OcaTokenManager.getValid(),
	loginWithoutAutoOpen: (postAuthUrl: PostAuthUrl) => OcaTokenManager.loginWithoutAutoOpen(postAuthUrl),
}

export function resolveOcaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
	return env.OCA_API_BASE ?? DEFAULT_OCA_BASE_URL
}

export async function getOcaAccessToken(
	postAuthUrl: PostAuthUrl,
	tokenSource: OcaTokenSource = DefaultOcaTokenSource,
): Promise<string> {
	const valid = await tokenSource.getValid()
	if (valid?.access_token) return valid.access_token

	const tokens = await tokenSource.loginWithoutAutoOpen(postAuthUrl)
	if (!tokens?.access_token) {
		throw new Error("OCA login did not return an access token")
	}
	return tokens.access_token
}

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

export async function ensureOcaTokenAndGetAccessToken(
	_context: vscode.ExtensionContext,
	postAuthUrl: PostAuthUrl,
): Promise<string> {
	return getOcaAccessToken(postAuthUrl, DefaultOcaTokenSource)
}

export async function buildOcaAuth(
	_context: vscode.ExtensionContext,
	postAuthUrl: PostAuthUrl,
): Promise<{ baseUrl: string; headers: Record<string, string> }> {
	return buildOcaAuthConfig({ postAuthUrl, tokenSource: DefaultOcaTokenSource, baseUrl: resolveOcaBaseUrl() })
}

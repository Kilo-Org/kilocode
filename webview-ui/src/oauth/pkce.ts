/**
 * PKCE (Proof Key for Code Exchange) utilities
 * Used for OAuth flows that require code challenge/verifier
 *
 * PKCE is a security extension to OAuth 2.0 that prevents authorization code interception attacks.
 *
 * Currently used by:
 * - TARS (Tetrate Agent Router Service) - requires PKCE for OAuth authentication
 */

/**
 * Generate a cryptographically random code verifier
 * @returns Base64URL encoded random string (43-128 characters)
 */
export function generateCodeVerifier(): string {
	const array = new Uint8Array(32)
	crypto.getRandomValues(array)
	return base64UrlEncode(array)
}

/**
 * Generate SHA-256 hash of the code verifier
 * @param verifier - The code verifier string
 * @returns Base64URL encoded SHA-256 hash
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(verifier)
	const hash = await crypto.subtle.digest("SHA-256", data)
	return base64UrlEncode(new Uint8Array(hash))
}

/**
 * Base64URL encode a Uint8Array
 * @param buffer - The buffer to encode
 * @returns Base64URL encoded string
 */
function base64UrlEncode(buffer: Uint8Array): string {
	const base64 = btoa(String.fromCharCode(...buffer))
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Generate both code verifier and challenge for PKCE flow
 * @returns Object containing verifier and challenge
 */
export async function generatePKCEPair(): Promise<{ verifier: string; challenge: string }> {
	const verifier = generateCodeVerifier()
	const challenge = await generateCodeChallenge(verifier)
	return { verifier, challenge }
}

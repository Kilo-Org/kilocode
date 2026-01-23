import * as crypto from "crypto"

/**
 * Generates a cryptographically random PKCE code verifier
 * Must be 43-128 characters long using unreserved characters
 */
export function generateCodeVerifier(): string {
	// Generate 32 random bytes and encode as base64url (will be 43 characters)
	const buffer = crypto.randomBytes(32)
	return buffer.toString("base64url")
}

/**
 * Generates the PKCE code challenge from the verifier using S256 method
 */
export function generateCodeChallenge(verifier: string): string {
	const hash = crypto.createHash("sha256").update(verifier).digest()
	return hash.toString("base64url")
}

/**
 * Generates a random state parameter for CSRF protection
 */
export function generateState(): string {
	return crypto.randomBytes(32).toString("base64url")
}

/**
 * Parses the WWW-Authenticate header to extract the resource metadata URL
 * Header format example: Bearer realm="example", resource_metadata="https://..."
 */
export function parseWwwAuthenticateHeader(header: string): string | null {
	// Look for resource_metadata="url" or resource_metadata=url
	const match = header.match(/resource_metadata="?([^",\s]+)"?/)
	return match ? match[1] : null
}

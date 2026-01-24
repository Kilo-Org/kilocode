// kilocode_change - new file
/**
 * Unit tests for MCP OAuth utilities
 */

import { generateCodeVerifier, generateCodeChallenge, generateState, parseWwwAuthenticateHeader } from "../utils"

describe("MCP OAuth Utils", () => {
	describe("generateCodeVerifier", () => {
		it("should generate a string of the expected length", () => {
			const verifier = generateCodeVerifier()
			// 32 bytes base64url encoded = 43 characters
			expect(verifier.length).toBe(43)
		})

		it("should generate unique verifiers", () => {
			const verifier1 = generateCodeVerifier()
			const verifier2 = generateCodeVerifier()
			expect(verifier1).not.toBe(verifier2)
		})

		it("should only contain base64url-safe characters", () => {
			const verifier = generateCodeVerifier()
			// Base64url uses A-Z, a-z, 0-9, -, _
			expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
		})
	})

	describe("generateCodeChallenge", () => {
		it("should generate a valid S256 challenge from a verifier", () => {
			const verifier = generateCodeVerifier()
			const challenge = generateCodeChallenge(verifier)

			// SHA-256 hash base64url encoded = 43 characters
			expect(challenge.length).toBe(43)
		})

		it("should generate different challenges for different verifiers", () => {
			const verifier1 = generateCodeVerifier()
			const verifier2 = generateCodeVerifier()

			const challenge1 = generateCodeChallenge(verifier1)
			const challenge2 = generateCodeChallenge(verifier2)

			expect(challenge1).not.toBe(challenge2)
		})

		it("should generate consistent challenge for the same verifier", () => {
			const verifier = "test-verifier-12345"
			const challenge1 = generateCodeChallenge(verifier)
			const challenge2 = generateCodeChallenge(verifier)

			expect(challenge1).toBe(challenge2)
		})

		it("should only contain base64url-safe characters", () => {
			const verifier = generateCodeVerifier()
			const challenge = generateCodeChallenge(verifier)
			// Base64url uses A-Z, a-z, 0-9, -, _
			expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
		})
	})

	describe("generateState", () => {
		it("should generate a string of the expected length", () => {
			const state = generateState()
			// 32 bytes base64url encoded = 43 characters
			expect(state.length).toBe(43)
		})

		it("should generate unique states", () => {
			const state1 = generateState()
			const state2 = generateState()
			expect(state1).not.toBe(state2)
		})

		it("should only contain base64url-safe characters", () => {
			const state = generateState()
			// Base64url uses A-Z, a-z, 0-9, -, _
			expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
		})
	})

	describe("parseWwwAuthenticateHeader", () => {
		it("should extract resource_metadata URL from Bearer challenge", () => {
			const header = 'Bearer realm="example", resource_metadata="https://example.com/.well-known/resource"'
			const result = parseWwwAuthenticateHeader(header)

			expect(result).toBe("https://example.com/.well-known/resource")
		})

		it("should extract resource_metadata URL without quotes", () => {
			const header = "Bearer realm=api, resource_metadata=https://example.com/.well-known/resource"
			const result = parseWwwAuthenticateHeader(header)

			expect(result).toBe("https://example.com/.well-known/resource")
		})

		it("should return null when no resource_metadata is present", () => {
			const header = 'Bearer realm="api", error="invalid_token"'
			const result = parseWwwAuthenticateHeader(header)

			expect(result).toBeNull()
		})

		it("should return null for empty header", () => {
			const result = parseWwwAuthenticateHeader("")

			expect(result).toBeNull()
		})

		it("should return null for header with only scheme", () => {
			const result = parseWwwAuthenticateHeader("Bearer")

			expect(result).toBeNull()
		})

		it("should handle complex resource_metadata URLs", () => {
			const header =
				'Bearer resource_metadata="https://api.example.com/oauth/.well-known/oauth-protected-resource"'
			const result = parseWwwAuthenticateHeader(header)

			expect(result).toBe("https://api.example.com/oauth/.well-known/oauth-protected-resource")
		})

		it("should extract resource_metadata when it appears first", () => {
			const header = 'Bearer resource_metadata="https://example.com/resource", realm="api"'
			const result = parseWwwAuthenticateHeader(header)

			expect(result).toBe("https://example.com/resource")
		})

		it("should handle URLs with query parameters", () => {
			const header = 'Bearer resource_metadata="https://example.com/.well-known/resource?version=1"'
			const result = parseWwwAuthenticateHeader(header)

			expect(result).toBe("https://example.com/.well-known/resource?version=1")
		})
	})
})

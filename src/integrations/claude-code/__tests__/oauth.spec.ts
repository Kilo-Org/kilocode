import {
	generateCodeVerifier,
	generateCodeChallenge,
	generateState,
	generateUserId,
	buildAuthorizationUrl,
	isTokenExpired,
	CLAUDE_CODE_OAUTH_CONFIG,
	type ClaudeCodeCredentials,
} from "../oauth"

describe("Claude Code OAuth", () => {
	describe("generateCodeVerifier", () => {
		test("should generate a base64url encoded verifier", () => {
			const verifier = generateCodeVerifier()
			// Base64url encoded 32 bytes = 43 characters
			expect(verifier).toHaveLength(43)
			// Should only contain base64url safe characters
			expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
		})

		test("should generate unique verifiers on each call", () => {
			const verifier1 = generateCodeVerifier()
			const verifier2 = generateCodeVerifier()
			expect(verifier1).not.toBe(verifier2)
		})
	})

	describe("generateCodeChallenge", () => {
		test("should generate a base64url encoded SHA256 hash", () => {
			const verifier = "test-verifier-string"
			const challenge = generateCodeChallenge(verifier)
			// Base64url encoded SHA256 hash = 43 characters
			expect(challenge).toHaveLength(43)
			// Should only contain base64url safe characters
			expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
		})

		test("should generate consistent challenge for same verifier", () => {
			const verifier = "test-verifier-string"
			const challenge1 = generateCodeChallenge(verifier)
			const challenge2 = generateCodeChallenge(verifier)
			expect(challenge1).toBe(challenge2)
		})

		test("should generate different challenges for different verifiers", () => {
			const challenge1 = generateCodeChallenge("verifier1")
			const challenge2 = generateCodeChallenge("verifier2")
			expect(challenge1).not.toBe(challenge2)
		})
	})

	describe("generateState", () => {
		test("should generate a 32-character hex string", () => {
			const state = generateState()
			expect(state).toHaveLength(32) // 16 bytes = 32 hex chars
			expect(state).toMatch(/^[0-9a-f]+$/)
		})

		test("should generate unique states on each call", () => {
			const state1 = generateState()
			const state2 = generateState()
			expect(state1).not.toBe(state2)
		})
	})

	describe("generateUserId", () => {
		test("should generate user ID with correct format", () => {
			const userId = generateUserId()
			// Format: user_<16 hex>_account_<32 hex>_session_<32 hex>
			expect(userId).toMatch(/^user_[0-9a-f]{16}_account_[0-9a-f]{32}_session_[0-9a-f]{32}$/)
		})

		test("should generate unique session IDs on each call", () => {
			const userId1 = generateUserId()
			const userId2 = generateUserId()
			// Full IDs should be different due to random session UUID
			expect(userId1).not.toBe(userId2)
		})

		test("should generate deterministic user hash and account UUID from email", () => {
			const email = "test@example.com"
			const userId1 = generateUserId(email)
			const userId2 = generateUserId(email)

			// Extract user and account parts (everything except session)
			const userAccount1 = userId1.replace(/_session_[0-9a-f]{32}$/, "")
			const userAccount2 = userId2.replace(/_session_[0-9a-f]{32}$/, "")

			// User hash and account UUID should be deterministic for same email
			expect(userAccount1).toBe(userAccount2)

			// But session UUID should be different
			const session1 = userId1.match(/_session_([0-9a-f]{32})$/)?.[1]
			const session2 = userId2.match(/_session_([0-9a-f]{32})$/)?.[1]
			expect(session1).not.toBe(session2)
		})

		test("should generate different user hash for different emails", () => {
			const userId1 = generateUserId("user1@example.com")
			const userId2 = generateUserId("user2@example.com")

			const userHash1 = userId1.match(/^user_([0-9a-f]{16})_/)?.[1]
			const userHash2 = userId2.match(/^user_([0-9a-f]{16})_/)?.[1]

			expect(userHash1).not.toBe(userHash2)
		})

		test("should generate random user hash and account UUID without email", () => {
			const userId1 = generateUserId()
			const userId2 = generateUserId()

			// Without email, even user hash should be different each call
			const userHash1 = userId1.match(/^user_([0-9a-f]{16})_/)?.[1]
			const userHash2 = userId2.match(/^user_([0-9a-f]{16})_/)?.[1]

			// Extremely unlikely to be the same (random 8 bytes)
			expect(userHash1).not.toBe(userHash2)
		})
	})

	describe("buildAuthorizationUrl", () => {
		test("should build correct authorization URL with all parameters", () => {
			const codeChallenge = "test-code-challenge"
			const state = "test-state"
			const url = buildAuthorizationUrl(codeChallenge, state)

			const parsedUrl = new URL(url)
			expect(parsedUrl.origin + parsedUrl.pathname).toBe(CLAUDE_CODE_OAUTH_CONFIG.authorizationEndpoint)

			const params = parsedUrl.searchParams
			expect(params.get("client_id")).toBe(CLAUDE_CODE_OAUTH_CONFIG.clientId)
			expect(params.get("redirect_uri")).toBe(CLAUDE_CODE_OAUTH_CONFIG.redirectUri)
			expect(params.get("scope")).toBe(CLAUDE_CODE_OAUTH_CONFIG.scopes)
			expect(params.get("code_challenge")).toBe(codeChallenge)
			expect(params.get("code_challenge_method")).toBe("S256")
			expect(params.get("response_type")).toBe("code")
			expect(params.get("state")).toBe(state)
		})
	})

	describe("isTokenExpired", () => {
		test("should return false for non-expired token", () => {
			const futureDate = new Date(Date.now() + 60 * 60 * 1000) // 1 hour in future
			const credentials: ClaudeCodeCredentials = {
				type: "claude",
				access_token: "test-token",
				refresh_token: "test-refresh",
				expired: futureDate.toISOString(),
			}
			expect(isTokenExpired(credentials)).toBe(false)
		})

		test("should return true for expired token", () => {
			const pastDate = new Date(Date.now() - 60 * 60 * 1000) // 1 hour in past
			const credentials: ClaudeCodeCredentials = {
				type: "claude",
				access_token: "test-token",
				refresh_token: "test-refresh",
				expired: pastDate.toISOString(),
			}
			expect(isTokenExpired(credentials)).toBe(true)
		})

		test("should return true for token expiring within 5 minute buffer", () => {
			const almostExpired = new Date(Date.now() + 3 * 60 * 1000) // 3 minutes in future (within 5 min buffer)
			const credentials: ClaudeCodeCredentials = {
				type: "claude",
				access_token: "test-token",
				refresh_token: "test-refresh",
				expired: almostExpired.toISOString(),
			}
			expect(isTokenExpired(credentials)).toBe(true)
		})

		test("should return false for token expiring after 5 minute buffer", () => {
			const notYetExpiring = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes in future
			const credentials: ClaudeCodeCredentials = {
				type: "claude",
				access_token: "test-token",
				refresh_token: "test-refresh",
				expired: notYetExpiring.toISOString(),
			}
			expect(isTokenExpired(credentials)).toBe(false)
		})
	})

	describe("CLAUDE_CODE_OAUTH_CONFIG", () => {
		test("should have correct configuration values", () => {
			expect(CLAUDE_CODE_OAUTH_CONFIG.authorizationEndpoint).toBe("https://claude.ai/oauth/authorize")
			expect(CLAUDE_CODE_OAUTH_CONFIG.tokenEndpoint).toBe("https://console.anthropic.com/v1/oauth/token")
			expect(CLAUDE_CODE_OAUTH_CONFIG.clientId).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e")
			expect(CLAUDE_CODE_OAUTH_CONFIG.redirectUri).toBe("http://localhost:54545/callback")
			expect(CLAUDE_CODE_OAUTH_CONFIG.scopes).toBe("org:create_api_key user:profile user:inference")
			expect(CLAUDE_CODE_OAUTH_CONFIG.callbackPort).toBe(54545)
		})
	})

	describe("refresh token behavior", () => {
		afterEach(() => {
			vi.unstubAllGlobals()
		})

		test("refresh responses may omit refresh_token (should be tolerated)", async () => {
			const { refreshAccessToken } = await import("../oauth")

			// Mock fetch to return a refresh response with no refresh_token
			const mockFetch = vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						access_token: "new-access",
						expires_in: 3600,
						// refresh_token intentionally omitted
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			)

			vi.stubGlobal("fetch", mockFetch)

			const creds: ClaudeCodeCredentials = {
				type: "claude" as const,
				access_token: "old-access",
				refresh_token: "old-refresh",
				expired: new Date(Date.now() - 1000).toISOString(),
				email: "test@example.com",
			}

			const refreshed = await refreshAccessToken(creds)
			expect(refreshed.access_token).toBe("new-access")
			expect(refreshed.refresh_token).toBe("old-refresh")
			expect(refreshed.email).toBe("test@example.com")
		})
	})
})

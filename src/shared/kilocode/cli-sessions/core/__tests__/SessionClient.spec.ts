import { SessionClient, CliSessionSharedState } from "../SessionClient"
import type { TrpcClient } from "../TrpcClient"

// Mock getApiUrl
vi.mock("@roo-code/types", () => ({
	getApiUrl: vi.fn().mockReturnValue("https://api.example.com"),
}))

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("SessionClient", () => {
	let client: SessionClient
	let mockTrpcClient: TrpcClient

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset environment
		delete process.env.KILO_PLATFORM

		// Mock TrpcClient
		mockTrpcClient = {
			request: vi.fn() as any,
			endpoint: "https://api.example.com",
			getToken: vi.fn().mockResolvedValue("mock-token"),
		} as TrpcClient

		client = new SessionClient(mockTrpcClient)
	})

	describe("CRUD Operations", () => {
		describe("get", () => {
			it("calls trpcClient.request with correct params", async () => {
				const input = { session_id: "test-session", include_blob_urls: true }
				const expectedOutput = { session_id: "test-session", title: "Test" }

				;(mockTrpcClient.request as any).mockResolvedValue(expectedOutput)

				await client.get(input)

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.get", "GET", input)
			})

			it("returns session data", async () => {
				const input = { session_id: "test-session" }
				const expectedOutput = { session_id: "test-session", title: "Test" }

				;(mockTrpcClient.request as any).mockResolvedValue(expectedOutput)

				const result = await client.get(input)

				expect(result).toEqual(expectedOutput)
			})
		})

		describe("create", () => {
			it("calls trpcClient.request with correct params", async () => {
				const input = {
					title: "Test Session",
					created_on_platform: "cli",
					version: 1,
				}

				;(mockTrpcClient.request as any).mockResolvedValue({ session_id: "new-session" })

				await client.create(input)

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.createV2", "POST", input)
			})

			it("uses KILO_PLATFORM env var when set", async () => {
				process.env.KILO_PLATFORM = "test-platform"

				const input = {
					title: "Test Session",
					created_on_platform: "cli",
				}

				;(mockTrpcClient.request as any).mockResolvedValue({ session_id: "new-session" })

				await client.create(input)

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.createV2", "POST", {
					...input,
					created_on_platform: "test-platform",
				})
			})
		})

		describe("update", () => {
			it("calls trpcClient.request with correct params", async () => {
				const input = {
					session_id: "test-session",
					title: "Updated Title",
				}

				;(mockTrpcClient.request as any).mockResolvedValue({
					session_id: "test-session",
					title: "Updated Title",
				})

				await client.update(input)

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.update", "POST", input)
			})
		})

		describe("list", () => {
			it("calls trpcClient.request with correct params", async () => {
				const input = { cursor: "next", limit: 10 }

				;(mockTrpcClient.request as any).mockResolvedValue({ cliSessions: [], nextCursor: null })

				await client.list(input)

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.list", "GET", input)
			})

			it("handles empty input", async () => {
				;(mockTrpcClient.request as any).mockResolvedValue({ cliSessions: [], nextCursor: null })

				await client.list()

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.list", "GET", {})
			})
		})

		describe("search", () => {
			it("calls trpcClient.request with correct params", async () => {
				const input = { search_string: "test", limit: 5 }

				;(mockTrpcClient.request as any).mockResolvedValue({ results: [], total: 0, limit: 5, offset: 0 })

				await client.search(input)

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.search", "GET", input)
			})
		})

		describe("share", () => {
			it("calls trpcClient.request with correct params", async () => {
				const input = { session_id: "test-session", shared_state: CliSessionSharedState.Public }

				;(mockTrpcClient.request as any).mockResolvedValue({
					share_id: "share-123",
					session_id: "test-session",
				})

				await client.share(input)

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.share", "POST", input)
			})
		})

		describe("fork", () => {
			it("calls trpcClient.request with correct params", async () => {
				const input = { share_or_session_id: "share-123", created_on_platform: "cli" }

				;(mockTrpcClient.request as any).mockResolvedValue({ session_id: "forked-session" })

				await client.fork(input)

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.fork", "POST", input)
			})
		})

		describe("delete", () => {
			it("calls trpcClient.request with correct params", async () => {
				const input = { session_id: "test-session" }

				;(mockTrpcClient.request as any).mockResolvedValue({ success: true, session_id: "test-session" })

				await client.delete(input)

				expect(mockTrpcClient.request).toHaveBeenCalledWith("cliSessions.delete", "POST", input)
			})
		})
	})

	describe("Blob Upload", () => {
		describe("uploadBlob", () => {
			it("gets signed URL and uploads", async () => {
				const sessionId = "test-session"
				const blobType = "ui_messages" as const
				const blobData = { messages: [] }
				const signedUrl = "https://signed-url.com"
				const updatedAt = "2023-01-01T00:00:00Z"

				// Mock signed URL response
				mockFetch.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ signed_url: signedUrl, updated_at: updatedAt }),
				})

				// Mock upload response
				mockFetch.mockResolvedValueOnce({
					ok: true,
				})

				const result = await client.uploadBlob(sessionId, blobType, blobData)

				expect(result).toEqual({ updated_at: updatedAt })
				expect(mockFetch).toHaveBeenCalledTimes(2)
			})

			it("calculates correct content length", async () => {
				const sessionId = "test-session"
				const blobType = "api_conversation_history" as const
				const blobData = { history: ["test"] }
				const expectedContentLength = JSON.stringify(blobData).length

				mockFetch.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({
						signed_url: "https://signed-url.com",
						updated_at: "2023-01-01T00:00:00Z",
					}),
				})

				mockFetch.mockResolvedValueOnce({
					ok: true,
				})

				await client.uploadBlob(sessionId, blobType, blobData)

				// Check that the POST to get signed URL includes correct content length
				const signedUrlCall = mockFetch.mock.calls[0]
				const requestBody = JSON.parse(signedUrlCall[1].body)
				expect(requestBody.content_length).toBe(expectedContentLength)
			})

			it("throws on signed URL failure", async () => {
				const sessionId = "test-session"
				const blobType = "task_metadata" as const
				const blobData = { metadata: {} }

				mockFetch.mockResolvedValueOnce({
					ok: false,
					status: 500,
				})

				await expect(client.uploadBlob(sessionId, blobType, blobData)).rejects.toThrow(
					"getSignedUploadUrl failed",
				)
			})

			it("throws on upload failure", async () => {
				const sessionId = "test-session"
				const blobType = "git_state" as const
				const blobData = { git: {} }

				mockFetch.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({
						signed_url: "https://signed-url.com",
						updated_at: "2023-01-01T00:00:00Z",
					}),
				})

				mockFetch.mockResolvedValueOnce({
					ok: false,
					status: 403,
				})

				await expect(client.uploadBlob(sessionId, blobType, blobData)).rejects.toThrow(
					"uploadBlob failed: upload to signed URL returned 403",
				)
			})

			it("returns updated_at timestamp", async () => {
				const sessionId = "test-session"
				const blobType = "ui_messages" as const
				const blobData = { messages: [] }
				const updatedAt = "2023-01-01T12:00:00Z"

				mockFetch.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ signed_url: "https://signed-url.com", updated_at: updatedAt }),
				})

				mockFetch.mockResolvedValueOnce({
					ok: true,
				})

				const result = await client.uploadBlob(sessionId, blobType, blobData)

				expect(result).toEqual({ updated_at: updatedAt })
			})
		})
	})

	describe("Token Validation", () => {
		describe("tokenValid", () => {
			it("returns true for valid token", async () => {
				const validToken =
					"header.eyJraWxvVXNlcklkIjoidGVzdC11c2VyIiwidmVyc2lvbiI6MSwiZXhwIjoyMDAwMDAwMDAwfQ.signature"

				;(mockTrpcClient.getToken as any).mockResolvedValue(validToken)

				mockFetch.mockResolvedValueOnce({
					ok: true,
				})

				const result = await client.tokenValid()

				expect(result).toBe(true)
			})

			it("returns false for invalid token", async () => {
				const invalidToken = "invalid.token"

				;(mockTrpcClient.getToken as any).mockResolvedValue(invalidToken)

				const result = await client.tokenValid()

				expect(result).toBe(false)
			})
		})

		describe("isTokenValidLocally", () => {
			// Since isTokenValidLocally is private, we test it through tokenValid
			it("validates JWT structure", async () => {
				const malformedToken = "not-a-jwt"

				;(mockTrpcClient.getToken as any).mockResolvedValue(malformedToken)

				const result = await client.tokenValid()

				expect(result).toBe(false)
			})

			it("checks kiloUserId", async () => {
				const tokenWithoutUserId = "header.eyJ2ZXJzaW9uIjoxLCJleHAiOjIwMDAwMDAwMDB9.signature"

				;(mockTrpcClient.getToken as any).mockResolvedValue(tokenWithoutUserId)

				const result = await client.tokenValid()

				expect(result).toBe(false)
			})

			it("checks version", async () => {
				const tokenWithoutVersion =
					"header.eyJraWxvVXNlcklkIjoidGVzdC11c2VyIiwiZXhwIjoyMDAwMDAwMDAwfQ.signature"

				;(mockTrpcClient.getToken as any).mockResolvedValue(tokenWithoutVersion)

				const result = await client.tokenValid()

				expect(result).toBe(false)
			})

			it("checks expiration", async () => {
				const expiredToken =
					"header.eyJraWxvVXNlcklkIjoidGVzdC11c2VyIiwidmVyc2lvbiI6MSwiZXhwIjoxMDAwMDAwMDAwfQ.signature"

				;(mockTrpcClient.getToken as any).mockResolvedValue(expiredToken)

				const result = await client.tokenValid()

				expect(result).toBe(false)
			})

			it("returns false for malformed token", async () => {
				const malformedToken = "header.invalid-payload.signature"

				;(mockTrpcClient.getToken as any).mockResolvedValue(malformedToken)

				const result = await client.tokenValid()

				expect(result).toBe(false)
			})
		})
	})
})

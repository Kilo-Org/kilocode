import { SessionClient } from "../SessionClient"
import type { TrpcClient } from "../TrpcClient"

const mockFetch = vi.fn()
global.fetch = mockFetch

describe("SessionClient", () => {
	let sessionClient: SessionClient
	let mockTrpcClient: TrpcClient

	beforeEach(() => {
		vi.clearAllMocks()

		mockTrpcClient = {
			endpoint: "https://api.example.com",
			getToken: vi.fn().mockResolvedValue("test-token"),
			request: vi.fn(),
		} as unknown as TrpcClient

		sessionClient = new SessionClient(mockTrpcClient)
	})

	describe("uploadBlob", () => {
		const sessionId = "test-session-123"
		const blobType = "ui_messages" as const
		const blobData = { messages: ["hello", "world"] }

		it("should get signed URL and upload blob successfully", async () => {
			const signedUrl = "https://storage.example.com/signed-upload-url"
			const updatedAt = "2024-01-01T00:00:00.000Z"
			const blobBody = JSON.stringify(blobData)
			const contentLength = new TextEncoder().encode(blobBody).length

			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ signed_url: signedUrl, updated_at: updatedAt }),
				})
				.mockResolvedValueOnce({
					ok: true,
				})

			const result = await sessionClient.uploadBlob(sessionId, blobType, blobData)

			expect(result).toEqual({ updated_at: updatedAt })
			expect(mockFetch).toHaveBeenCalledTimes(2)

			expect(mockFetch).toHaveBeenNthCalledWith(1, "https://api.example.com/api/upload-cli-session-blob-v2", {
				method: "POST",
				headers: {
					Authorization: "Bearer test-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					session_id: sessionId,
					blob_type: blobType,
					content_length: contentLength,
				}),
			})

			expect(mockFetch).toHaveBeenNthCalledWith(2, signedUrl, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
				},
				body: blobBody,
			})
		})

		it("should throw error when getting signed URL fails", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
			})

			await expect(sessionClient.uploadBlob(sessionId, blobType, blobData)).rejects.toThrow(
				"getSignedUploadUrl failed",
			)

			expect(mockFetch).toHaveBeenCalledTimes(1)
		})

		it("should throw error when upload to signed URL fails", async () => {
			const signedUrl = "https://storage.example.com/signed-upload-url"
			const updatedAt = "2024-01-01T00:00:00.000Z"

			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ signed_url: signedUrl, updated_at: updatedAt }),
				})
				.mockResolvedValueOnce({
					ok: false,
					status: 500,
				})

			await expect(sessionClient.uploadBlob(sessionId, blobType, blobData)).rejects.toThrow(
				"uploadBlob failed: upload to signed URL returned 500",
			)

			expect(mockFetch).toHaveBeenCalledTimes(2)
		})

		it("should work with different blob types", async () => {
			const signedUrl = "https://storage.example.com/signed-upload-url"
			const updatedAt = "2024-01-01T00:00:00.000Z"
			const blobBody = JSON.stringify(blobData)
			const contentLength = new TextEncoder().encode(blobBody).length

			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ signed_url: signedUrl, updated_at: updatedAt }),
				})
				.mockResolvedValueOnce({
					ok: true,
				})

			await sessionClient.uploadBlob(sessionId, "api_conversation_history", blobData)

			expect(mockFetch).toHaveBeenNthCalledWith(1, "https://api.example.com/api/upload-cli-session-blob-v2", {
				method: "POST",
				headers: {
					Authorization: "Bearer test-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					session_id: sessionId,
					blob_type: "api_conversation_history",
					content_length: contentLength,
				}),
			})
		})

		it("should work with task_metadata blob type", async () => {
			const signedUrl = "https://storage.example.com/signed-upload-url"
			const updatedAt = "2024-01-01T00:00:00.000Z"
			const taskData = { task: "test" }
			const blobBody = JSON.stringify(taskData)
			const contentLength = new TextEncoder().encode(blobBody).length

			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ signed_url: signedUrl, updated_at: updatedAt }),
				})
				.mockResolvedValueOnce({
					ok: true,
				})

			await sessionClient.uploadBlob(sessionId, "task_metadata", taskData)

			expect(mockFetch).toHaveBeenNthCalledWith(1, "https://api.example.com/api/upload-cli-session-blob-v2", {
				method: "POST",
				headers: {
					Authorization: "Bearer test-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					session_id: sessionId,
					blob_type: "task_metadata",
					content_length: contentLength,
				}),
			})
		})

		it("should work with git_state blob type", async () => {
			const signedUrl = "https://storage.example.com/signed-upload-url"
			const updatedAt = "2024-01-01T00:00:00.000Z"
			const gitData = { head: "abc123" }
			const blobBody = JSON.stringify(gitData)
			const contentLength = new TextEncoder().encode(blobBody).length

			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ signed_url: signedUrl, updated_at: updatedAt }),
				})
				.mockResolvedValueOnce({
					ok: true,
				})

			await sessionClient.uploadBlob(sessionId, "git_state", gitData)

			expect(mockFetch).toHaveBeenNthCalledWith(1, "https://api.example.com/api/upload-cli-session-blob-v2", {
				method: "POST",
				headers: {
					Authorization: "Bearer test-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					session_id: sessionId,
					blob_type: "git_state",
					content_length: contentLength,
				}),
			})
		})
	})

	describe("tokenValid", () => {
		const createJwt = (payload: Record<string, unknown>): string => {
			const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64")
			const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64")
			const signature = "fake-signature"
			return `${header}.${payloadBase64}.${signature}`
		}

		const validPayload = {
			env: "development",
			kiloUserId: "dae0e132-6025-4d71-be50-713dae35eec6",
			apiTokenPepper: null,
			version: 3,
			iat: Math.floor(Date.now() / 1000) - 3600,
			exp: Math.floor(Date.now() / 1000) + 3600,
		}

		it("should return true for valid token when API returns ok", async () => {
			const validToken = createJwt(validPayload)
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(validToken)

			mockFetch.mockResolvedValueOnce({
				ok: true,
			})

			const result = await sessionClient.tokenValid()

			expect(result).toBe(true)
			expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/api/user", {
				method: "GET",
				headers: {
					Authorization: `Bearer ${validToken}`,
					"Content-Type": "application/json",
				},
			})
		})

		it("should return false for valid token when API returns not ok", async () => {
			const validToken = createJwt(validPayload)
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(validToken)

			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
			})

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
		})

		it("should return false for token without three parts", async () => {
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue("invalid-token")

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should return false for token with only two parts", async () => {
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue("part1.part2")

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should return false for token with invalid base64 payload", async () => {
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue("header.!!!invalid-base64!!!.signature")

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should return false for token with invalid JSON payload", async () => {
			const invalidJsonPayload = Buffer.from("not-json").toString("base64")
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(`header.${invalidJsonPayload}.signature`)

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should return false for token missing kiloUserId", async () => {
			const payloadWithoutUserId = { ...validPayload }
			delete (payloadWithoutUserId as Record<string, unknown>).kiloUserId
			const token = createJwt(payloadWithoutUserId)
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(token)

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should return false for token with empty kiloUserId", async () => {
			const token = createJwt({ ...validPayload, kiloUserId: "" })
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(token)

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should return false for token with non-string kiloUserId", async () => {
			const token = createJwt({ ...validPayload, kiloUserId: 12345 })
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(token)

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should return false for token missing version", async () => {
			const payloadWithoutVersion = { ...validPayload }
			delete (payloadWithoutVersion as Record<string, unknown>).version
			const token = createJwt(payloadWithoutVersion)
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(token)

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should return false for token with non-number version", async () => {
			const token = createJwt({ ...validPayload, version: "3" })
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(token)

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should return false for expired token", async () => {
			const expiredPayload = {
				...validPayload,
				exp: Math.floor(Date.now() / 1000) - 3600,
			}
			const token = createJwt(expiredPayload)
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(token)

			const result = await sessionClient.tokenValid()

			expect(result).toBe(false)
			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should accept token without exp field", async () => {
			const payloadWithoutExp = { ...validPayload }
			delete (payloadWithoutExp as Record<string, unknown>).exp
			const token = createJwt(payloadWithoutExp)
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(token)

			mockFetch.mockResolvedValueOnce({
				ok: true,
			})

			const result = await sessionClient.tokenValid()

			expect(result).toBe(true)
			expect(mockFetch).toHaveBeenCalled()
		})

		it("should work with the example token format", async () => {
			const examplePayload = {
				env: "development",
				kiloUserId: "dae0e132-6025-4d71-be50-713dae35eec6",
				apiTokenPepper: null,
				version: 3,
				iat: 1764606342,
				exp: 1922394342,
			}
			const token = createJwt(examplePayload)
			vi.mocked(mockTrpcClient.getToken).mockResolvedValue(token)

			mockFetch.mockResolvedValueOnce({
				ok: true,
			})

			const result = await sessionClient.tokenValid()

			expect(result).toBe(true)
			expect(mockFetch).toHaveBeenCalled()
		})
	})
})

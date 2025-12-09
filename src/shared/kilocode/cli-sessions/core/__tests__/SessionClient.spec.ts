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
})

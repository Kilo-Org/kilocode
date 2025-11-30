import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { SessionClient } from "../sessionClient.js"
import { TrpcClient } from "../trpcClient.js"

describe("SessionClient", () => {
	let service: SessionClient
	let mockTrpcClient: TrpcClient
	let requestMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		// Reset the singleton instance before each test
		// @ts-expect-error - Accessing private static property for testing
		SessionClient.instance = null

		// Mock TrpcClient
		requestMock = vi.fn()
		mockTrpcClient = {
			request: requestMock,
		} as unknown as TrpcClient

		// Mock TrpcClient.init to return our mock
		vi.spyOn(TrpcClient, "init").mockReturnValue(mockTrpcClient)

		service = SessionClient.getInstance()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("getInstance", () => {
		it("should return same instance on multiple calls", () => {
			const instance1 = SessionClient.getInstance()
			const instance2 = SessionClient.getInstance()
			expect(instance1).toBe(instance2)
		})

		it("should be a singleton", () => {
			// @ts-expect-error - Accessing private static property for testing
			expect(SessionClient.instance).not.toBeNull()
		})
	})

	describe("get", () => {
		it("should get session without blobs", async () => {
			const mockSession = {
				id: "session-1",
				title: "Test Session",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.get({
				session_id: "session-1",
			})

			expect(requestMock).toHaveBeenCalledWith("cliSessions.get", "GET", {
				session_id: "session-1",
			})
			expect(result).toEqual(mockSession)
		})

		it("should get session with blobs", async () => {
			const mockSession = {
				id: "session-1",
				title: "Test Session",
				api_conversation_history: { messages: [] },
				task_metadata: { task: "test" },
				ui_messages: [{ type: "user", content: "hello" }],
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.get({
				session_id: "session-1",
				include_blob_urls: true,
			})

			expect(requestMock).toHaveBeenCalledWith("cliSessions.get", "GET", {
				session_id: "session-1",
				include_blob_urls: true,
			})
			expect(result).toEqual(mockSession)
		})

		it("should get session with signed blob URLs", async () => {
			const mockSession = {
				id: "session-1",
				title: "Test Session",
				api_conversation_history_blob_url: "https://storage.example.com/api-history",
				task_metadata_blob_url: "https://storage.example.com/task-metadata",
				ui_messages_blob_url: "https://storage.example.com/ui-messages",
				git_state_blob_url: "https://storage.example.com/git-state",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.get({
				session_id: "session-1",
				include_blob_urls: true,
			})

			expect(requestMock).toHaveBeenCalledWith("cliSessions.get", "GET", {
				session_id: "session-1",
				include_blob_urls: true,
			})
			expect(result).toEqual(mockSession)
			// Verify git_state_blob_url is present
			if ("git_state_blob_url" in result) {
				expect(result.git_state_blob_url).toBe("https://storage.example.com/git-state")
			}
		})

		it("should handle NOT_FOUND error", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 404 Not Found - Session not found"))

			await expect(
				service.get({
					session_id: "non-existent",
				}),
			).rejects.toThrow("Session not found")
		})
	})

	describe("create", () => {
		it("should create session with default title", async () => {
			const mockSession = {
				id: "new-session-1",
				title: "",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.create({})

			expect(requestMock).toHaveBeenCalledWith("cliSessions.create", "POST", {})
			expect(result).toEqual(mockSession)
		})

		it("should create session with title", async () => {
			const mockSession = {
				id: "new-session-2",
				title: "My Session",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.create({
				title: "My Session",
			})

			expect(requestMock).toHaveBeenCalledWith("cliSessions.create", "POST", {
				title: "My Session",
			})
			expect(result).toEqual(mockSession)
		})

		it("should create session with git_url", async () => {
			const mockSession = {
				id: "new-session-3",
				title: "Full Session",
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
			}

			const input = {
				title: "Full Session",
				git_url: "https://github.com/user/repo",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.create(input)

			expect(requestMock).toHaveBeenCalledWith("cliSessions.create", "POST", input)
			expect(result).toEqual(mockSession)
		})
	})

	describe("update", () => {
		it("should update session title", async () => {
			const mockSession = {
				id: "session-1",
				title: "Updated Title",
				updated_at: "2025-01-02T00:00:00Z",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.update({
				session_id: "session-1",
				title: "Updated Title",
			})

			expect(requestMock).toHaveBeenCalledWith("cliSessions.update", "POST", {
				session_id: "session-1",
				title: "Updated Title",
			})
			expect(result).toEqual(mockSession)
		})

		it("should update session with git_url", async () => {
			const mockSession = {
				id: "session-1",
				title: "Updated Session",
				updated_at: "2025-01-02T00:00:00Z",
			}

			const input = {
				session_id: "session-1",
				title: "Updated Session",
				git_url: "https://github.com/user/repo",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.update(input)

			expect(requestMock).toHaveBeenCalledWith("cliSessions.update", "POST", input)
			expect(result).toEqual(mockSession)
		})

		it("should handle NOT_FOUND error on update", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 404 Not Found - Session not found"))

			await expect(
				service.update({
					session_id: "non-existent",
					title: "New Title",
				}),
			).rejects.toThrow("Session not found")
		})

		it("should handle BAD_REQUEST error when no fields to update", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 400 Bad Request - No fields to update"))

			await expect(
				service.update({
					session_id: "session-1",
				}),
			).rejects.toThrow("No fields to update")
		})
	})

	describe("error handling", () => {
		it("should propagate network errors", async () => {
			requestMock.mockRejectedValueOnce(new Error("Network error"))

			await expect(service.get({ session_id: "session-1" })).rejects.toThrow("Network error")
		})

		it("should propagate authorization errors", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 401 Unauthorized - Invalid token"))

			await expect(service.get({ session_id: "session-1" })).rejects.toThrow("Invalid token")
		})

		it("should propagate validation errors", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 400 Bad Request - Invalid input"))

			await expect(
				service.create({
					title: "a".repeat(200), // Too long
				}),
			).rejects.toThrow("Invalid input")
		})
	})

	describe("list", () => {
		it("should list sessions without parameters", async () => {
			const mockSessions = [
				{
					id: "session-1",
					title: "First Session",
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
				},
				{
					id: "session-2",
					title: "Second Session",
					created_at: "2025-01-02T00:00:00Z",
					updated_at: "2025-01-02T00:00:00Z",
				},
			]

			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						cliSessions: mockSessions,
						nextCursor: null,
					},
				},
			})

			const result = await service.list()

			expect(requestMock).toHaveBeenCalledWith("cliSessions.list", "GET", {})
			expect(result.cliSessions).toEqual(mockSessions)
			expect(result.nextCursor).toBeNull()
		})

		it("should list sessions with limit parameter", async () => {
			const mockSessions = [
				{
					id: "session-1",
					title: "Session 1",
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
				},
			]

			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						cliSessions: mockSessions,
						nextCursor: "cursor-abc",
					},
				},
			})

			const result = await service.list({ limit: 1 })

			expect(requestMock).toHaveBeenCalledWith("cliSessions.list", "GET", { limit: 1 })
			expect(result.cliSessions).toHaveLength(1)
			expect(result.nextCursor).toBe("cursor-abc")
		})

		it("should list sessions with cursor parameter", async () => {
			const mockSessions = [
				{
					id: "session-3",
					title: "Third Session",
					created_at: "2025-01-03T00:00:00Z",
					updated_at: "2025-01-03T00:00:00Z",
				},
			]

			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						cliSessions: mockSessions,
						nextCursor: null,
					},
				},
			})

			const result = await service.list({ cursor: "cursor-xyz" })

			expect(requestMock).toHaveBeenCalledWith("cliSessions.list", "GET", { cursor: "cursor-xyz" })
			expect(result.cliSessions).toEqual(mockSessions)
			expect(result.nextCursor).toBeNull()
		})

		it("should list sessions with both limit and cursor", async () => {
			const mockSessions = [
				{
					id: "session-4",
					title: "Fourth Session",
					created_at: "2025-01-04T00:00:00Z",
					updated_at: "2025-01-04T00:00:00Z",
				},
				{
					id: "session-5",
					title: "Fifth Session",
					created_at: "2025-01-05T00:00:00Z",
					updated_at: "2025-01-05T00:00:00Z",
				},
			]

			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						cliSessions: mockSessions,
						nextCursor: "cursor-next",
					},
				},
			})

			const result = await service.list({ limit: 2, cursor: "cursor-prev" })

			expect(requestMock).toHaveBeenCalledWith("cliSessions.list", "GET", { limit: 2, cursor: "cursor-prev" })
			expect(result.cliSessions).toHaveLength(2)
			expect(result.nextCursor).toBe("cursor-next")
		})

		it("should handle empty sessions list", async () => {
			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						cliSessions: [],
						nextCursor: null,
					},
				},
			})

			const result = await service.list()

			expect(result.cliSessions).toEqual([])
			expect(result.nextCursor).toBeNull()
		})

		it("should handle error when listing sessions", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 500 Internal Server Error"))

			await expect(service.list()).rejects.toThrow("Internal Server Error")
		})

		it("should handle authorization error", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 401 Unauthorized - Invalid token"))

			await expect(service.list()).rejects.toThrow("Invalid token")
		})
	})

	describe("search", () => {
		it("should search sessions with searchString", async () => {
			const mockSessions = [
				{
					id: "session-abc123",
					title: "ABC Session",
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
				},
				{
					id: "session-abc456",
					title: "Another ABC",
					created_at: "2025-01-02T00:00:00Z",
					updated_at: "2025-01-02T00:00:00Z",
				},
			]

			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						results: mockSessions,
						total: 2,
						limit: 10,
						offset: 0,
					},
				},
			})

			const result = await service.search({ search_string: "abc" })

			expect(requestMock).toHaveBeenCalledWith("cliSessions.search", "GET", { search_string: "abc" })
			expect(result.results).toEqual(mockSessions)
			expect(result.results).toHaveLength(2)
			expect(result.total).toBe(2)
			expect(result.limit).toBe(10)
			expect(result.offset).toBe(0)
		})

		it("should search sessions with searchString and limit", async () => {
			const mockSessions = [
				{
					id: "session-test1",
					title: "Test 1",
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
				},
			]

			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						results: mockSessions,
						total: 1,
						limit: 5,
						offset: 0,
					},
				},
			})

			const result = await service.search({ search_string: "test", limit: 5 })

			expect(requestMock).toHaveBeenCalledWith("cliSessions.search", "GET", { search_string: "test", limit: 5 })
			expect(result.results).toEqual(mockSessions)
			expect(result.total).toBe(1)
			expect(result.limit).toBe(5)
		})

		it("should return empty results when no sessions match", async () => {
			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						results: [],
						total: 0,
						limit: 10,
						offset: 0,
					},
				},
			})

			const result = await service.search({ search_string: "nonexistent" })

			expect(result.results).toEqual([])
			expect(result.total).toBe(0)
		})

		it("should handle search error", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 500 Internal Server Error"))

			await expect(service.search({ search_string: "test" })).rejects.toThrow("Internal Server Error")
		})

		it("should handle authorization error", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 401 Unauthorized - Invalid token"))

			await expect(service.search({ search_string: "test" })).rejects.toThrow("Invalid token")
		})

		it("should pass through the limit parameter correctly", async () => {
			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						results: [],
						total: 0,
						limit: 20,
						offset: 0,
					},
				},
			})

			await service.search({ search_string: "test", limit: 20 })

			expect(requestMock).toHaveBeenCalledWith("cliSessions.search", "GET", {
				search_string: "test",
				limit: 20,
			})
		})

		it("should support offset parameter for pagination", async () => {
			const mockSessions = [
				{
					id: "session-page2",
					title: "Page 2 Session",
					created_at: "2025-01-03T00:00:00Z",
					updated_at: "2025-01-03T00:00:00Z",
				},
			]

			requestMock.mockResolvedValueOnce({
				result: {
					data: {
						results: mockSessions,
						total: 15,
						limit: 10,
						offset: 10,
					},
				},
			})

			const result = await service.search({ search_string: "test", limit: 10, offset: 10 })

			expect(requestMock).toHaveBeenCalledWith("cliSessions.search", "GET", {
				search_string: "test",
				limit: 10,
				offset: 10,
			})
			expect(result.results).toHaveLength(1)
			expect(result.total).toBe(15)
			expect(result.offset).toBe(10)
		})
	})

	describe("type safety", () => {
		it("should handle typed responses correctly", async () => {
			const mockSession = {
				session_id: "uuid-string",
				title: "Typed Session",
				created_at: "2025-01-01T00:00:00.000Z",
				updated_at: "2025-01-01T00:00:00.000Z",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.get({
				session_id: "uuid-string",
			})

			expect(typeof result.session_id).toBe("string")
			expect(typeof result.title).toBe("string")
			expect(typeof result.created_at).toBe("string")
			expect(typeof result.updated_at).toBe("string")
		})

		it("should handle sessions with blobs correctly", async () => {
			const mockSession = {
				session_id: "uuid-string",
				title: "Session with Blobs",
				api_conversation_history: { messages: [] },
				task_metadata: { key: "value" },
				ui_messages: [],
				created_at: "2025-01-01T00:00:00.000Z",
				updated_at: "2025-01-01T00:00:00.000Z",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockSession },
			})

			const result = await service.get({
				session_id: "uuid-string",
				include_blob_urls: true,
			})

			// Result should have blob fields when includeBlobUrls is true
			expect("api_conversation_history" in result).toBe(true)
			expect("task_metadata" in result).toBe(true)
			expect("ui_messages" in result).toBe(true)
		})
	})

	describe("fork", () => {
		it("should fork a session by share_id", async () => {
			const mockForkedSession = {
				session_id: "forked-session-1",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockForkedSession },
			})

			const result = await service.fork({
				share_id: "share-123",
			})

			expect(requestMock).toHaveBeenCalledWith("cliSessions.fork", "POST", {
				share_id: "share-123",
			})
			expect(result).toEqual(mockForkedSession)
		})

		it("should return forked session_id", async () => {
			const mockForkedSession = {
				session_id: "forked-session-2",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockForkedSession },
			})

			const result = await service.fork({
				share_id: "share-456",
			})

			expect(result.session_id).toBe("forked-session-2")
		})

		it("should handle NOT_FOUND error when forking", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 404 Not Found - Share not found"))

			await expect(
				service.fork({
					share_id: "non-existent",
				}),
			).rejects.toThrow("Share not found")
		})

		it("should handle authorization error when forking", async () => {
			requestMock.mockRejectedValueOnce(new Error("tRPC request failed: 401 Unauthorized - Invalid token"))

			await expect(
				service.fork({
					share_id: "share-123",
				}),
			).rejects.toThrow("Invalid token")
		})

		it("should properly send request parameters", async () => {
			const mockForkedSession = {
				session_id: "forked-session-3",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockForkedSession },
			})

			await service.fork({
				share_id: "share-original",
			})

			// Verify the exact parameters sent
			expect(requestMock).toHaveBeenCalledWith("cliSessions.fork", "POST", {
				share_id: "share-original",
			})
		})

		it("should handle successful fork response", async () => {
			const mockForkedSession = {
				session_id: "forked-session-4",
			}

			requestMock.mockResolvedValueOnce({
				result: { data: mockForkedSession },
			})

			const result = await service.fork({
				share_id: "share-empty",
			})

			expect(result.session_id).toBe("forked-session-4")
		})
	})
})

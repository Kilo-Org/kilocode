/**
 * Tests for session messages action atoms
 */

import { createStore } from "jotai"
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest"
import { fetchSessionMessagesAtom, fetchAllSessionMessagesAtom, type SessionMessage } from "../session-messages.js"
import { configAtom } from "../../config.js"
import { sessionIdAtom } from "../../session.js"
import type { CLIConfig } from "../../../../config/types.js"

// Mock the logs service
vi.mock("../../../../services/logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

// Helper to create a minimal valid config
function createMockConfig(overrides: Partial<CLIConfig> = {}): CLIConfig {
	return {
		version: "1.0.0",
		mode: "code",
		telemetry: true,
		provider: "kilocode",
		providers: [],
		...overrides,
	}
}

describe("Session Messages Atoms", () => {
	let store: ReturnType<typeof createStore>
	let fetchMock: Mock

	beforeEach(() => {
		store = createStore()
		vi.clearAllMocks()
		// Reset fetch mock
		fetchMock = vi.fn()
		global.fetch = fetchMock
	})

	describe("fetchSessionMessagesAtom", () => {
		it("should return null when no token is configured", async () => {
			store.set(configAtom, createMockConfig({ kilocodeToken: undefined }))

			const result = await store.set(fetchSessionMessagesAtom, {})

			expect(result).toBeNull()
		})

		it("should return null when no session ID is available", async () => {
			store.set(configAtom, createMockConfig({ kilocodeToken: "test-token" }))
			store.set(sessionIdAtom, null)

			const result = await store.set(fetchSessionMessagesAtom, {})

			expect(result).toBeNull()
		})

		it("should fetch messages successfully with default limit", async () => {
			const mockMessages: SessionMessage[] = [
				{
					session_id: "test-session",
					message: {
						ts: Date.now(),
						text: "Hello",
						say: "user",
					},
					created_at: new Date().toISOString(),
				},
			]

			const mockResponse = {
				result: {
					data: {
						messages: mockMessages,
						nextCursor: null,
						hasMore: false,
					},
				},
			}

			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => mockResponse,
			})

			store.set(configAtom, createMockConfig({ kilocodeToken: "test-token" }))
			store.set(sessionIdAtom, "test-session")

			const result = await store.set(fetchSessionMessagesAtom, {})

			expect(result).toEqual({
				messages: mockMessages,
				nextCursor: null,
				hasMore: false,
			})

			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("sessionMessages.list"),
				expect.objectContaining({
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer test-token",
					},
				}),
			)
		})

		it("should use provided sessionId instead of current session", async () => {
			const mockResponse = {
				result: {
					data: {
						messages: [],
						nextCursor: null,
						hasMore: false,
					},
				},
			}

			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => mockResponse,
			})

			store.set(configAtom, createMockConfig({ kilocodeToken: "test-token" }))
			store.set(sessionIdAtom, "current-session")

			await store.set(fetchSessionMessagesAtom, {
				sessionId: "different-session",
			})

			const callUrl = fetchMock.mock.calls[0]?.[0] as string
			expect(callUrl).toContain("different-session")
		})

		it("should handle pagination cursor", async () => {
			const mockResponse = {
				result: {
					data: {
						messages: [],
						nextCursor: "2024-01-01T00:00:00.000Z",
						hasMore: true,
					},
				},
			}

			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => mockResponse,
			})

			store.set(configAtom, createMockConfig({ kilocodeToken: "test-token" }))
			store.set(sessionIdAtom, "test-session")

			const result = await store.set(fetchSessionMessagesAtom, {
				cursor: "2024-01-02T00:00:00.000Z",
				limit: 10,
			})

			expect(result?.hasMore).toBe(true)
			expect(result?.nextCursor).toBe("2024-01-01T00:00:00.000Z")

			const callUrl = fetchMock.mock.calls[0]?.[0] as string
			const decodedUrl = decodeURIComponent(callUrl)
			expect(decodedUrl).toContain("2024-01-02T00:00:00.000Z")
		})

		it("should return null on API error", async () => {
			fetchMock.mockResolvedValue({
				ok: false,
				status: 404,
				text: async () => "Not found",
			})

			store.set(configAtom, createMockConfig({ kilocodeToken: "test-token" }))
			store.set(sessionIdAtom, "test-session")

			const result = await store.set(fetchSessionMessagesAtom, {})

			expect(result).toBeNull()
		})

		it("should validate limit parameter bounds", async () => {
			const mockResponse = {
				result: {
					data: {
						messages: [],
						nextCursor: null,
						hasMore: false,
					},
				},
			}

			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => mockResponse,
			})

			store.set(configAtom, createMockConfig({ kilocodeToken: "test-token" }))
			store.set(sessionIdAtom, "test-session")

			// Test limit too high
			await store.set(fetchSessionMessagesAtom, { limit: 150 })
			let callUrl = fetchMock.mock.calls[0]?.[0] as string
			let decodedUrl = decodeURIComponent(callUrl)
			expect(decodedUrl).toContain('"limit":50') // Should default to 50

			// Test limit too low
			await store.set(fetchSessionMessagesAtom, { limit: 0 })
			callUrl = fetchMock.mock.calls[1]?.[0] as string
			decodedUrl = decodeURIComponent(callUrl)
			expect(decodedUrl).toContain('"limit":50') // Should default to 50

			// Test valid limit
			await store.set(fetchSessionMessagesAtom, { limit: 25 })
			callUrl = fetchMock.mock.calls[2]?.[0] as string
			decodedUrl = decodeURIComponent(callUrl)
			expect(decodedUrl).toContain('"limit":25')
		})
	})

	describe("fetchAllSessionMessagesAtom", () => {
		it("should fetch all messages across multiple pages", async () => {
			const page1Messages: SessionMessage[] = [
				{
					session_id: "test-session",
					message: { ts: 1, text: "Message 1" },
					created_at: "2024-01-03T00:00:00.000Z",
				},
			]

			const page2Messages: SessionMessage[] = [
				{
					session_id: "test-session",
					message: { ts: 2, text: "Message 2" },
					created_at: "2024-01-02T00:00:00.000Z",
				},
			]

			const page3Messages: SessionMessage[] = [
				{
					session_id: "test-session",
					message: { ts: 3, text: "Message 3" },
					created_at: "2024-01-01T00:00:00.000Z",
				},
			]

			fetchMock
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						result: {
							data: {
								messages: page1Messages,
								nextCursor: "2024-01-02T00:00:00.000Z",
								hasMore: true,
							},
						},
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						result: {
							data: {
								messages: page2Messages,
								nextCursor: "2024-01-01T00:00:00.000Z",
								hasMore: true,
							},
						},
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						result: {
							data: {
								messages: page3Messages,
								nextCursor: null,
								hasMore: false,
							},
						},
					}),
				})

			store.set(configAtom, createMockConfig({ kilocodeToken: "test-token" }))
			store.set(sessionIdAtom, "test-session")

			const result = await store.set(fetchAllSessionMessagesAtom)

			expect(result).toHaveLength(3)
			expect(result[0]).toEqual(page1Messages[0])
			expect(result[1]).toEqual(page2Messages[0])
			expect(result[2]).toEqual(page3Messages[0])
			expect(fetchMock).toHaveBeenCalledTimes(3)
		})

		it("should stop fetching on error", async () => {
			fetchMock
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						result: {
							data: {
								messages: [
									{
										session_id: "test-session",
										message: { ts: 1, text: "Message 1" },
										created_at: "2024-01-01T00:00:00.000Z",
									},
								],
								nextCursor: "2024-01-02T00:00:00.000Z",
								hasMore: true,
							},
						},
					}),
				})
				.mockResolvedValueOnce({
					ok: false,
					status: 500,
					text: async () => "Server error",
				})

			store.set(configAtom, createMockConfig({ kilocodeToken: "test-token" }))
			store.set(sessionIdAtom, "test-session")

			const result = await store.set(fetchAllSessionMessagesAtom)

			// Should return messages from first page only
			expect(result).toHaveLength(1)
			expect(fetchMock).toHaveBeenCalledTimes(2)
		})

		it("should use provided sessionId", async () => {
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({
					result: {
						data: {
							messages: [],
							nextCursor: null,
							hasMore: false,
						},
					},
				}),
			})

			store.set(configAtom, createMockConfig({ kilocodeToken: "test-token" }))
			store.set(sessionIdAtom, "current-session")

			await store.set(fetchAllSessionMessagesAtom, "specific-session")

			const callUrl = fetchMock.mock.calls[0]?.[0] as string
			expect(callUrl).toContain("specific-session")
		})
	})
})

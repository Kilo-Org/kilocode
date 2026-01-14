import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { CloudAgentService } from "../CloudAgentService"

describe("CloudAgentService", () => {
	let service: CloudAgentService
	let mockFetch: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockFetch = vi.fn()
		global.fetch = mockFetch
		service = new CloudAgentService()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("prepareSession", () => {
		it("should prepare a cloud agent session successfully", async () => {
			const mockResponse = {
				kiloSessionId: "550e8400-e29b-41d4-a716-446655440000",
				cloudAgentSessionId: "agent_test-session-123",
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			const result = await service.prepareSession({
				githubRepo: "test/repo",
				prompt: "Test prompt",
				mode: "code",
				model: "claude-sonnet-4-20250514",
				kilocodeToken: "test-token",
			})

			expect(result).toEqual(mockResponse)
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/cloud-agent/sessions/prepare"),
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						Authorization: "Bearer test-token",
						"Content-Type": "application/json",
					}),
					body: expect.stringContaining("test/repo"),
				}),
			)
		})

		it("should include all required fields in request body", async () => {
			const mockResponse = {
				kiloSessionId: "550e8400-e29b-41d4-a716-446655440000",
				cloudAgentSessionId: "agent_test-session-456",
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			await service.prepareSession({
				githubRepo: "test/repo",
				prompt: "Test prompt",
				mode: "architect",
				model: "claude-sonnet-4-20250514",
				kilocodeToken: "test-token",
				organizationId: "550e8400-e29b-41d4-a716-446655440001",
			})

			const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
			expect(callBody.githubRepo).toBe("test/repo")
			expect(callBody.prompt).toBe("Test prompt")
			expect(callBody.mode).toBe("architect")
			expect(callBody.model).toBe("claude-sonnet-4-20250514")
			expect(callBody.organizationId).toBe("550e8400-e29b-41d4-a716-446655440001")
		})

		it("should throw error when API returns non-ok response", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
			})

			await expect(
				service.prepareSession({
					githubRepo: "test/repo",
					prompt: "Test prompt",
					mode: "code",
					model: "claude-sonnet-4-20250514",
					kilocodeToken: "invalid-token",
				}),
			).rejects.toThrow("Failed to prepare cloud agent session: 401")
		})

		it("should throw error when token is missing", async () => {
			await expect(
				service.prepareSession({
					githubRepo: "test/repo",
					prompt: "Test prompt",
					mode: "code",
					model: "claude-sonnet-4-20250514",
					kilocodeToken: "",
				}),
			).rejects.toThrow("kilocodeToken is required")
		})
	})

	describe("initiateSession", () => {
		it("should initiate a prepared session successfully", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ success: true }),
			})

			const result = await service.initiateSession("test-session-123")

			expect(result).toEqual({ success: true })
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/trpc/initiateFromKilocodeSessionV2"),
				expect.objectContaining({
					method: "POST",
					body: expect.stringContaining("test-session-123"),
				}),
			)
		})

		it("should throw error when initiation fails", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			})

			await expect(service.initiateSession("test-session-123")).rejects.toThrow(
				"Failed to initiate cloud agent session: 500",
			)
		})
	})

	describe("sendMessage", () => {
		it("should send a follow-up message successfully", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ success: true, queuePosition: 1 }),
			})

			const result = await service.sendMessage("test-session-123", "Follow-up message")

			expect(result).toEqual({ success: true, queuePosition: 1 })
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/trpc/sendMessageV2"),
				expect.objectContaining({
					method: "POST",
					body: expect.stringContaining("Follow-up message"),
				}),
			)
		})

		it("should throw error when sending message fails", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				statusText: "Bad Request",
			})

			await expect(service.sendMessage("test-session-123", "Message")).rejects.toThrow(
				"Failed to send message to cloud agent: 400",
			)
		})
	})

	describe("getStreamUrl", () => {
		it("should return correct WebSocket URL for session", () => {
			const url = service.getStreamUrl("test-session-123")
			expect(url).toBe("wss://cloud-agent.kilosessions.ai/stream?sessionId=test-session-123")
		})

		it("should properly encode session ID with special characters", () => {
			const url = service.getStreamUrl("session/with+special&chars")
			expect(url).toContain("sessionId=session%2Fwith%2Bspecial%26chars")
		})
	})

	describe("hasValidToken", () => {
		it("should return true when token is provided", () => {
			expect(service.hasValidToken("valid-token")).toBe(true)
		})

		it("should return false when token is empty", () => {
			expect(service.hasValidToken("")).toBe(false)
		})

		it("should return false when token is undefined", () => {
			expect(service.hasValidToken(undefined)).toBe(false)
		})
	})
})

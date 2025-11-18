import { describe, it, expect, beforeEach, vi, type Mock } from "vitest"
import { createStore } from "jotai"
import {
	sessionIdAtom,
	isSessionInitializingAtom,
	sessionErrorAtom,
	isSessionReadyAtom,
	setSessionIdAtom,
	setSessionErrorAtom,
	setSessionInitializingAtom,
	clearSessionAtom,
} from "../session.js"
import { validateSessionAtom, initializeSessionAtom } from "../actions/session.js"
import { configAtom } from "../config.js"
import type { CLIConfig } from "../../../config/types.js"

describe("Session Atoms", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("sessionIdAtom", () => {
		it("should initialize with null", () => {
			expect(store.get(sessionIdAtom)).toBeNull()
		})

		it("should store session ID", () => {
			store.set(setSessionIdAtom, "test-session-123")
			expect(store.get(sessionIdAtom)).toBe("test-session-123")
		})

		it("should clear session ID", () => {
			store.set(setSessionIdAtom, "test-session-123")
			store.set(setSessionIdAtom, null)
			expect(store.get(sessionIdAtom)).toBeNull()
		})
	})

	describe("isSessionInitializingAtom", () => {
		it("should initialize with false", () => {
			expect(store.get(isSessionInitializingAtom)).toBe(false)
		})

		it("should track initializing state", () => {
			store.set(setSessionInitializingAtom, true)
			expect(store.get(isSessionInitializingAtom)).toBe(true)

			store.set(setSessionInitializingAtom, false)
			expect(store.get(isSessionInitializingAtom)).toBe(false)
		})
	})

	describe("sessionErrorAtom", () => {
		it("should initialize with null", () => {
			expect(store.get(sessionErrorAtom)).toBeNull()
		})

		it("should store error", () => {
			const error = new Error("Session creation failed")
			store.set(setSessionErrorAtom, error)
			expect(store.get(sessionErrorAtom)).toBe(error)
		})

		it("should clear error when session is set", () => {
			const error = new Error("Session creation failed")
			store.set(setSessionErrorAtom, error)
			expect(store.get(sessionErrorAtom)).toBe(error)

			store.set(setSessionIdAtom, "test-session-123")
			expect(store.get(sessionErrorAtom)).toBeNull()
		})
	})

	describe("isSessionReadyAtom", () => {
		it("should be false when session ID is null", () => {
			expect(store.get(isSessionReadyAtom)).toBe(false)
		})

		it("should be false when initializing", () => {
			store.set(setSessionIdAtom, "test-session-123")
			store.set(setSessionInitializingAtom, true)
			expect(store.get(isSessionReadyAtom)).toBe(false)
		})

		it("should be false when there is an error", () => {
			store.set(setSessionIdAtom, "test-session-123")
			store.set(setSessionErrorAtom, new Error("Test error"))
			expect(store.get(isSessionReadyAtom)).toBe(false)
		})

		it("should be true when session ID is set and no errors", () => {
			store.set(setSessionIdAtom, "test-session-123")
			expect(store.get(isSessionReadyAtom)).toBe(true)
		})
	})

	describe("setSessionIdAtom", () => {
		it("should set session ID and clear initializing state", () => {
			store.set(setSessionInitializingAtom, true)
			store.set(setSessionIdAtom, "test-session-123")

			expect(store.get(sessionIdAtom)).toBe("test-session-123")
			expect(store.get(isSessionInitializingAtom)).toBe(false)
		})

		it("should clear error when setting session ID", () => {
			store.set(setSessionErrorAtom, new Error("Previous error"))
			store.set(setSessionIdAtom, "test-session-123")

			expect(store.get(sessionErrorAtom)).toBeNull()
		})
	})

	describe("setSessionErrorAtom", () => {
		it("should set error and clear initializing state", () => {
			store.set(setSessionInitializingAtom, true)
			const error = new Error("Session error")
			store.set(setSessionErrorAtom, error)

			expect(store.get(sessionErrorAtom)).toBe(error)
			expect(store.get(isSessionInitializingAtom)).toBe(false)
		})

		it("should clear session ID when setting error", () => {
			store.set(setSessionIdAtom, "test-session-123")
			store.set(setSessionErrorAtom, new Error("Session error"))

			expect(store.get(sessionIdAtom)).toBeNull()
		})
	})

	describe("clearSessionAtom", () => {
		it("should clear all session state", () => {
			// Set up some state
			store.set(setSessionIdAtom, "test-session-123")
			store.set(setSessionInitializingAtom, true)
			store.set(setSessionErrorAtom, new Error("Test error"))

			// Clear all state
			store.set(clearSessionAtom)

			// Verify everything is cleared
			expect(store.get(sessionIdAtom)).toBeNull()
			expect(store.get(isSessionInitializingAtom)).toBe(false)
			expect(store.get(sessionErrorAtom)).toBeNull()
		})
	})

	describe("Session lifecycle", () => {
		it("should handle successful session creation flow", () => {
			// Start initialization
			store.set(setSessionInitializingAtom, true)
			expect(store.get(isSessionReadyAtom)).toBe(false)

			// Complete initialization
			store.set(setSessionIdAtom, "test-session-123")
			expect(store.get(isSessionReadyAtom)).toBe(true)
			expect(store.get(isSessionInitializingAtom)).toBe(false)
		})

		it("should handle failed session creation flow", () => {
			// Start initialization
			store.set(setSessionInitializingAtom, true)
			expect(store.get(isSessionReadyAtom)).toBe(false)

			// Fail initialization
			const error = new Error("Network error")
			store.set(setSessionErrorAtom, error)
			expect(store.get(isSessionReadyAtom)).toBe(false)
			expect(store.get(sessionErrorAtom)).toBe(error)
			expect(store.get(sessionIdAtom)).toBeNull()
		})

		it("should handle session reset flow", () => {
			// Create session
			store.set(setSessionIdAtom, "test-session-123")
			expect(store.get(isSessionReadyAtom)).toBe(true)

			// Clear session
			store.set(clearSessionAtom)
			expect(store.get(isSessionReadyAtom)).toBe(false)
			expect(store.get(sessionIdAtom)).toBeNull()
		})
	})

	describe("validateSessionAtom", () => {
		const mockConfig = (kilocodeToken: string | null = null): CLIConfig => ({
			version: "1.0.0",
			mode: "code",
			telemetry: false,
			provider: "test-provider",
			providers: [],
			kilocodeToken: kilocodeToken ?? undefined,
		})

		beforeEach(() => {
			// Mock fetch globally
			global.fetch = vi.fn() as Mock
		})

		it("should return null when no token is configured", async () => {
			store.set(configAtom, mockConfig(null))

			const result = await store.set(validateSessionAtom, "test-session-123")
			expect(result).toBeNull()
		})

		it("should return session ID when validation succeeds", async () => {
			store.set(configAtom, mockConfig("test-token"))

			const mockResponse = {
				ok: true,
				json: async () => ({
					result: {
						data: {
							session_id: "test-session-123",
						},
					},
				}),
			}
			;(global.fetch as Mock).mockResolvedValue(mockResponse as Response)

			const result = await store.set(validateSessionAtom, "test-session-123")
			expect(result).toBe("test-session-123")
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/trpc/sessions.get"),
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						Authorization: "Bearer test-token",
					}),
				}),
			)
		})

		it("should return null when validation fails with HTTP error", async () => {
			store.set(configAtom, mockConfig("test-token"))

			const mockResponse = {
				ok: false,
				status: 404,
			}
			;(global.fetch as Mock).mockResolvedValue(mockResponse as Response)

			const result = await store.set(validateSessionAtom, "invalid-session")
			expect(result).toBeNull()
		})

		it("should return null when session ID mismatch", async () => {
			store.set(configAtom, mockConfig("test-token"))

			const mockResponse = {
				ok: true,
				json: async () => ({
					result: {
						data: {
							session_id: "different-session",
						},
					},
				}),
			}
			;(global.fetch as Mock).mockResolvedValue(mockResponse as Response)

			const result = await store.set(validateSessionAtom, "test-session-123")
			expect(result).toBeNull()
		})

		it("should return null when fetch throws error", async () => {
			store.set(configAtom, mockConfig("test-token"))
			;(global.fetch as Mock).mockRejectedValue(new Error("Network error"))

			const result = await store.set(validateSessionAtom, "test-session-123")
			expect(result).toBeNull()
		})
	})

	describe("initializeSessionAtom with provided session ID", () => {
		const mockConfig = (kilocodeToken: string | null = null): CLIConfig => ({
			version: "1.0.0",
			mode: "code",
			telemetry: false,
			provider: "test-provider",
			providers: [],
			kilocodeToken: kilocodeToken ?? undefined,
		})

		beforeEach(() => {
			global.fetch = vi.fn() as Mock
		})

		it("should use provided session ID when valid", async () => {
			store.set(configAtom, mockConfig("test-token"))

			// Mock successful validation
			const mockValidationResponse = {
				ok: true,
				json: async () => ({
					result: {
						data: {
							session_id: "existing-session",
						},
					},
				}),
			}
			;(global.fetch as Mock).mockResolvedValue(mockValidationResponse as Response)

			const result = await store.set(initializeSessionAtom, "existing-session")
			expect(result).toBe("existing-session")
			expect(store.get(sessionIdAtom)).toBe("existing-session")
		})

		it("should create new session when provided session ID is invalid", async () => {
			store.set(configAtom, mockConfig("test-token"))

			// Mock failed validation, then successful creation
			;(global.fetch as Mock)
				.mockResolvedValueOnce({
					ok: false,
					status: 404,
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						result: {
							data: {
								session_id: "new-session",
								title: "...",
							},
						},
					}),
				} as Response)

			const result = await store.set(initializeSessionAtom, "invalid-session")
			expect(result).toBe("new-session")
			expect(store.get(sessionIdAtom)).toBe("new-session")
		})

		it("should create new session when no session ID provided", async () => {
			store.set(configAtom, mockConfig("test-token"))

			const mockCreateResponse = {
				ok: true,
				json: async () => ({
					result: {
						data: {
							session_id: "new-session",
							title: "...",
						},
					},
				}),
			}
			;(global.fetch as Mock).mockResolvedValue(mockCreateResponse as Response)

			const result = await store.set(initializeSessionAtom)
			expect(result).toBe("new-session")
			expect(store.get(sessionIdAtom)).toBe("new-session")
		})

		it("should return existing session when already initialized", async () => {
			store.set(configAtom, mockConfig("test-token"))
			store.set(setSessionIdAtom, "already-initialized")

			const result = await store.set(initializeSessionAtom, "new-session")
			expect(result).toBe("already-initialized")
			// fetch should not be called since session already exists
			expect(global.fetch).not.toHaveBeenCalled()
		})
	})
})

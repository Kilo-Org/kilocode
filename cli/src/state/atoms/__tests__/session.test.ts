import { describe, it, expect, beforeEach } from "vitest"
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
})

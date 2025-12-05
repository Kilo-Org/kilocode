import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { AgentRegistry } from "../AgentRegistry"

describe("AgentRegistry", () => {
	let registry: AgentRegistry

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"))
		registry = new AgentRegistry()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("uses the selectedId accessor and validates unknown ids", () => {
		const first = registry.createSession("session-1", "first prompt")
		expect(registry.selectedId).toBe(first.sessionId)

		registry.selectedId = "missing"
		expect(registry.selectedId).toBeNull()

		const second = registry.createSession("session-2", "second prompt")
		registry.selectedId = first.sessionId
		expect(registry.selectedId).toBe(first.sessionId)

		// Setting a known id should stick; unknown should clear
		registry.selectedId = second.sessionId
		expect(registry.selectedId).toBe(second.sessionId)
	})

	it("sorts sessions by most recent start time", () => {
		const first = registry.createSession("session-1", "first")
		vi.advanceTimersByTime(1)
		const second = registry.createSession("session-2", "second")
		const sessions = registry.getSessions()

		expect(sessions.map((s) => s.sessionId)).toEqual([second.sessionId, first.sessionId])
	})

	it("caps logs to the max log count", () => {
		const { sessionId } = registry.createSession("session-1", "loggy")
		for (let i = 0; i < 105; i++) {
			registry.appendLog(sessionId, `log-${i}`)
		}

		const session = registry.getSession(sessionId)
		expect(session?.logs.length).toBe(100)
		expect(session?.logs[0]).toBe("log-5") // first five should be trimmed
		expect(session?.logs.at(-1)).toBe("log-104")
	})

	it("prunes oldest non-running sessions when over capacity", () => {
		// Fill up to the limit
		const created: string[] = []
		for (let i = 0; i < 10; i++) {
			vi.advanceTimersByTime(1)
			const session = registry.createSession(`session-${i}`, `session-${i}`)
			created.push(session.sessionId)
		}

		// Mark the earliest three as non-running so they are eligible for pruning
		registry.updateSessionStatus(created[0], "done")
		registry.updateSessionStatus(created[1], "done")
		registry.updateSessionStatus(created[2], "done")

		// Create one more to trigger pruning; should drop the oldest done session (created[0])
		const extra = registry.createSession("session-overflow", "overflow")

		const ids = registry.getSessions().map((s) => s.sessionId)
		expect(ids).toHaveLength(10)
		expect(ids).not.toContain(created[0])
		expect(ids).toContain(created[1])
		expect(ids).toContain(extra.sessionId)
	})

	it("getState returns the current sessions and selection", () => {
		const session = registry.createSession("session-1", "stateful")
		const state = registry.getState()

		expect(state.selectedId).toBe(session.sessionId)
		expect(state.sessions[0].sessionId).toBe(session.sessionId)
	})

	describe("pending session", () => {
		it("setPendingSession creates a pending session", () => {
			expect(registry.pendingSession).toBeNull()

			const pending = registry.setPendingSession("test prompt")

			expect(pending.prompt).toBe("test prompt")
			expect(pending.label).toBe("test prompt")
			expect(pending.startTime).toBeDefined()
			expect(registry.pendingSession).toBe(pending)
		})

		it("clearPendingSession clears the pending session", () => {
			registry.setPendingSession("test prompt")
			expect(registry.pendingSession).not.toBeNull()

			registry.clearPendingSession()

			expect(registry.pendingSession).toBeNull()
		})

		it("truncates long prompts in pending session label", () => {
			const longPrompt = "a".repeat(100)
			const pending = registry.setPendingSession(longPrompt)

			expect(pending.label.length).toBeLessThanOrEqual(40)
			expect(pending.label.endsWith("...")).toBe(true)
		})
	})

	describe("hasActiveProcess", () => {
		it("returns false for non-existent session", () => {
			expect(registry.hasActiveProcess("non-existent")).toBe(false)
		})

		it("returns false for running session without pid", () => {
			const session = registry.createSession("session-1", "test")
			expect(session.status).toBe("running")
			expect(session.pid).toBeUndefined()

			expect(registry.hasActiveProcess(session.sessionId)).toBe(false)
		})

		it("returns true for running session with pid", () => {
			const session = registry.createSession("session-1", "test")
			registry.setSessionPid(session.sessionId, 12345)

			expect(registry.hasActiveProcess(session.sessionId)).toBe(true)
		})

		it("returns false for completed session with pid", () => {
			const session = registry.createSession("session-1", "test")
			registry.setSessionPid(session.sessionId, 12345)
			registry.updateSessionStatus(session.sessionId, "done")

			expect(registry.hasActiveProcess(session.sessionId)).toBe(false)
		})

		it("returns false for error session with pid", () => {
			const session = registry.createSession("session-1", "test")
			registry.setSessionPid(session.sessionId, 12345)
			registry.updateSessionStatus(session.sessionId, "error")

			expect(registry.hasActiveProcess(session.sessionId)).toBe(false)
		})
	})

	describe("hasRunningSessions", () => {
		it("returns false when no sessions exist", () => {
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns true when a session is running", () => {
			registry.createSession("session-1", "running session")
			expect(registry.hasRunningSessions()).toBe(true)
		})

		it("returns false when all sessions are completed", () => {
			const session = registry.createSession("session-1", "done session")
			registry.updateSessionStatus(session.sessionId, "done")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns false when all sessions have errors", () => {
			const session = registry.createSession("session-1", "error session")
			registry.updateSessionStatus(session.sessionId, "error")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns false when all sessions are stopped", () => {
			const session = registry.createSession("session-1", "stopped session")
			registry.updateSessionStatus(session.sessionId, "stopped")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns true when at least one session is running among others", () => {
			const s1 = registry.createSession("session-1", "done")
			registry.createSession("session-2", "running")
			const s3 = registry.createSession("session-3", "error")

			registry.updateSessionStatus(s1.sessionId, "done")
			registry.updateSessionStatus(s3.sessionId, "error")

			expect(registry.hasRunningSessions()).toBe(true)
		})

		it("returns the count of running sessions", () => {
			registry.createSession("session-1", "running 1")
			registry.createSession("session-2", "running 2")
			const s3 = registry.createSession("session-3", "done")

			registry.updateSessionStatus(s3.sessionId, "done")

			expect(registry.getRunningSessionCount()).toBe(2)
		})
	})

	describe("hasPendingOrRunningSessions", () => {
		it("returns false when no sessions or pending", () => {
			expect(registry.hasPendingOrRunningSessions()).toBe(false)
		})

		it("returns true when pending session exists", () => {
			registry.setPendingSession("test")
			expect(registry.hasPendingOrRunningSessions()).toBe(true)
		})

		it("returns true when running session exists", () => {
			registry.createSession("session-1", "test")
			expect(registry.hasPendingOrRunningSessions()).toBe(true)
		})

		it("returns false when only completed sessions exist", () => {
			const session = registry.createSession("session-1", "test")
			registry.updateSessionStatus(session.sessionId, "done")
			expect(registry.hasPendingOrRunningSessions()).toBe(false)
		})
	})
})

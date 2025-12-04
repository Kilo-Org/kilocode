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
		const first = registry.createSession("first prompt")
		expect(registry.selectedId).toBe(first.localId)

		registry.selectedId = "missing"
		expect(registry.selectedId).toBeNull()

		const second = registry.createSession("second prompt")
		registry.selectedId = first.localId
		expect(registry.selectedId).toBe(first.localId)

		// Setting a known id should stick; unknown should clear
		registry.selectedId = second.localId
		expect(registry.selectedId).toBe(second.localId)
	})

	it("re-selects the next session when the selected one is removed", () => {
		const first = registry.createSession("first")
		const second = registry.createSession("second")
		expect(registry.selectedId).toBe(second.localId) // latest auto-selected

		registry.removeSession(second.localId)
		expect(registry.selectedId).toBe(first.localId)

		registry.removeSession(first.localId)
		expect(registry.selectedId).toBeNull()
	})

	it("sorts sessions by most recent start time", () => {
		const first = registry.createSession("first")
		vi.advanceTimersByTime(1)
		const second = registry.createSession("second")
		const sessions = registry.getSessions()

		expect(sessions.map((s) => s.localId)).toEqual([second.localId, first.localId])
	})

	it("caps logs to the max log count", () => {
		const { localId } = registry.createSession("loggy")
		for (let i = 0; i < 105; i++) {
			registry.appendLog(localId, `log-${i}`)
		}

		const session = registry.getSession(localId)
		expect(session?.logs.length).toBe(100)
		expect(session?.logs[0]).toBe("log-5") // first five should be trimmed
		expect(session?.logs.at(-1)).toBe("log-104")
	})

	it("prunes oldest non-running sessions when over capacity", () => {
		// Fill up to the limit
		const created: string[] = []
		for (let i = 0; i < 10; i++) {
			vi.advanceTimersByTime(1)
			const session = registry.createSession(`session-${i}`)
			created.push(session.localId)
		}

		// Mark the earliest three as non-running so they are eligible for pruning
		registry.updateSessionStatus(created[0], "done")
		registry.updateSessionStatus(created[1], "done")
		registry.updateSessionStatus(created[2], "done")

		// Create one more to trigger pruning; should drop the oldest done session (created[0])
		const extra = registry.createSession("overflow")

		const ids = registry.getSessions().map((s) => s.localId)
		expect(ids).toHaveLength(10)
		expect(ids).not.toContain(created[0])
		expect(ids).toContain(created[1])
		expect(ids).toContain(extra.localId)
	})

	it("getState returns the current sessions and selection", () => {
		const session = registry.createSession("stateful")
		const state = registry.getState()

		expect(state.selectedId).toBe(session.localId)
		expect(state.sessions[0].localId).toBe(session.localId)
	})

	describe("remote session identity", () => {
		it("setSessionIdFor associates a remote session ID with a local session", () => {
			const session = registry.createSession("test prompt")
			expect(session.sessionId).toBeUndefined()

			registry.setSessionIdFor(session.localId, "remote-abc-123")

			const updated = registry.getSession(session.localId)
			expect(updated?.sessionId).toBe("remote-abc-123")
		})

		it("setSessionIdFor does nothing for non-existent session", () => {
			registry.setSessionIdFor("non-existent", "remote-abc")
			// Should not throw, just no-op
			expect(registry.getSession("non-existent")).toBeUndefined()
		})

		it("getSessionBySessionId returns session with matching sessionId", () => {
			const session1 = registry.createSession("first")
			const session2 = registry.createSession("second")

			registry.setSessionIdFor(session1.localId, "remote-111")
			registry.setSessionIdFor(session2.localId, "remote-222")

			const found = registry.getSessionBySessionId("remote-111")
			expect(found?.localId).toBe(session1.localId)
		})

		it("getSessionBySessionId returns undefined when no match", () => {
			const session = registry.createSession("test")
			registry.setSessionIdFor(session.localId, "remote-abc")

			const found = registry.getSessionBySessionId("non-existent-session-id")
			expect(found).toBeUndefined()
		})

		it("getSessionBySessionId returns undefined when sessions have no sessionId", () => {
			registry.createSession("test")
			const found = registry.getSessionBySessionId("any-session-id")
			expect(found).toBeUndefined()
		})
	})

	describe("hasActiveProcess", () => {
		it("returns false for non-existent session", () => {
			expect(registry.hasActiveProcess("non-existent")).toBe(false)
		})

		it("returns false for running session without pid", () => {
			const session = registry.createSession("test")
			expect(session.status).toBe("running")
			expect(session.pid).toBeUndefined()

			expect(registry.hasActiveProcess(session.localId)).toBe(false)
		})

		it("returns true for running session with pid", () => {
			const session = registry.createSession("test")
			registry.setSessionPid(session.localId, 12345)

			expect(registry.hasActiveProcess(session.localId)).toBe(true)
		})

		it("returns false for completed session with pid", () => {
			const session = registry.createSession("test")
			registry.setSessionPid(session.localId, 12345)
			registry.updateSessionStatus(session.localId, "done")

			expect(registry.hasActiveProcess(session.localId)).toBe(false)
		})

		it("returns false for error session with pid", () => {
			const session = registry.createSession("test")
			registry.setSessionPid(session.localId, 12345)
			registry.updateSessionStatus(session.localId, "error")

			expect(registry.hasActiveProcess(session.localId)).toBe(false)
		})
	})

	describe("hasRunningSessions", () => {
		it("returns false when no sessions exist", () => {
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns true when a session is running", () => {
			registry.createSession("running session")
			expect(registry.hasRunningSessions()).toBe(true)
		})

		it("returns false when all sessions are completed", () => {
			const session = registry.createSession("done session")
			registry.updateSessionStatus(session.localId, "done")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns false when all sessions have errors", () => {
			const session = registry.createSession("error session")
			registry.updateSessionStatus(session.localId, "error")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns false when all sessions are stopped", () => {
			const session = registry.createSession("stopped session")
			registry.updateSessionStatus(session.localId, "stopped")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns true when at least one session is running among others", () => {
			const s1 = registry.createSession("done")
			const s2 = registry.createSession("running")
			const s3 = registry.createSession("error")

			registry.updateSessionStatus(s1.localId, "done")
			registry.updateSessionStatus(s3.localId, "error")

			expect(registry.hasRunningSessions()).toBe(true)
		})

		it("returns the count of running sessions", () => {
			const s1 = registry.createSession("running 1")
			const s2 = registry.createSession("running 2")
			const s3 = registry.createSession("done")

			registry.updateSessionStatus(s3.localId, "done")

			expect(registry.getRunningSessionCount()).toBe(2)
		})
	})
})

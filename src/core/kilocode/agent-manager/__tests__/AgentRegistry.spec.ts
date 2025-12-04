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
		expect(registry.selectedId).toBe(first.id)

		registry.selectedId = "missing"
		expect(registry.selectedId).toBeNull()

		const second = registry.createSession("second prompt")
		registry.selectedId = first.id
		expect(registry.selectedId).toBe(first.id)

		// Setting a known id should stick; unknown should clear
		registry.selectedId = second.id
		expect(registry.selectedId).toBe(second.id)
	})

	it("re-selects the next session when the selected one is removed", () => {
		const first = registry.createSession("first")
		const second = registry.createSession("second")
		expect(registry.selectedId).toBe(second.id) // latest auto-selected

		registry.removeSession(second.id)
		expect(registry.selectedId).toBe(first.id)

		registry.removeSession(first.id)
		expect(registry.selectedId).toBeNull()
	})

	it("sorts sessions by most recent start time", () => {
		const first = registry.createSession("first")
		vi.advanceTimersByTime(1)
		const second = registry.createSession("second")
		const sessions = registry.getSessions()

		expect(sessions.map((s) => s.id)).toEqual([second.id, first.id])
	})

	it("caps logs to the max log count", () => {
		const { id } = registry.createSession("loggy")
		for (let i = 0; i < 105; i++) {
			registry.appendLog(id, `log-${i}`)
		}

		const session = registry.getSession(id)
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
			created.push(session.id)
		}

		// Mark the earliest three as non-running so they are eligible for pruning
		registry.updateSessionStatus(created[0], "done")
		registry.updateSessionStatus(created[1], "done")
		registry.updateSessionStatus(created[2], "done")

		// Create one more to trigger pruning; should drop the oldest done session (created[0])
		const extra = registry.createSession("overflow")

		const ids = registry.getSessions().map((s) => s.id)
		expect(ids).toHaveLength(10)
		expect(ids).not.toContain(created[0])
		expect(ids).toContain(created[1])
		expect(ids).toContain(extra.id)
	})

	it("getState returns the current sessions and selection", () => {
		const session = registry.createSession("stateful")
		const state = registry.getState()

		expect(state.selectedId).toBe(session.id)
		expect(state.sessions[0].id).toBe(session.id)
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
			registry.updateSessionStatus(session.id, "done")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns false when all sessions have errors", () => {
			const session = registry.createSession("error session")
			registry.updateSessionStatus(session.id, "error")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns false when all sessions are stopped", () => {
			const session = registry.createSession("stopped session")
			registry.updateSessionStatus(session.id, "stopped")
			expect(registry.hasRunningSessions()).toBe(false)
		})

		it("returns true when at least one session is running among others", () => {
			const s1 = registry.createSession("done")
			const s2 = registry.createSession("running")
			const s3 = registry.createSession("error")

			registry.updateSessionStatus(s1.id, "done")
			registry.updateSessionStatus(s3.id, "error")

			expect(registry.hasRunningSessions()).toBe(true)
		})

		it("returns the count of running sessions", () => {
			const s1 = registry.createSession("running 1")
			const s2 = registry.createSession("running 2")
			const s3 = registry.createSession("done")

			registry.updateSessionStatus(s3.id, "done")

			expect(registry.getRunningSessionCount()).toBe(2)
		})
	})
})

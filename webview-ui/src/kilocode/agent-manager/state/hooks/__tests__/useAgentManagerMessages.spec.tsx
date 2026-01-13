import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { Provider, useAtomValue } from "jotai"
import { useAgentManagerMessages } from "../useAgentManagerMessages"
import { sessionsArrayAtom, selectedSessionIdAtom, type AgentSession } from "../../atoms/sessions"

function createSession(id: string, status: AgentSession["status"] = "running"): AgentSession {
	return {
		sessionId: id,
		label: `Session ${id}`,
		prompt: `Test prompt ${id}`,
		status,
		startTime: Date.now(),
		source: "local",
	}
}

function dispatchStateMessage(sessions: AgentSession[], selectedId: string | null = null) {
	const event = new MessageEvent("message", {
		data: {
			type: "agentManager.state",
			state: { sessions, selectedId },
		},
	})
	window.dispatchEvent(event)
}

describe("useAgentManagerMessages", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("should add sessions from state messages", async () => {
		const wrapper = ({ children }: { children: React.ReactNode }) => <Provider>{children}</Provider>

		const { result } = renderHook(
			() => {
				useAgentManagerMessages()
				return {
					sessions: useAtomValue(sessionsArrayAtom),
					selectedId: useAtomValue(selectedSessionIdAtom),
				}
			},
			{ wrapper },
		)

		expect(result.current.sessions).toHaveLength(0)

		// Add two sessions - they get prepended so order is reversed
		act(() => {
			dispatchStateMessage([createSession("1"), createSession("2")])
		})

		expect(result.current.sessions).toHaveLength(2)
		// Sessions are prepended (newest first), so "2" comes before "1"
		expect(result.current.sessions.map((s) => s.sessionId)).toEqual(["2", "1"])
	})

	it("should remove sessions that no longer exist in state - regression test for delete bug", async () => {
		const wrapper = ({ children }: { children: React.ReactNode }) => <Provider>{children}</Provider>

		const { result } = renderHook(
			() => {
				useAgentManagerMessages()
				return {
					sessions: useAtomValue(sessionsArrayAtom),
					selectedId: useAtomValue(selectedSessionIdAtom),
				}
			},
			{ wrapper },
		)

		// Start with 3 sessions
		act(() => {
			dispatchStateMessage([createSession("1"), createSession("2"), createSession("3")])
		})

		expect(result.current.sessions).toHaveLength(3)
		// Sessions are prepended in order processed
		expect(result.current.sessions.map((s) => s.sessionId)).toEqual(["3", "2", "1"])

		// Delete session "2" by sending state without it
		act(() => {
			dispatchStateMessage([createSession("1"), createSession("3")])
		})

		// Session "2" should be removed from frontend state
		expect(result.current.sessions).toHaveLength(2)
		expect(result.current.sessions.map((s) => s.sessionId)).toEqual(["3", "1"])
	})

	it("should handle deleting multiple sessions at once", async () => {
		const wrapper = ({ children }: { children: React.ReactNode }) => <Provider>{children}</Provider>

		const { result } = renderHook(
			() => {
				useAgentManagerMessages()
				return {
					sessions: useAtomValue(sessionsArrayAtom),
					selectedId: useAtomValue(selectedSessionIdAtom),
				}
			},
			{ wrapper },
		)

		// Start with 4 sessions
		act(() => {
			dispatchStateMessage([createSession("1"), createSession("2"), createSession("3"), createSession("4")])
		})

		expect(result.current.sessions).toHaveLength(4)

		// Delete sessions "2" and "3"
		act(() => {
			dispatchStateMessage([createSession("1"), createSession("4")])
		})

		expect(result.current.sessions).toHaveLength(2)
		expect(result.current.sessions.map((s) => s.sessionId)).toEqual(["4", "1"])
	})

	it("should handle deleting all sessions", async () => {
		const wrapper = ({ children }: { children: React.ReactNode }) => <Provider>{children}</Provider>

		const { result } = renderHook(
			() => {
				useAgentManagerMessages()
				return {
					sessions: useAtomValue(sessionsArrayAtom),
					selectedId: useAtomValue(selectedSessionIdAtom),
				}
			},
			{ wrapper },
		)

		// Start with sessions
		act(() => {
			dispatchStateMessage([createSession("1"), createSession("2")])
		})

		expect(result.current.sessions).toHaveLength(2)

		// Delete all sessions
		act(() => {
			dispatchStateMessage([])
		})

		expect(result.current.sessions).toHaveLength(0)
	})

	it("should update selected session when deleted session was selected", async () => {
		const wrapper = ({ children }: { children: React.ReactNode }) => <Provider>{children}</Provider>

		const { result } = renderHook(
			() => {
				useAgentManagerMessages()
				return {
					sessions: useAtomValue(sessionsArrayAtom),
					selectedId: useAtomValue(selectedSessionIdAtom),
				}
			},
			{ wrapper },
		)

		// Add sessions - first one gets auto-selected when selectedId is null
		act(() => {
			dispatchStateMessage([createSession("1"), createSession("2")], "1")
		})

		expect(result.current.sessions).toHaveLength(2)
		expect(result.current.selectedId).toBe("1")

		// Delete the selected session
		act(() => {
			dispatchStateMessage([createSession("2")])
		})

		// Selected session should update to remaining session
		expect(result.current.sessions).toHaveLength(1)
		expect(result.current.selectedId).toBe("2")
	})

	it("should update session status without removing it", async () => {
		const wrapper = ({ children }: { children: React.ReactNode }) => <Provider>{children}</Provider>

		const { result } = renderHook(
			() => {
				useAgentManagerMessages()
				return {
					sessions: useAtomValue(sessionsArrayAtom),
					selectedId: useAtomValue(selectedSessionIdAtom),
				}
			},
			{ wrapper },
		)

		// Add a running session
		act(() => {
			dispatchStateMessage([createSession("1", "running")])
		})

		expect(result.current.sessions).toHaveLength(1)
		expect(result.current.sessions[0].status).toBe("running")

		// Update to stopped (simulating stop action)
		act(() => {
			dispatchStateMessage([createSession("1", "stopped")])
		})

		// Session should still exist but with updated status
		expect(result.current.sessions).toHaveLength(1)
		expect(result.current.sessions[0].status).toBe("stopped")
	})
})

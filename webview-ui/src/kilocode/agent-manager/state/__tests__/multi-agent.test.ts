import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { sessionMessagesAtomFamily, updateSessionMessagesAtom, updateSessionMessageByTsAtom } from "../atoms/messages"
import { upsertSessionAtom, removeSessionAtom, sessionsArrayAtom } from "../atoms/sessions"

describe("Multi-Agent State Isolation", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("Message isolation per session", () => {
		it("should keep messages separate between sessions", () => {
			// Agent 1 receives messages
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "Agent 1 response" }],
			})

			// Agent 2 receives messages
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-2",
				messages: [{ ts: 2000, type: "say", say: "text", text: "Agent 2 response" }],
			})

			// Each agent should only see its own messages
			const agent1Msgs = store.get(sessionMessagesAtomFamily("agent-1"))
			const agent2Msgs = store.get(sessionMessagesAtomFamily("agent-2"))

			expect(agent1Msgs).toHaveLength(1)
			expect(agent1Msgs[0]?.text).toBe("Agent 1 response")
			expect(agent2Msgs).toHaveLength(1)
			expect(agent2Msgs[0]?.text).toBe("Agent 2 response")
		})

		it("should handle concurrent streaming in multiple agents", () => {
			// Both agents streaming simultaneously
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "A1: partial", partial: true }],
			})
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-2",
				messages: [{ ts: 2000, type: "say", say: "text", text: "A2: partial", partial: true }],
			})

			// Agent 1 continues streaming
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "A1: more content...", partial: true }],
			})

			// Agent 2 completes
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-2",
				messages: [{ ts: 2000, type: "say", say: "text", text: "A2: done", partial: false }],
			})

			const a1 = store.get(sessionMessagesAtomFamily("agent-1"))
			const a2 = store.get(sessionMessagesAtomFamily("agent-2"))

			expect(a1[0]?.text).toBe("A1: more content...")
			expect(a1[0]?.partial).toBe(true)
			expect(a2[0]?.text).toBe("A2: done")
			expect(a2[0]?.partial).toBe(false)
		})

		it("should not cross-contaminate on messageUpdated", () => {
			// Setup both agents with messages
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "A1 msg" }],
			})
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-2",
				messages: [{ ts: 1000, type: "say", say: "text", text: "A2 msg" }], // Same ts!
			})

			// Update agent-1's message
			store.set(updateSessionMessageByTsAtom, {
				sessionId: "agent-1",
				message: { ts: 1000, type: "say", say: "text", text: "A1 updated" },
			})

			// Agent 2 should be unchanged
			const a1 = store.get(sessionMessagesAtomFamily("agent-1"))
			const a2 = store.get(sessionMessagesAtomFamily("agent-2"))

			expect(a1[0]?.text).toBe("A1 updated")
			expect(a2[0]?.text).toBe("A2 msg") // Unchanged!
		})
	})

	describe("Message reconciliation per session", () => {
		it("should protect completed messages from partial rollback", () => {
			// Initial: completed message with content
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "Complete message", partial: false }],
			})

			// Incoming: partial message with less content (stale update)
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "Partial", partial: true }],
			})

			// Should keep the completed message
			const result = store.get(sessionMessagesAtomFamily("agent-1"))
			expect(result[0]?.text).toBe("Complete message")
			expect(result[0]?.partial).toBe(false)
		})

		it("should accept streaming updates with more content", () => {
			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "Start", partial: true }],
			})

			store.set(updateSessionMessagesAtom, {
				sessionId: "agent-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "Start streaming...", partial: true }],
			})

			const result = store.get(sessionMessagesAtomFamily("agent-1"))
			expect(result[0]?.text).toBe("Start streaming...")
		})
	})

	describe("Session management", () => {
		it("should add and remove sessions", () => {
			store.set(upsertSessionAtom, {
				sessionId: "agent-1",
				label: "Test Agent",
				prompt: "test prompt",
				status: "running",
				startTime: Date.now(),
				source: "local",
			})

			expect(store.get(sessionsArrayAtom)).toHaveLength(1)

			store.set(removeSessionAtom, "agent-1")

			expect(store.get(sessionsArrayAtom)).toHaveLength(0)
		})

		it("should update existing session", () => {
			store.set(upsertSessionAtom, {
				sessionId: "agent-1",
				label: "Test",
				prompt: "p",
				status: "running",
				startTime: 1000,
				source: "local",
			})

			store.set(upsertSessionAtom, {
				sessionId: "agent-1",
				label: "Test",
				prompt: "p",
				status: "done",
				startTime: 1000,
				endTime: 2000,
				source: "local",
			})

			const sessions = store.get(sessionsArrayAtom)
			expect(sessions).toHaveLength(1)
			expect(sessions[0]?.status).toBe("done")
			expect(sessions[0]?.endTime).toBe(2000)
		})
	})
})

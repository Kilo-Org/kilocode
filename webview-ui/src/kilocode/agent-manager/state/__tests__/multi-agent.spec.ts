import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { sessionMessagesAtomFamily, updateSessionMessagesAtom, updateSessionMessageByTsAtom } from "../atoms/messages"
import {
	upsertSessionAtom,
	removeSessionAtom,
	sessionsArrayAtom,
	mergedSessionsAtom,
	setRemoteSessionsAtom,
	selectedSessionAtom,
	selectedSessionIdAtom,
	type RemoteSession,
} from "../atoms/sessions"

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

	describe("Remote session merging", () => {
		function createRemoteSession(id: string, title: string): RemoteSession {
			return {
				session_id: id,
				title,
				created_at: new Date(Date.now() - 60000).toISOString(),
				updated_at: new Date().toISOString(),
			}
		}

		it("should show only remote sessions when no local sessions exist", () => {
			store.set(setRemoteSessionsAtom, [
				createRemoteSession("remote-1", "Remote Session 1"),
				createRemoteSession("remote-2", "Remote Session 2"),
			])

			const merged = store.get(mergedSessionsAtom)
			expect(merged).toHaveLength(2)
			expect(merged[0]?.sessionId).toBe("remote-1")
			expect(merged[0]?.source).toBe("remote")
			expect(merged[1]?.sessionId).toBe("remote-2")
			expect(merged[1]?.source).toBe("remote")
		})

		it("should show only local sessions when no remote sessions exist", () => {
			store.set(upsertSessionAtom, {
				sessionId: "local-1",
				label: "Local Session",
				prompt: "test",
				status: "running",
				startTime: Date.now(),
				source: "local",
			})

			const merged = store.get(mergedSessionsAtom)
			expect(merged).toHaveLength(1)
			expect(merged[0]?.sessionId).toBe("local-1")
			expect(merged[0]?.source).toBe("local")
		})

		it("should deduplicate when local session has matching sessionId", () => {
			// Local session with a remote session ID
			store.set(upsertSessionAtom, {
				sessionId: "remote-session-123", // Same ID as remote session
				label: "My Local Session",
				prompt: "test",
				status: "running",
				startTime: Date.now(),
				source: "local",
			})

			// Remote sessions including the one we already have locally
			store.set(setRemoteSessionsAtom, [
				createRemoteSession("remote-session-123", "Remote Title"), // Same as local.sessionId
				createRemoteSession("remote-other", "Other Remote Session"),
			])

			const merged = store.get(mergedSessionsAtom)

			// Should only have 2 sessions (local + 1 remote), not 3
			expect(merged).toHaveLength(2)

			// First should be our local session (preserves local state)
			expect(merged[0]?.sessionId).toBe("remote-session-123")
			expect(merged[0]?.source).toBe("local")
			expect(merged[0]?.label).toBe("My Local Session") // Local label preserved

			// Second should be the other remote session
			expect(merged[1]?.sessionId).toBe("remote-other")
			expect(merged[1]?.source).toBe("remote")
		})

		it("should preserve local session state over remote state when deduplicating", () => {
			// Local session that's still running
			store.set(upsertSessionAtom, {
				sessionId: "remote-123", // Same ID as remote session
				label: "Running Task",
				prompt: "do something",
				status: "running", // Still running locally
				startTime: Date.now() - 5000,
				source: "local",
			})

			// Remote reports it as updated (maybe with stale data)
			store.set(setRemoteSessionsAtom, [createRemoteSession("remote-123", "Remote Title")])

			const merged = store.get(mergedSessionsAtom)

			expect(merged).toHaveLength(1)
			// Local session is preserved with its running status
			expect(merged[0]?.status).toBe("running")
			expect(merged[0]?.source).toBe("local")
		})

		it("should order local sessions before remote sessions", () => {
			// Add local session
			store.set(upsertSessionAtom, {
				sessionId: "local-1",
				label: "Local",
				prompt: "test",
				status: "running",
				startTime: Date.now(),
				source: "local",
			})

			// Add remote sessions
			store.set(setRemoteSessionsAtom, [
				createRemoteSession("remote-1", "Remote 1"),
				createRemoteSession("remote-2", "Remote 2"),
			])

			const merged = store.get(mergedSessionsAtom)

			expect(merged).toHaveLength(3)
			// Local first
			expect(merged[0]?.source).toBe("local")
			// Then remote
			expect(merged[1]?.source).toBe("remote")
			expect(merged[2]?.source).toBe("remote")
		})

		it("should convert remote session to AgentSession format correctly", () => {
			const now = new Date()
			const created = new Date(now.getTime() - 60000)

			store.set(setRemoteSessionsAtom, [
				{
					session_id: "remote-abc",
					title: "My Remote Task",
					created_at: created.toISOString(),
					updated_at: now.toISOString(),
				},
			])

			const merged = store.get(mergedSessionsAtom)

			expect(merged).toHaveLength(1)
			const session = merged[0]
			expect(session?.sessionId).toBe("remote-abc")
			expect(session?.label).toBe("My Remote Task")
			expect(session?.prompt).toBe("") // Not available from remote
			expect(session?.status).toBe("done") // Remote sessions assumed done
			expect(session?.source).toBe("remote")
			expect(session?.startTime).toBe(created.getTime())
			expect(session?.endTime).toBe(now.getTime())
		})

		it("should handle empty title from remote gracefully", () => {
			store.set(setRemoteSessionsAtom, [
				{
					session_id: "remote-1",
					title: "",
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				},
			])

			const merged = store.get(mergedSessionsAtom)
			expect(merged[0]?.label).toBe("Untitled")
		})
	})

	describe("selectedSessionAtom", () => {
		function createRemoteSession(id: string, title: string): RemoteSession {
			return {
				session_id: id,
				title,
				created_at: new Date(Date.now() - 60000).toISOString(),
				updated_at: new Date().toISOString(),
			}
		}

		it("returns null when no session is selected", () => {
			expect(store.get(selectedSessionAtom)).toBeNull()
		})

		it("returns null when selected ID does not exist", () => {
			store.set(selectedSessionIdAtom, "non-existent")
			expect(store.get(selectedSessionAtom)).toBeNull()
		})

		it("returns local session when selected", () => {
			store.set(upsertSessionAtom, {
				sessionId: "local-1",
				label: "Local Session",
				prompt: "test prompt",
				status: "running",
				startTime: Date.now(),
				source: "local",
			})
			store.set(selectedSessionIdAtom, "local-1")

			const selected = store.get(selectedSessionAtom)
			expect(selected?.sessionId).toBe("local-1")
			expect(selected?.label).toBe("Local Session")
			expect(selected?.source).toBe("local")
		})

		it("returns remote session when selected and not in local sessions", () => {
			store.set(setRemoteSessionsAtom, [createRemoteSession("remote-abc", "Remote Task")])
			store.set(selectedSessionIdAtom, "remote-abc")

			const selected = store.get(selectedSessionAtom)
			expect(selected?.sessionId).toBe("remote-abc")
			expect(selected?.label).toBe("Remote Task")
			expect(selected?.source).toBe("remote")
		})

		it("prefers local session over remote when both have same ID via sessionId", () => {
			// Local session with sessionId
			store.set(upsertSessionAtom, {
				sessionId: "local-1",
				label: "My Local Label",
				prompt: "test",
				status: "running",
				startTime: Date.now(),
				source: "local",
			})

			// Remote session (different ID)
			store.set(setRemoteSessionsAtom, [createRemoteSession("remote-xyz", "Remote Label")])

			// Select the local session
			store.set(selectedSessionIdAtom, "local-1")

			const selected = store.get(selectedSessionAtom)
			expect(selected?.sessionId).toBe("local-1")
			expect(selected?.label).toBe("My Local Label")
			expect(selected?.source).toBe("local")
		})

		it("finds remote session by session_id when not in local sessions", () => {
			// Only remote sessions, no local
			store.set(setRemoteSessionsAtom, [
				createRemoteSession("remote-1", "First Remote"),
				createRemoteSession("remote-2", "Second Remote"),
			])

			store.set(selectedSessionIdAtom, "remote-2")

			const selected = store.get(selectedSessionAtom)
			expect(selected?.sessionId).toBe("remote-2")
			expect(selected?.label).toBe("Second Remote")
		})
	})
})

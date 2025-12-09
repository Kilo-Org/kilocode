import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { updateSessionMessagesAtom } from "../atoms/messages"
import { sendSessionEventAtom, sessionMachineUiStateAtom, __resetStateMachines } from "../atoms/stateMachine"

describe("Streaming State Management", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		__resetStateMachines()
		store = createStore()
	})

	describe("State machine UI state from messages", () => {
		// Helper to initialize session state machine
		function initSession(sessionId: string) {
			store.set(sendSessionEventAtom, { sessionId, event: { type: "start_session" } })
			store.set(sendSessionEventAtom, { sessionId, event: { type: "session_created", sessionId } })
			store.set(sendSessionEventAtom, { sessionId, event: { type: "api_req_started" } })
		}

		it("should show spinner when streaming text", () => {
			initSession("session-1")
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "Hello" }],
			})

			const uiState = store.get(sessionMachineUiStateAtom)
			expect(uiState["session-1"]?.showSpinner).toBe(true)
		})

		it("should hide spinner when completion_result ask received", () => {
			initSession("session-1")
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [
					{ ts: 1000, type: "say", say: "text", text: "Working..." },
					{ ts: 2000, type: "ask", ask: "completion_result", text: "Task completed" },
				],
			})

			const uiState = store.get(sessionMachineUiStateAtom)
			expect(uiState["session-1"]?.showSpinner).toBe(false)
		})

		it("should hide spinner when followup ask received", () => {
			initSession("session-1")
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [
					{ ts: 1000, type: "say", say: "text", text: "I have a question" },
					{ ts: 2000, type: "ask", ask: "followup", text: "What should I do?" },
				],
			})

			const uiState = store.get(sessionMachineUiStateAtom)
			expect(uiState["session-1"]?.showSpinner).toBe(false)
		})

		it("should hide spinner when complete tool ask received", () => {
			initSession("session-1")
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [{ ts: 1000, type: "ask", ask: "tool", text: "Want to use a tool", partial: false }],
			})

			const uiState = store.get(sessionMachineUiStateAtom)
			expect(uiState["session-1"]?.showSpinner).toBe(false)
		})

		it("should keep spinner when partial tool ask received", () => {
			initSession("session-1")
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [{ ts: 1000, type: "ask", ask: "tool", text: "Want to use a tool", partial: true }],
			})

			const uiState = store.get(sessionMachineUiStateAtom)
			expect(uiState["session-1"]?.showSpinner).toBe(true)
		})

		it("should hide spinner when complete command ask received", () => {
			initSession("session-1")
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [{ ts: 1000, type: "ask", ask: "command", text: "Execute ls -la", partial: false }],
			})

			const uiState = store.get(sessionMachineUiStateAtom)
			expect(uiState["session-1"]?.showSpinner).toBe(false)
		})

		it("should hide spinner when api_req_failed ask received", () => {
			initSession("session-1")
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [
					{ ts: 1000, type: "ask", ask: "api_req_failed", text: "API request failed", partial: false },
				],
			})

			const uiState = store.get(sessionMachineUiStateAtom)
			expect(uiState["session-1"]?.showSpinner).toBe(false)
		})

		it("should hide spinner when resume_task ask received", () => {
			initSession("session-1")
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [{ ts: 1000, type: "ask", ask: "resume_task", text: "Resume?", partial: false }],
			})

			const uiState = store.get(sessionMachineUiStateAtom)
			expect(uiState["session-1"]?.showSpinner).toBe(false)
		})

		it("should show spinner again when api_req_started received after tool approval", () => {
			initSession("session-1")

			// Tool ask received
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [{ ts: 1000, type: "ask", ask: "tool", text: "Run command?", partial: false }],
			})
			expect(store.get(sessionMachineUiStateAtom)["session-1"]?.showSpinner).toBe(false)

			// Tool approved, new API request started
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [
					{ ts: 1000, type: "ask", ask: "tool", text: "Run command?", partial: false },
					{ ts: 2000, type: "say", say: "api_req_started" },
				],
			})
			expect(store.get(sessionMachineUiStateAtom)["session-1"]?.showSpinner).toBe(true)
		})

		it("should isolate UI state between sessions", () => {
			initSession("session-1")
			initSession("session-2")

			// Session 1 is waiting for input
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [{ ts: 1000, type: "ask", ask: "followup", text: "Question?" }],
			})

			// Session 2 is streaming
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-2",
				messages: [{ ts: 2000, type: "say", say: "text", text: "Working..." }],
			})

			const uiState = store.get(sessionMachineUiStateAtom)
			expect(uiState["session-1"]?.showSpinner).toBe(false)
			expect(uiState["session-2"]?.showSpinner).toBe(true)
		})
	})

	describe("State machine transitions via messages", () => {
		function initSession(sessionId: string) {
			store.set(sendSessionEventAtom, { sessionId, event: { type: "start_session" } })
			store.set(sendSessionEventAtom, { sessionId, event: { type: "session_created", sessionId } })
			store.set(sendSessionEventAtom, { sessionId, event: { type: "api_req_started" } })
		}

		it("should transition: streaming -> waiting (ask) -> streaming (response)", () => {
			initSession("session-1")

			// Agent starts streaming
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [{ ts: 1000, type: "say", say: "text", text: "Starting task..." }],
			})
			expect(store.get(sessionMachineUiStateAtom)["session-1"]?.showSpinner).toBe(true)

			// Agent asks for approval
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [
					{ ts: 1000, type: "say", say: "text", text: "Starting task..." },
					{ ts: 2000, type: "ask", ask: "tool", text: "Run command?" },
				],
			})
			expect(store.get(sessionMachineUiStateAtom)["session-1"]?.showSpinner).toBe(false)

			// User approves, agent continues with api_req_started
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [
					{ ts: 1000, type: "say", say: "text", text: "Starting task..." },
					{ ts: 2000, type: "ask", ask: "tool", text: "Run command?" },
					{ ts: 3000, type: "say", say: "api_req_started" },
				],
			})
			expect(store.get(sessionMachineUiStateAtom)["session-1"]?.showSpinner).toBe(true)
		})

		it("should transition to completed state on completion_result", () => {
			initSession("session-1")
			store.set(updateSessionMessagesAtom, {
				sessionId: "session-1",
				messages: [
					{ ts: 1000, type: "say", say: "text", text: "Starting..." },
					{ ts: 2000, type: "say", say: "text", text: "Working..." },
					{ ts: 3000, type: "ask", ask: "completion_result", text: "Done!" },
				],
			})

			const uiState = store.get(sessionMachineUiStateAtom)["session-1"]
			expect(uiState?.showSpinner).toBe(false)
			expect(uiState?.isActive).toBe(false)
		})
	})
})

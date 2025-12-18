import { describe, it, expect, beforeEach } from "vitest"

// Import the state machine (to be implemented)
import { createSessionStateMachine, type SessionStateMachine } from "../sessionStateMachine"

describe("Session State Machine", () => {
	let machine: SessionStateMachine

	beforeEach(() => {
		machine = createSessionStateMachine()
	})

	describe("Initial state", () => {
		it("should start in idle state", () => {
			expect(machine.getState()).toBe("idle")
		})
	})

	describe("State: idle", () => {
		it("should transition to creating on start_session", () => {
			machine.send({ type: "start_session" })
			expect(machine.getState()).toBe("creating")
		})

		it("should stay idle on irrelevant events", () => {
			machine.send({ type: "say_text", partial: false })
			expect(machine.getState()).toBe("idle")
		})

		it("should transition directly to streaming on session_created (multi-version hydration)", () => {
			// When sessions are created indirectly (e.g., multi-version mode),
			// the UI might miss start_session. session_created should hydrate to streaming.
			machine.send({ type: "session_created", sessionId: "test-123" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition directly to streaming on api_req_started (missed start)", () => {
			// If the state machine misses both start_session and session_created,
			// api_req_started should still hydrate to streaming.
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})
	})

	describe("State: creating", () => {
		beforeEach(() => {
			machine.send({ type: "start_session" })
		})

		it("should be in creating state after start_session", () => {
			expect(machine.getState()).toBe("creating")
		})

		it("should transition to streaming when session_created AND api_req_started both received", () => {
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("creating") // Still creating, waiting for session_created

			machine.send({ type: "session_created", sessionId: "test-123" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to streaming when session_created received after api_req_started", () => {
			machine.send({ type: "session_created", sessionId: "test-123" })
			expect(machine.getState()).toBe("creating") // Still creating, waiting for api_req_started

			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to error on process_error", () => {
			machine.send({ type: "process_error", error: "CLI crashed" })
			expect(machine.getState()).toBe("error")
		})

		it("should transition to stopped on cancel_session", () => {
			machine.send({ type: "cancel_session" })
			expect(machine.getState()).toBe("stopped")
		})

		it("should transition to streaming on api_req_started", () => {
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})
	})

	describe("State: streaming", () => {
		beforeEach(() => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
		})

		it("should be in streaming state", () => {
			expect(machine.getState()).toBe("streaming")
		})

		it("should stay streaming on partial say:text", () => {
			machine.send({ type: "say_text", partial: true })
			expect(machine.getState()).toBe("streaming")
		})

		it("should stay streaming on complete say:text", () => {
			machine.send({ type: "say_text", partial: false })
			expect(machine.getState()).toBe("streaming")
		})

		it("should stay streaming on partial ask:tool", () => {
			machine.send({ type: "ask_tool", partial: true })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to waiting_approval on complete ask:tool", () => {
			machine.send({ type: "ask_tool", partial: false })
			expect(machine.getState()).toBe("waiting_approval")
		})

		it("should stay streaming on partial ask:command", () => {
			machine.send({ type: "ask_command", partial: true })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to waiting_approval on complete ask:command", () => {
			machine.send({ type: "ask_command", partial: false })
			expect(machine.getState()).toBe("waiting_approval")
		})

		it("should transition to waiting_approval on complete ask:browser_action_launch", () => {
			machine.send({ type: "ask_browser_action_launch", partial: false })
			expect(machine.getState()).toBe("waiting_approval")
		})

		it("should transition to waiting_approval on complete ask:use_mcp_server", () => {
			machine.send({ type: "ask_use_mcp_server", partial: false })
			expect(machine.getState()).toBe("waiting_approval")
		})

		it("should stay streaming on partial ask:followup", () => {
			machine.send({ type: "ask_followup", partial: true })
			expect(machine.getState()).toBe("waiting_input")
		})

		it("should transition to waiting_input on complete ask:followup", () => {
			machine.send({ type: "ask_followup", partial: false })
			expect(machine.getState()).toBe("waiting_input")
		})

		it("should transition to completed on ask:completion_result", () => {
			machine.send({ type: "ask_completion_result" })
			expect(machine.getState()).toBe("completed")
		})

		it("should transition to error on ask:api_req_failed", () => {
			machine.send({ type: "ask_api_req_failed" })
			expect(machine.getState()).toBe("error")
		})

		it("should transition to error on ask:mistake_limit_reached", () => {
			machine.send({ type: "ask_mistake_limit_reached" })
			expect(machine.getState()).toBe("error")
		})

		it("should transition to error on ask:invalid_model", () => {
			machine.send({ type: "ask_invalid_model" })
			expect(machine.getState()).toBe("error")
		})

		it("should transition to error on ask:payment_required_prompt", () => {
			machine.send({ type: "ask_payment_required_prompt" })
			expect(machine.getState()).toBe("error")
		})

		it("should transition to paused on ask:resume_task", () => {
			machine.send({ type: "ask_resume_task" })
			expect(machine.getState()).toBe("paused")
		})

		it("should transition to stopped on cancel_session", () => {
			machine.send({ type: "cancel_session" })
			expect(machine.getState()).toBe("stopped")
		})

		it("should stay streaming on api_req_started (new request)", () => {
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})
	})

	describe("State: waiting_approval", () => {
		beforeEach(() => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			machine.send({ type: "ask_tool", partial: false })
		})

		it("should be in waiting_approval state", () => {
			expect(machine.getState()).toBe("waiting_approval")
		})

		it("should transition to streaming on approve_action", () => {
			machine.send({ type: "approve_action" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to streaming on reject_action", () => {
			machine.send({ type: "reject_action" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to streaming on api_req_started (auto-approved)", () => {
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to stopped on cancel_session", () => {
			machine.send({ type: "cancel_session" })
			expect(machine.getState()).toBe("stopped")
		})

		it("should transition to streaming on api_req_started", () => {
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})
	})

	describe("State: waiting_input", () => {
		beforeEach(() => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			machine.send({ type: "ask_followup", partial: false })
		})

		it("should be in waiting_input state", () => {
			expect(machine.getState()).toBe("waiting_input")
		})

		it("should transition to streaming on send_message", () => {
			machine.send({ type: "send_message", content: "my response" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to stopped on cancel_session", () => {
			machine.send({ type: "cancel_session" })
			expect(machine.getState()).toBe("stopped")
		})

		it("should transition to streaming on api_req_started", () => {
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})
	})

	describe("State: completed", () => {
		beforeEach(() => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			machine.send({ type: "ask_completion_result" })
		})

		it("should be in completed state", () => {
			expect(machine.getState()).toBe("completed")
		})

		it("should transition to streaming on send_message (continue)", () => {
			machine.send({ type: "send_message", content: "do more" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to creating on start_session (new task)", () => {
			machine.send({ type: "start_session" })
			expect(machine.getState()).toBe("creating")
		})

		it("should transition to streaming on api_req_started", () => {
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})
	})

	describe("State: paused", () => {
		beforeEach(() => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			machine.send({ type: "ask_resume_task" })
		})

		it("should be in paused state", () => {
			expect(machine.getState()).toBe("paused")
		})

		it("should transition to stopped on cancel_session", () => {
			machine.send({ type: "cancel_session" })
			expect(machine.getState()).toBe("stopped")
		})

		it("should transition to streaming on api_req_started", () => {
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})
	})

	describe("State: error", () => {
		beforeEach(() => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			machine.send({ type: "ask_api_req_failed" })
		})

		it("should be in error state", () => {
			expect(machine.getState()).toBe("error")
		})

		it("should transition to streaming on retry", () => {
			machine.send({ type: "retry" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should transition to stopped on cancel_session", () => {
			machine.send({ type: "cancel_session" })
			expect(machine.getState()).toBe("stopped")
		})
	})

	describe("State: stopped", () => {
		beforeEach(() => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			machine.send({ type: "cancel_session" })
		})

		it("should be in stopped state", () => {
			expect(machine.getState()).toBe("stopped")
		})

		it("should transition to creating on start_session (new task)", () => {
			machine.send({ type: "start_session" })
			expect(machine.getState()).toBe("creating")
		})
	})

	describe("Derived UI state", () => {
		it("should correctly derive showSpinner", () => {
			expect(machine.getUiState().showSpinner).toBe(false) // idle

			machine.send({ type: "start_session" })
			expect(machine.getUiState().showSpinner).toBe(true) // creating

			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			expect(machine.getUiState().showSpinner).toBe(true) // streaming

			machine.send({ type: "ask_tool", partial: false })
			expect(machine.getUiState().showSpinner).toBe(false) // waiting_approval

			machine.send({ type: "api_req_started" })
			expect(machine.getUiState().showSpinner).toBe(true) // back to streaming
		})

		it("should correctly derive showCancelButton", () => {
			expect(machine.getUiState().showCancelButton).toBe(false) // idle

			machine.send({ type: "start_session" })
			expect(machine.getUiState().showCancelButton).toBe(true) // creating

			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			expect(machine.getUiState().showCancelButton).toBe(true) // streaming

			machine.send({ type: "ask_followup", partial: false })
			expect(machine.getUiState().showCancelButton).toBe(true) // waiting_input

			machine.send({ type: "cancel_session" })
			expect(machine.getUiState().showCancelButton).toBe(false) // stopped
		})

		it("should correctly derive isActive", () => {
			expect(machine.getUiState().isActive).toBe(false) // idle

			machine.send({ type: "start_session" })
			expect(machine.getUiState().isActive).toBe(true) // creating

			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			expect(machine.getUiState().isActive).toBe(true) // streaming

			machine.send({ type: "ask_completion_result" })
			expect(machine.getUiState().isActive).toBe(false) // completed
		})
	})

	describe("Complex scenarios", () => {
		it("should handle streaming -> tool approval -> streaming -> completion flow", () => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")

			// Partial tool request (still streaming)
			machine.send({ type: "ask_tool", partial: true })
			expect(machine.getState()).toBe("streaming")

			// Complete tool request
			machine.send({ type: "ask_tool", partial: false })
			expect(machine.getState()).toBe("waiting_approval")

			// Auto-approved, new API request
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")

			// Agent responds
			machine.send({ type: "say_text", partial: true })
			expect(machine.getState()).toBe("streaming")
			machine.send({ type: "say_text", partial: false })
			expect(machine.getState()).toBe("streaming")

			// Task completed
			machine.send({ type: "ask_completion_result" })
			expect(machine.getState()).toBe("completed")
		})

		it("should handle multiple tool approvals in sequence", () => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })

			// First tool
			machine.send({ type: "ask_tool", partial: false })
			expect(machine.getState()).toBe("waiting_approval")
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")

			// Second tool
			machine.send({ type: "ask_command", partial: false })
			expect(machine.getState()).toBe("waiting_approval")
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")

			// Third tool
			machine.send({ type: "ask_tool", partial: false })
			expect(machine.getState()).toBe("waiting_approval")
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")
		})

		it("should handle error recovery", () => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })

			// API fails
			machine.send({ type: "ask_api_req_failed" })
			expect(machine.getState()).toBe("error")

			// User retries
			machine.send({ type: "retry" })
			expect(machine.getState()).toBe("streaming")

			// Succeeds this time
			machine.send({ type: "ask_completion_result" })
			expect(machine.getState()).toBe("completed")
		})

		it("should handle followup question flow", () => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })

			// Agent asks a question
			machine.send({ type: "ask_followup", partial: false })
			expect(machine.getState()).toBe("waiting_input")
			expect(machine.getUiState().showSpinner).toBe(false)

			// User responds
			machine.send({ type: "send_message", content: "the answer" })
			expect(machine.getState()).toBe("streaming")
			expect(machine.getUiState().showSpinner).toBe(true)
		})

		it("should handle session switching (reset)", () => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "test-123" })
			machine.send({ type: "api_req_started" })
			expect(machine.getState()).toBe("streaming")

			// Reset to idle (simulating session switch)
			machine.reset()
			expect(machine.getState()).toBe("idle")
		})
	})

	describe("Context tracking", () => {
		it("should track sessionId from session_created", () => {
			machine.send({ type: "start_session" })
			machine.send({ type: "session_created", sessionId: "abc-123" })

			expect(machine.getContext().sessionId).toBe("abc-123")
		})

		it("should track error messages", () => {
			machine.send({ type: "start_session" })
			machine.send({ type: "process_error", error: "Connection failed" })

			expect(machine.getContext().errorMessage).toBe("Connection failed")
		})

		it("should track sawApiReqStarted and sawSessionCreated flags", () => {
			machine.send({ type: "start_session" })

			expect(machine.getContext().sawApiReqStarted).toBe(false)
			expect(machine.getContext().sawSessionCreated).toBe(false)

			machine.send({ type: "api_req_started" })
			expect(machine.getContext().sawApiReqStarted).toBe(true)
			expect(machine.getContext().sawSessionCreated).toBe(false)

			machine.send({ type: "session_created", sessionId: "test" })
			expect(machine.getContext().sawApiReqStarted).toBe(true)
			expect(machine.getContext().sawSessionCreated).toBe(true)
		})
	})
})

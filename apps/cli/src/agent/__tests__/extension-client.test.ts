import {
	type ClineMessage,
	type ExtensionMessage,
	isIdleAsk,
	isResumableAsk,
	isInteractiveAsk,
	isNonBlockingAsk,
} from "@roo-code/types"

import { AgentLoopState, detectAgentState } from "../agent-state.js"
import { createMockClient } from "../extension-client.js"

function createMessage(overrides: Partial<ClineMessage>): ClineMessage {
	return { ts: Date.now() + Math.random() * 1000, type: "say", ...overrides }
}

function createStateMessage(messages: ClineMessage[], mode?: string): ExtensionMessage {
	return { type: "state", state: { clineMessages: messages, mode } } as ExtensionMessage
}

describe("detectAgentState", () => {
	describe("NO_TASK state", () => {
		it("should return NO_TASK for empty messages array", () => {
			const state = detectAgentState([])
			expect(state.state).toBe(AgentLoopState.NO_TASK)
			expect(state.isWaitingForInput).toBe(false)
			expect(state.isRunning).toBe(false)
		})

		it("should return NO_TASK for undefined messages", () => {
			const state = detectAgentState(undefined as unknown as ClineMessage[])
			expect(state.state).toBe(AgentLoopState.NO_TASK)
		})
	})

	describe("STREAMING state", () => {
		it("should detect streaming when partial is true", () => {
			const messages = [createMessage({ type: "ask", ask: "tool", partial: true })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.STREAMING)
			expect(state.isStreaming).toBe(true)
			expect(state.isWaitingForInput).toBe(false)
		})

		it("should detect streaming when api_req_started has no cost", () => {
			const messages = [
				createMessage({
					say: "api_req_started",
					text: JSON.stringify({ tokensIn: 100 }), // No cost field.
				}),
			]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.STREAMING)
			expect(state.isStreaming).toBe(true)
		})

		it("should NOT be streaming when api_req_started has cost", () => {
			const messages = [
				createMessage({
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.001, tokensIn: 100 }),
				}),
			]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.RUNNING)
			expect(state.isStreaming).toBe(false)
		})
	})

	describe("WAITING_FOR_INPUT state", () => {
		it("should detect waiting for tool approval", () => {
			const messages = [createMessage({ type: "ask", ask: "tool", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(state.isWaitingForInput).toBe(true)
			expect(state.currentAsk).toBe("tool")
			expect(state.requiredAction).toBe("approve")
		})

		it("should detect waiting for command approval", () => {
			const messages = [createMessage({ type: "ask", ask: "command", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(state.currentAsk).toBe("command")
			expect(state.requiredAction).toBe("approve")
		})

		it("should detect waiting for followup answer", () => {
			const messages = [createMessage({ type: "ask", ask: "followup", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(state.currentAsk).toBe("followup")
			expect(state.requiredAction).toBe("answer")
		})

		it("should detect waiting for browser_action_launch approval", () => {
			const messages = [createMessage({ type: "ask", ask: "browser_action_launch", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(state.requiredAction).toBe("approve")
		})

		it("should detect waiting for use_mcp_server approval", () => {
			const messages = [createMessage({ type: "ask", ask: "use_mcp_server", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(state.requiredAction).toBe("approve")
		})
	})

	describe("IDLE state", () => {
		it("should detect completion_result as idle", () => {
			const messages = [createMessage({ type: "ask", ask: "completion_result", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.IDLE)
			expect(state.isWaitingForInput).toBe(true)
			expect(state.requiredAction).toBe("start_task")
		})

		it("should detect api_req_failed as idle", () => {
			const messages = [createMessage({ type: "ask", ask: "api_req_failed", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.IDLE)
			expect(state.requiredAction).toBe("retry_or_new_task")
		})

		it("should detect mistake_limit_reached as idle", () => {
			const messages = [createMessage({ type: "ask", ask: "mistake_limit_reached", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.IDLE)
			expect(state.requiredAction).toBe("proceed_or_new_task")
		})

		it("should detect auto_approval_max_req_reached as idle", () => {
			const messages = [createMessage({ type: "ask", ask: "auto_approval_max_req_reached", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.IDLE)
			expect(state.requiredAction).toBe("start_new_task")
		})

		it("should detect resume_completed_task as idle", () => {
			const messages = [createMessage({ type: "ask", ask: "resume_completed_task", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.IDLE)
			expect(state.requiredAction).toBe("start_new_task")
		})
	})

	describe("RESUMABLE state", () => {
		it("should detect resume_task as resumable", () => {
			const messages = [createMessage({ type: "ask", ask: "resume_task", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.RESUMABLE)
			expect(state.isWaitingForInput).toBe(true)
			expect(state.requiredAction).toBe("resume_or_abandon")
		})
	})

	describe("RUNNING state", () => {
		it("should detect running for say messages", () => {
			const messages = [
				createMessage({
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.001 }),
				}),
				createMessage({ say: "text", text: "Working on it..." }),
			]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.RUNNING)
			expect(state.isRunning).toBe(true)
			expect(state.isWaitingForInput).toBe(false)
		})

		it("should detect running for command_output (non-blocking)", () => {
			const messages = [createMessage({ type: "ask", ask: "command_output", partial: false })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.RUNNING)
			expect(state.requiredAction).toBe("continue_or_abort")
		})
	})
})

describe("Type Guards", () => {
	describe("isIdleAsk", () => {
		it("should return true for idle asks", () => {
			expect(isIdleAsk("completion_result")).toBe(true)
			expect(isIdleAsk("api_req_failed")).toBe(true)
			expect(isIdleAsk("mistake_limit_reached")).toBe(true)
			expect(isIdleAsk("auto_approval_max_req_reached")).toBe(true)
			expect(isIdleAsk("resume_completed_task")).toBe(true)
		})

		it("should return false for non-idle asks", () => {
			expect(isIdleAsk("tool")).toBe(false)
			expect(isIdleAsk("followup")).toBe(false)
			expect(isIdleAsk("resume_task")).toBe(false)
		})
	})

	describe("isInteractiveAsk", () => {
		it("should return true for interactive asks", () => {
			expect(isInteractiveAsk("tool")).toBe(true)
			expect(isInteractiveAsk("command")).toBe(true)
			expect(isInteractiveAsk("followup")).toBe(true)
			expect(isInteractiveAsk("browser_action_launch")).toBe(true)
			expect(isInteractiveAsk("use_mcp_server")).toBe(true)
		})

		it("should return false for non-interactive asks", () => {
			expect(isInteractiveAsk("completion_result")).toBe(false)
			expect(isInteractiveAsk("command_output")).toBe(false)
		})
	})

	describe("isResumableAsk", () => {
		it("should return true for resumable asks", () => {
			expect(isResumableAsk("resume_task")).toBe(true)
		})

		it("should return false for non-resumable asks", () => {
			expect(isResumableAsk("completion_result")).toBe(false)
			expect(isResumableAsk("tool")).toBe(false)
		})
	})

	describe("isNonBlockingAsk", () => {
		it("should return true for non-blocking asks", () => {
			expect(isNonBlockingAsk("command_output")).toBe(true)
		})

		it("should return false for blocking asks", () => {
			expect(isNonBlockingAsk("tool")).toBe(false)
			expect(isNonBlockingAsk("followup")).toBe(false)
		})
	})
})

describe("ExtensionClient", () => {
	describe("State queries", () => {
		it("should return NO_TASK when not initialized", () => {
			const { client } = createMockClient()
			expect(client.getCurrentState()).toBe(AgentLoopState.NO_TASK)
			expect(client.isInitialized()).toBe(false)
		})

		it("should update state when receiving messages", () => {
			const { client } = createMockClient()

			const message = createStateMessage([createMessage({ type: "ask", ask: "tool", partial: false })])

			client.handleMessage(message)

			expect(client.isInitialized()).toBe(true)
			expect(client.getCurrentState()).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(client.isWaitingForInput()).toBe(true)
			expect(client.getCurrentAsk()).toBe("tool")
		})
	})

	describe("Event emission", () => {
		it("should emit stateChange events", () => {
			const { client } = createMockClient()
			const stateChanges: AgentLoopState[] = []

			client.onStateChange((event) => {
				stateChanges.push(event.currentState.state)
			})

			client.handleMessage(createStateMessage([createMessage({ type: "ask", ask: "tool", partial: false })]))

			expect(stateChanges).toContain(AgentLoopState.WAITING_FOR_INPUT)
		})

		it("should emit waitingForInput events", () => {
			const { client } = createMockClient()
			const waitingEvents: string[] = []

			client.onWaitingForInput((event) => {
				waitingEvents.push(event.ask)
			})

			client.handleMessage(createStateMessage([createMessage({ type: "ask", ask: "followup", partial: false })]))

			expect(waitingEvents).toContain("followup")
		})

		it("should allow unsubscribing from events", () => {
			const { client } = createMockClient()
			let callCount = 0

			const unsubscribe = client.onStateChange(() => {
				callCount++
			})

			client.handleMessage(createStateMessage([createMessage({ say: "text" })]))
			expect(callCount).toBe(1)

			unsubscribe()

			client.handleMessage(createStateMessage([createMessage({ say: "text", ts: Date.now() + 1 })]))
			expect(callCount).toBe(1) // Should not increase.
		})

		it("should emit modeChanged events", () => {
			const { client } = createMockClient()
			const modeChanges: { previousMode: string | undefined; currentMode: string }[] = []

			client.onModeChanged((event) => {
				modeChanges.push(event)
			})

			// Set initial mode
			client.handleMessage(createStateMessage([createMessage({ say: "text" })], "code"))

			expect(modeChanges).toHaveLength(1)
			expect(modeChanges[0]).toEqual({ previousMode: undefined, currentMode: "code" })

			// Change mode
			client.handleMessage(createStateMessage([createMessage({ say: "text" })], "architect"))

			expect(modeChanges).toHaveLength(2)
			expect(modeChanges[1]).toEqual({ previousMode: "code", currentMode: "architect" })
		})

		it("should not emit modeChanged when mode stays the same", () => {
			const { client } = createMockClient()
			let modeChangeCount = 0

			client.onModeChanged(() => {
				modeChangeCount++
			})

			// Set initial mode
			client.handleMessage(createStateMessage([createMessage({ say: "text" })], "code"))
			expect(modeChangeCount).toBe(1)

			// Same mode - should not emit
			client.handleMessage(createStateMessage([createMessage({ say: "text", ts: Date.now() + 1 })], "code"))
			expect(modeChangeCount).toBe(1)
		})
	})

	describe("Response methods", () => {
		it("should send approve response", () => {
			const { client, sentMessages } = createMockClient()

			client.approve()

			expect(sentMessages).toHaveLength(1)
			expect(sentMessages[0]).toEqual({
				type: "askResponse",
				askResponse: "yesButtonClicked",
				text: undefined,
				images: undefined,
			})
		})

		it("should send reject response", () => {
			const { client, sentMessages } = createMockClient()

			client.reject()

			expect(sentMessages).toHaveLength(1)
			const msg = sentMessages[0]
			expect(msg).toBeDefined()
			expect(msg?.askResponse).toBe("noButtonClicked")
		})

		it("should send text response", () => {
			const { client, sentMessages } = createMockClient()

			client.respond("My answer", ["image-data"])

			expect(sentMessages).toHaveLength(1)
			expect(sentMessages[0]).toEqual({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "My answer",
				images: ["image-data"],
			})
		})

		it("should send newTask message", () => {
			const { client, sentMessages } = createMockClient()

			client.newTask("Build a web app")

			expect(sentMessages).toHaveLength(1)
			expect(sentMessages[0]).toEqual({
				type: "newTask",
				text: "Build a web app",
				images: undefined,
			})
		})

		it("should send clearTask message", () => {
			const { client, sentMessages } = createMockClient()

			client.clearTask()

			expect(sentMessages).toHaveLength(1)
			expect(sentMessages[0]).toEqual({
				type: "clearTask",
			})
		})

		it("should send cancelTask message", () => {
			const { client, sentMessages } = createMockClient()

			client.cancelTask()

			expect(sentMessages).toHaveLength(1)
			expect(sentMessages[0]).toEqual({
				type: "cancelTask",
			})
		})

		it("should send terminal continue operation", () => {
			const { client, sentMessages } = createMockClient()

			client.continueTerminal()

			expect(sentMessages).toHaveLength(1)
			expect(sentMessages[0]).toEqual({
				type: "terminalOperation",
				terminalOperation: "continue",
			})
		})

		it("should send terminal abort operation", () => {
			const { client, sentMessages } = createMockClient()

			client.abortTerminal()

			expect(sentMessages).toHaveLength(1)
			expect(sentMessages[0]).toEqual({
				type: "terminalOperation",
				terminalOperation: "abort",
			})
		})
	})

	describe("Message handling", () => {
		it("should handle JSON string messages", () => {
			const { client } = createMockClient()

			const message = JSON.stringify(
				createStateMessage([createMessage({ type: "ask", ask: "completion_result", partial: false })]),
			)

			client.handleMessage(message)

			expect(client.getCurrentState()).toBe(AgentLoopState.IDLE)
		})

		it("should ignore invalid JSON", () => {
			const { client } = createMockClient()

			client.handleMessage("not valid json")

			expect(client.getCurrentState()).toBe(AgentLoopState.NO_TASK)
		})

		it("should handle messageUpdated messages", () => {
			const { client } = createMockClient()

			// First, set initial state.
			client.handleMessage(
				createStateMessage([createMessage({ ts: 123, type: "ask", ask: "tool", partial: true })]),
			)

			expect(client.isStreaming()).toBe(true)

			// Now update the message.
			client.handleMessage({
				type: "messageUpdated",
				clineMessage: createMessage({ ts: 123, type: "ask", ask: "tool", partial: false }),
			})

			expect(client.isStreaming()).toBe(false)
			expect(client.isWaitingForInput()).toBe(true)
		})
	})

	describe("Reset functionality", () => {
		it("should reset state", () => {
			const { client } = createMockClient()

			client.handleMessage(createStateMessage([createMessage({ type: "ask", ask: "tool", partial: false })]))

			expect(client.isInitialized()).toBe(true)
			expect(client.getCurrentState()).toBe(AgentLoopState.WAITING_FOR_INPUT)

			client.reset()

			expect(client.isInitialized()).toBe(false)
			expect(client.getCurrentState()).toBe(AgentLoopState.NO_TASK)
		})

		it("should reset mode on reset", () => {
			const { client } = createMockClient()

			client.handleMessage(createStateMessage([createMessage({ say: "text" })], "code"))
			expect(client.getCurrentMode()).toBe("code")

			client.reset()

			expect(client.getCurrentMode()).toBeUndefined()
		})
	})

	describe("Mode tracking", () => {
		it("should return undefined mode when not initialized", () => {
			const { client } = createMockClient()
			expect(client.getCurrentMode()).toBeUndefined()
		})

		it("should track mode from state messages", () => {
			const { client } = createMockClient()

			client.handleMessage(createStateMessage([createMessage({ say: "text" })], "code"))

			expect(client.getCurrentMode()).toBe("code")
		})

		it("should update mode when it changes", () => {
			const { client } = createMockClient()

			client.handleMessage(createStateMessage([createMessage({ say: "text" })], "code"))
			expect(client.getCurrentMode()).toBe("code")

			client.handleMessage(createStateMessage([createMessage({ say: "text", ts: Date.now() + 1 })], "architect"))
			expect(client.getCurrentMode()).toBe("architect")
		})

		it("should preserve mode when state message has no mode", () => {
			const { client } = createMockClient()

			// Set initial mode
			client.handleMessage(createStateMessage([createMessage({ say: "text" })], "code"))
			expect(client.getCurrentMode()).toBe("code")

			// State update without mode - should preserve existing mode
			client.handleMessage(createStateMessage([createMessage({ say: "text", ts: Date.now() + 1 })]))
			expect(client.getCurrentMode()).toBe("code")
		})

		it("should preserve mode when task is cleared", () => {
			const { client } = createMockClient()

			client.handleMessage(createStateMessage([createMessage({ say: "text" })], "architect"))
			expect(client.getCurrentMode()).toBe("architect")

			client.clearTask()
			// Mode should be preserved after clear
			expect(client.getCurrentMode()).toBe("architect")
		})
	})
})

describe("Integration", () => {
	it("should handle a complete task flow", () => {
		const { client } = createMockClient()
		const states: AgentLoopState[] = []

		client.onStateChange((event) => {
			states.push(event.currentState.state)
		})

		// 1. Task starts, API request begins.
		client.handleMessage(
			createStateMessage([
				createMessage({
					say: "api_req_started",
					text: JSON.stringify({}), // No cost = streaming.
				}),
			]),
		)
		expect(client.isStreaming()).toBe(true)

		// 2. API request completes.
		client.handleMessage(
			createStateMessage([
				createMessage({
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.001 }),
				}),
				createMessage({ say: "text", text: "I'll help you with that." }),
			]),
		)
		expect(client.isStreaming()).toBe(false)
		expect(client.isRunning()).toBe(true)

		// 3. Tool ask (partial).
		client.handleMessage(
			createStateMessage([
				createMessage({
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.001 }),
				}),
				createMessage({ say: "text", text: "I'll help you with that." }),
				createMessage({ type: "ask", ask: "tool", partial: true }),
			]),
		)
		expect(client.isStreaming()).toBe(true)

		// 4. Tool ask (complete).
		client.handleMessage(
			createStateMessage([
				createMessage({
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.001 }),
				}),
				createMessage({ say: "text", text: "I'll help you with that." }),
				createMessage({ type: "ask", ask: "tool", partial: false }),
			]),
		)
		expect(client.isWaitingForInput()).toBe(true)
		expect(client.getCurrentAsk()).toBe("tool")

		// 5. User approves, task completes.
		client.handleMessage(
			createStateMessage([
				createMessage({
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.001 }),
				}),
				createMessage({ say: "text", text: "I'll help you with that." }),
				createMessage({ type: "ask", ask: "tool", partial: false }),
				createMessage({ say: "text", text: "File created." }),
				createMessage({ type: "ask", ask: "completion_result", partial: false }),
			]),
		)
		expect(client.getCurrentState()).toBe(AgentLoopState.IDLE)
		expect(client.getCurrentAsk()).toBe("completion_result")

		// Verify we saw the expected state transitions.
		expect(states).toContain(AgentLoopState.STREAMING)
		expect(states).toContain(AgentLoopState.RUNNING)
		expect(states).toContain(AgentLoopState.WAITING_FOR_INPUT)
		expect(states).toContain(AgentLoopState.IDLE)
	})
})

describe("Edge Cases", () => {
	describe("Messages with missing or empty text field", () => {
		it("should handle ask message with missing text field", () => {
			const messages = [createMessage({ type: "ask", ask: "tool", partial: false })]
			// Text is undefined by default.
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(state.currentAsk).toBe("tool")
		})

		it("should handle ask message with empty text field", () => {
			const messages = [createMessage({ type: "ask", ask: "followup", partial: false, text: "" })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(state.currentAsk).toBe("followup")
		})

		it("should handle say message with missing text field", () => {
			const messages = [createMessage({ say: "text" })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.RUNNING)
		})
	})

	describe("api_req_started edge cases", () => {
		it("should handle api_req_started with empty text field as streaming", () => {
			const messages = [createMessage({ say: "api_req_started", text: "" })]
			const state = detectAgentState(messages)
			// Empty text is treated as "no text yet" = still in progress (streaming).
			// This matches the behavior: !message.text is true for "" (falsy).
			expect(state.state).toBe(AgentLoopState.STREAMING)
			expect(state.isStreaming).toBe(true)
		})

		it("should handle api_req_started with invalid JSON", () => {
			const messages = [createMessage({ say: "api_req_started", text: "not valid json" })]
			const state = detectAgentState(messages)
			// Invalid JSON should not crash, should return not streaming.
			expect(state.state).toBe(AgentLoopState.RUNNING)
			expect(state.isStreaming).toBe(false)
		})

		it("should handle api_req_started with null text", () => {
			const messages = [createMessage({ say: "api_req_started", text: undefined })]
			const state = detectAgentState(messages)
			// No text means still in progress (streaming).
			expect(state.state).toBe(AgentLoopState.STREAMING)
			expect(state.isStreaming).toBe(true)
		})

		it("should handle api_req_started with cost of 0", () => {
			const messages = [createMessage({ say: "api_req_started", text: JSON.stringify({ cost: 0 }) })]
			const state = detectAgentState(messages)
			// cost: 0 is defined (not undefined), so NOT streaming.
			expect(state.state).toBe(AgentLoopState.RUNNING)
			expect(state.isStreaming).toBe(false)
		})

		it("should handle api_req_started with cost of null", () => {
			const messages = [createMessage({ say: "api_req_started", text: JSON.stringify({ cost: null }) })]
			const state = detectAgentState(messages)
			// cost: null is defined (not undefined), so NOT streaming.
			expect(state.state).toBe(AgentLoopState.RUNNING)
			expect(state.isStreaming).toBe(false)
		})

		it("should find api_req_started when it's not the last message", () => {
			const messages = [
				createMessage({ say: "api_req_started", text: JSON.stringify({ tokensIn: 100 }) }), // No cost = streaming
				createMessage({ say: "text", text: "Some text" }),
			]
			const state = detectAgentState(messages)
			// Last message is say:text, but api_req_started has no cost.
			expect(state.state).toBe(AgentLoopState.STREAMING)
			expect(state.isStreaming).toBe(true)
		})
	})

	describe("Rapid state transitions", () => {
		it("should handle multiple rapid state changes", () => {
			const { client } = createMockClient()
			const states: AgentLoopState[] = []

			client.onStateChange((event) => {
				states.push(event.currentState.state)
			})

			// Rapid updates.
			client.handleMessage(createStateMessage([createMessage({ say: "text" })]))
			client.handleMessage(createStateMessage([createMessage({ type: "ask", ask: "tool", partial: true })]))
			client.handleMessage(createStateMessage([createMessage({ type: "ask", ask: "tool", partial: false })]))
			client.handleMessage(
				createStateMessage([createMessage({ type: "ask", ask: "completion_result", partial: false })]),
			)

			// Should have tracked all transitions.
			expect(states.length).toBeGreaterThanOrEqual(3)
			expect(states).toContain(AgentLoopState.STREAMING)
			expect(states).toContain(AgentLoopState.WAITING_FOR_INPUT)
			expect(states).toContain(AgentLoopState.IDLE)
		})
	})

	describe("Message array edge cases", () => {
		it("should handle single message array", () => {
			const messages = [createMessage({ say: "text", text: "Hello" })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.RUNNING)
			expect(state.lastMessage).toBeDefined()
			expect(state.lastMessageTs).toBe(messages[0]!.ts)
		})

		it("should use last message for state detection", () => {
			// Multiple messages, last one determines state.
			const messages = [
				createMessage({ type: "ask", ask: "tool", partial: false }),
				createMessage({ say: "text", text: "Tool executed" }),
				createMessage({ type: "ask", ask: "completion_result", partial: false }),
			]
			const state = detectAgentState(messages)
			// Last message is completion_result, so IDLE.
			expect(state.state).toBe(AgentLoopState.IDLE)
			expect(state.currentAsk).toBe("completion_result")
		})

		it("should handle very long message arrays", () => {
			// Create many messages.
			const messages: ClineMessage[] = []

			for (let i = 0; i < 100; i++) {
				messages.push(createMessage({ say: "text", text: `Message ${i}` }))
			}

			messages.push(createMessage({ type: "ask", ask: "followup", partial: false }))

			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(state.currentAsk).toBe("followup")
		})
	})

	describe("State message edge cases", () => {
		it("should handle state message with empty clineMessages", () => {
			const { client } = createMockClient()
			client.handleMessage({ type: "state", state: { clineMessages: [] } } as unknown as ExtensionMessage)
			expect(client.getCurrentState()).toBe(AgentLoopState.NO_TASK)
			expect(client.isInitialized()).toBe(true)
		})

		it("should handle state message with missing clineMessages", () => {
			const { client } = createMockClient()

			client.handleMessage({
				type: "state",
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				state: {} as any,
			})

			// Should not crash, state should remain unchanged.
			expect(client.getCurrentState()).toBe(AgentLoopState.NO_TASK)
		})

		it("should handle state message with missing state field", () => {
			const { client } = createMockClient()

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			client.handleMessage({ type: "state" } as any)

			// Should not crash
			expect(client.getCurrentState()).toBe(AgentLoopState.NO_TASK)
		})
	})

	describe("Partial to complete transitions", () => {
		it("should transition from streaming to waiting when partial becomes false", () => {
			const ts = Date.now()
			const messages1 = [createMessage({ ts, type: "ask", ask: "tool", partial: true })]
			const messages2 = [createMessage({ ts, type: "ask", ask: "tool", partial: false })]

			const state1 = detectAgentState(messages1)
			const state2 = detectAgentState(messages2)

			expect(state1.state).toBe(AgentLoopState.STREAMING)
			expect(state1.isWaitingForInput).toBe(false)

			expect(state2.state).toBe(AgentLoopState.WAITING_FOR_INPUT)
			expect(state2.isWaitingForInput).toBe(true)
		})

		it("should handle partial say messages", () => {
			const messages = [createMessage({ say: "text", text: "Typing...", partial: true })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.STREAMING)
			expect(state.isStreaming).toBe(true)
		})
	})

	describe("Unknown message types", () => {
		it("should handle unknown ask types gracefully", () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const messages = [createMessage({ type: "ask", ask: "unknown_type" as any, partial: false })]
			const state = detectAgentState(messages)
			// Unknown ask type should default to RUNNING.
			expect(state.state).toBe(AgentLoopState.RUNNING)
		})

		it("should handle unknown say types gracefully", () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const messages = [createMessage({ say: "unknown_say_type" as any })]
			const state = detectAgentState(messages)
			expect(state.state).toBe(AgentLoopState.RUNNING)
		})
	})
})

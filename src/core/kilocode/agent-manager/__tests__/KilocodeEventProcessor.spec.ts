import { describe, it, expect, vi } from "vitest"
import type { KilocodeStreamEvent } from "../CliOutputParser"
import { KilocodeEventProcessor } from "../KilocodeEventProcessor"
import { CliProcessHandler } from "../CliProcessHandler"
import { AgentRegistry } from "../AgentRegistry"
import type { ClineMessage } from "@roo-code/types"

function createDeps() {
	const processHandler = {
		stopProcess: vi.fn(),
	} as unknown as CliProcessHandler
	const registry = {
		updateSessionStatus: vi.fn(),
	} as unknown as AgentRegistry
	const sessionMessages = new Map<string, ClineMessage[]>()
	const firstApiReqStarted = new Map<string, boolean>()
	const log = vi.fn()
	const postChatMessages = vi.fn()
	const postState = vi.fn()
	const postStateEvent = vi.fn()
	const onPaymentRequiredPrompt = vi.fn()

	return {
		processHandler,
		registry,
		sessionMessages,
		firstApiReqStarted,
		log,
		postChatMessages,
		postState,
		postStateEvent,
		onPaymentRequiredPrompt,
	}
}

describe("KilocodeEventProcessor", () => {
	const sessionId = "session-1"

	it("skips user echo before api_req_started", () => {
		const deps = createDeps()
		const processor = new KilocodeEventProcessor(deps)

		const textEvent: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: { type: "say", say: "text", content: "user prompt" },
		}

		processor.handle(sessionId, textEvent)

		expect(deps.postChatMessages).not.toHaveBeenCalled()
		expect(deps.log).toHaveBeenCalledWith(sessionId, expect.stringContaining("skipping user input echo"))
	})

	it("records api_req_started and then allows subsequent text", () => {
		const deps = createDeps()
		const processor = new KilocodeEventProcessor(deps)

		const apiStarted: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: { type: "say", say: "api_req_started" },
		}
		const textEvent: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: { type: "say", say: "text", content: "agent response" },
		}

		processor.handle(sessionId, apiStarted)
		processor.handle(sessionId, textEvent)

		expect(deps.postChatMessages).toHaveBeenCalledTimes(1)
		const stored = deps.sessionMessages.get(sessionId)
		expect(stored?.[0].text).toBe("agent response")
	})

	it("calls postStateEvent with api_req_started when api_req_started is received", () => {
		const deps = createDeps()
		const processor = new KilocodeEventProcessor(deps)

		const apiStarted: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: { type: "say", say: "api_req_started" },
		}

		processor.handle(sessionId, apiStarted)

		expect(deps.postStateEvent).toHaveBeenCalledWith(sessionId, { eventType: "api_req_started" })
	})

	it("calls postStateEvent with ask_followup when followup ask is received", () => {
		const deps = createDeps()
		deps.firstApiReqStarted.set(sessionId, true) // Ensure text isn't filtered
		const processor = new KilocodeEventProcessor(deps)

		const followupEvent: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: { type: "ask", ask: "followup", partial: false, text: "What next?" },
		}

		processor.handle(sessionId, followupEvent)

		expect(deps.postStateEvent).toHaveBeenCalledWith(sessionId, { eventType: "ask_followup", partial: false })
	})

	it("calls postStateEvent with ask_completion_result when say:completion_result is received", () => {
		const deps = createDeps()
		deps.firstApiReqStarted.set(sessionId, true) // Ensure text isn't filtered
		const processor = new KilocodeEventProcessor(deps)

		const completionEvent: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: { type: "say", say: "completion_result", partial: false, content: "Done!" },
		}

		processor.handle(sessionId, completionEvent)

		expect(deps.postStateEvent).toHaveBeenCalledWith(sessionId, { eventType: "ask_completion_result" })
	})

	it("calls postStateEvent with ask_completion_result when ask:completion_result is received", () => {
		const deps = createDeps()
		deps.firstApiReqStarted.set(sessionId, true)
		const processor = new KilocodeEventProcessor(deps)

		const completionAskEvent: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: { type: "ask", ask: "completion_result" },
		}

		processor.handle(sessionId, completionAskEvent)

		expect(deps.postStateEvent).toHaveBeenCalledWith(sessionId, { eventType: "ask_completion_result" })
	})

	it("stops process and marks error on payment_required_prompt (once)", () => {
		const deps = createDeps()
		const processor = new KilocodeEventProcessor(deps)

		const payEvent: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: { type: "ask", ask: "payment_required_prompt", text: "Need billing" },
		}

		processor.handle(sessionId, payEvent)
		processor.handle(sessionId, payEvent) // duplicate should be ignored

		expect(deps.processHandler.stopProcess).toHaveBeenCalledWith(sessionId)
		expect(deps.registry.updateSessionStatus).toHaveBeenCalledWith(sessionId, "error", undefined, "Need billing")
		expect(deps.postState).toHaveBeenCalledTimes(1)
		// Only one message stored despite duplicate
		const stored = deps.sessionMessages.get(sessionId)
		expect(stored).toHaveLength(1)
	})

	it("calls onPaymentRequiredPrompt callback only once", () => {
		const deps = createDeps()
		const processor = new KilocodeEventProcessor(deps)

		const payEvent: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: { type: "ask", ask: "payment_required_prompt", text: "Need billing" },
		}

		processor.handle(sessionId, payEvent)
		processor.handle(sessionId, payEvent)

		expect(deps.onPaymentRequiredPrompt).toHaveBeenCalledTimes(1)
	})

	it("renders checkpoints as checkpoint_saved entries with no text", () => {
		const deps = createDeps()
		const processor = new KilocodeEventProcessor(deps)

		const checkpointEvent: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: {
				type: "say",
				say: "checkpoint_saved",
				checkpoint: { hash: "abc" },
			},
		}

		processor.handle(sessionId, checkpointEvent)
		const stored = deps.sessionMessages.get(sessionId)
		expect(stored?.[0].say).toBe("checkpoint_saved")
		expect(stored?.[0].text).toBe("")
	})

	it("extracts command_output text from metadata.output", () => {
		const deps = createDeps()
		deps.firstApiReqStarted.set(sessionId, true)
		const processor = new KilocodeEventProcessor(deps)

		const cmdOutputEvent: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: {
				type: "ask",
				ask: "command_output",
				timestamp: 123,
				metadata: { executionId: "exec-1", command: "echo pong", output: "pong\n" },
			},
		}

		processor.handle(sessionId, cmdOutputEvent)

		const stored = deps.sessionMessages.get(sessionId)
		expect(stored).toHaveLength(1)
		expect(stored?.[0].ask).toBe("command_output")
		expect(stored?.[0].text).toBe("pong\n")
	})

	it("keeps empty partial command_output messages (no placeholder text)", () => {
		const deps = createDeps()
		deps.firstApiReqStarted.set(sessionId, true)
		const processor = new KilocodeEventProcessor(deps)

		const cmdOutputStart: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: {
				type: "ask",
				ask: "command_output",
				partial: true,
				timestamp: 124,
				metadata: { executionId: "exec-2", command: "echo pong", output: "" },
			},
		}

		processor.handle(sessionId, cmdOutputStart)

		const stored = deps.sessionMessages.get(sessionId)
		expect(stored).toHaveLength(1)
		expect(stored?.[0].ask).toBe("command_output")
		expect(stored?.[0].partial).toBe(true)
		expect(stored?.[0].text).toBe("")
	})

	it("deduplicates command_output messages by executionId (not timestamp)", () => {
		const deps = createDeps()
		deps.firstApiReqStarted.set(sessionId, true)
		const processor = new KilocodeEventProcessor(deps)

		// First command_output event with isAnswered=false (waiting for approval)
		const cmdOutputPending: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: {
				type: "ask",
				ask: "command_output",
				partial: false,
				isAnswered: false,
				timestamp: 1000,
				metadata: { executionId: "exec-3", command: "pwd", output: "/home/user\n" },
			},
		}

		// Second command_output event with isAnswered=true (approved) - different timestamp
		const cmdOutputApproved: KilocodeStreamEvent = {
			streamEventType: "kilocode",
			payload: {
				type: "ask",
				ask: "command_output",
				partial: false,
				isAnswered: true,
				timestamp: 1003, // Different timestamp
				metadata: { executionId: "exec-3", command: "pwd", output: "/home/user\n" },
			},
		}

		processor.handle(sessionId, cmdOutputPending)
		processor.handle(sessionId, cmdOutputApproved)

		// Should only have one message (deduplicated by executionId)
		const stored = deps.sessionMessages.get(sessionId)
		expect(stored).toHaveLength(1)
		expect(stored?.[0].ask).toBe("command_output")
		expect(stored?.[0].isAnswered).toBe(true) // Should be the latest one
		expect(stored?.[0].text).toBe("/home/user\n")
	})
})

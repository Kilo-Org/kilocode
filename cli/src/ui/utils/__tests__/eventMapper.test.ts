import { describe, it, expect } from "vitest"
import { getCliMessageEvent, getExtensionMessageEvent } from "../eventMapper.js"
import type { CliMessage } from "../../../types/cli.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

function createCliMessage(overrides: Partial<CliMessage>): CliMessage {
	return {
		id: "test-id",
		type: "assistant",
		content: "test content",
		ts: Date.now(),
		...overrides,
	}
}

function createExtensionMessage(overrides: Partial<ExtensionChatMessage>): ExtensionChatMessage {
	return {
		ts: Date.now(),
		type: "say",
		...overrides,
	}
}

describe("getCliMessageEvent", () => {
	it("maps welcome type to system.welcome", () => {
		const message = createCliMessage({ type: "welcome" })
		expect(getCliMessageEvent(message)).toBe("system.welcome")
	})

	it("maps error type to system.error", () => {
		const message = createCliMessage({ type: "error" })
		expect(getCliMessageEvent(message)).toBe("system.error")
	})

	it("maps system type to system.info", () => {
		const message = createCliMessage({ type: "system" })
		expect(getCliMessageEvent(message)).toBe("system.info")
	})

	it("maps empty type to system.empty", () => {
		const message = createCliMessage({ type: "empty" })
		expect(getCliMessageEvent(message)).toBe("system.empty")
	})

	it("maps user type to user.message", () => {
		const message = createCliMessage({ type: "user" })
		expect(getCliMessageEvent(message)).toBe("user.message")
	})

	it("maps assistant type to assistant.message", () => {
		const message = createCliMessage({ type: "assistant" })
		expect(getCliMessageEvent(message)).toBe("assistant.message")
	})

	it("maps requestCheckpointRestoreApproval to task.checkpoint", () => {
		const message = createCliMessage({ type: "requestCheckpointRestoreApproval" })
		expect(getCliMessageEvent(message)).toBe("task.checkpoint")
	})
})

describe("getExtensionMessageEvent", () => {
	describe("ask messages", () => {
		it("maps tool ask to tool.request", () => {
			const message = createExtensionMessage({ type: "ask", ask: "tool" })
			expect(getExtensionMessageEvent(message)).toBe("tool.request")
		})

		it("maps command ask to tool.request", () => {
			const message = createExtensionMessage({ type: "ask", ask: "command" })
			expect(getExtensionMessageEvent(message)).toBe("tool.request")
		})

		it("maps followup ask to user.approval", () => {
			const message = createExtensionMessage({ type: "ask", ask: "followup" })
			expect(getExtensionMessageEvent(message)).toBe("user.approval")
		})

		it("maps api_req_failed ask to api.request_failed", () => {
			const message = createExtensionMessage({ type: "ask", ask: "api_req_failed" })
			expect(getExtensionMessageEvent(message)).toBe("api.request_failed")
		})

		it("maps completion_result ask to task.completed", () => {
			const message = createExtensionMessage({ type: "ask", ask: "completion_result" })
			expect(getExtensionMessageEvent(message)).toBe("task.completed")
		})

		it("maps resume_task ask to task.resumed", () => {
			const message = createExtensionMessage({ type: "ask", ask: "resume_task" })
			expect(getExtensionMessageEvent(message)).toBe("task.resumed")
		})

		it("maps command_output ask to tool.request", () => {
			const message = createExtensionMessage({ type: "ask", ask: "command_output" })
			expect(getExtensionMessageEvent(message)).toBe("tool.request")
		})

		it("maps unknown ask to unknown", () => {
			const message = createExtensionMessage({ type: "ask", ask: "some_unknown_type" })
			expect(getExtensionMessageEvent(message)).toBe("unknown")
		})
	})

	describe("say messages", () => {
		it("maps text say to assistant.message", () => {
			const message = createExtensionMessage({ type: "say", say: "text" })
			expect(getExtensionMessageEvent(message)).toBe("assistant.message")
		})

		it("maps user_feedback say to user.message", () => {
			const message = createExtensionMessage({ type: "say", say: "user_feedback" })
			expect(getExtensionMessageEvent(message)).toBe("user.message")
		})

		it("maps user_feedback_diff say to user.message", () => {
			const message = createExtensionMessage({ type: "say", say: "user_feedback_diff" })
			expect(getExtensionMessageEvent(message)).toBe("user.message")
		})

		it("maps reasoning say to assistant.reasoning", () => {
			const message = createExtensionMessage({ type: "say", say: "reasoning" })
			expect(getExtensionMessageEvent(message)).toBe("assistant.reasoning")
		})

		it("maps completion_result say to assistant.completion", () => {
			const message = createExtensionMessage({ type: "say", say: "completion_result" })
			expect(getExtensionMessageEvent(message)).toBe("assistant.completion")
		})

		it("maps api_req_started say to api.request_started", () => {
			const message = createExtensionMessage({ type: "say", say: "api_req_started" })
			expect(getExtensionMessageEvent(message)).toBe("api.request_started")
		})

		it("maps api_req_finished say to api.request_completed", () => {
			const message = createExtensionMessage({ type: "say", say: "api_req_finished" })
			expect(getExtensionMessageEvent(message)).toBe("api.request_completed")
		})

		it("maps command_output say to tool.output", () => {
			const message = createExtensionMessage({ type: "say", say: "command_output" })
			expect(getExtensionMessageEvent(message)).toBe("tool.output")
		})

		it("maps condense_context say to context.condensed", () => {
			const message = createExtensionMessage({ type: "say", say: "condense_context" })
			expect(getExtensionMessageEvent(message)).toBe("context.condensed")
		})

		it("maps sliding_window_truncation say to context.truncated", () => {
			const message = createExtensionMessage({ type: "say", say: "sliding_window_truncation" })
			expect(getExtensionMessageEvent(message)).toBe("context.truncated")
		})

		it("maps error say to system.error", () => {
			const message = createExtensionMessage({ type: "say", say: "error" })
			expect(getExtensionMessageEvent(message)).toBe("system.error")
		})

		it("maps unknown say to unknown", () => {
			const message = createExtensionMessage({ type: "say", say: "some_unknown_type" })
			expect(getExtensionMessageEvent(message)).toBe("unknown")
		})
	})

	it("returns unknown for message without ask or say", () => {
		const message = createExtensionMessage({ type: "ask" })
		expect(getExtensionMessageEvent(message)).toBe("unknown")
	})
})

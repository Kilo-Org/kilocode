import { describe, it, expect } from "vitest"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import { isResumeAskMessage, shouldWaitForResumeAsk } from "../resumePrompt.js"

describe("resumePrompt helpers", () => {
	it("detects resume ask messages", () => {
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "resume_task",
			text: "Resume?",
		}

		expect(isResumeAskMessage(message)).toBe(true)
	})

	it("returns false for non-resume ask messages", () => {
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "completion_result",
			text: "Completed",
		}

		expect(isResumeAskMessage(message)).toBe(false)
	})

	it("waits when session resumed but no active task yet", () => {
		expect(shouldWaitForResumeAsk(true, false, null)).toBe(true)
	})

	it("waits when session resumed and last message is not resume ask", () => {
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "completion_result",
			text: "Completed",
		}

		expect(shouldWaitForResumeAsk(true, true, message)).toBe(true)
	})

	it("does not wait when resume ask is present", () => {
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "resume_completed_task",
			text: "Resume completed?",
		}

		expect(shouldWaitForResumeAsk(true, true, message)).toBe(false)
	})
})

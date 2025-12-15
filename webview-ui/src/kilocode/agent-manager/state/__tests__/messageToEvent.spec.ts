import { describe, it, expect } from "vitest"
import { messageToEvent } from "../atoms/messages"

describe("messageToEvent", () => {
	it("maps resume_completed_task to ask_resume_task", () => {
		const event = messageToEvent({
			ts: 1,
			type: "ask",
			ask: "resume_completed_task",
			text: "Resume completed task?",
		})

		expect(event).toEqual({ type: "ask_resume_task" })
	})
})

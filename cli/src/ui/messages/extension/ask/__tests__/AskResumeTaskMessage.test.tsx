import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect } from "vitest"
import { AskResumeTaskMessage } from "../AskResumeTaskMessage.js"
import type { ExtensionChatMessage } from "../../../../../types/messages.js"

describe("AskResumeTaskMessage", () => {
	it("should render resume task message with basic content", () => {
		const message: ExtensionChatMessage = {
			type: "ask",
			ask: "resume_task",
			ts: Date.now(),
			text: "",
		}

		const { lastFrame } = render(<AskResumeTaskMessage message={message} />)

		const output = lastFrame()
		// Just check for key content - the component renders correctly
		expect(output).toContain("Task")
		expect(output).toContain("interrupted")
	})

	it("should render for resume_completed_task", () => {
		const message: ExtensionChatMessage = {
			type: "ask",
			ask: "resume_completed_task",
			ts: Date.now(),
			text: "",
		}

		const { lastFrame } = render(<AskResumeTaskMessage message={message} />)

		const output = lastFrame()
		expect(output).toContain("Task")
		expect(output).toContain("interrupted")
	})
})

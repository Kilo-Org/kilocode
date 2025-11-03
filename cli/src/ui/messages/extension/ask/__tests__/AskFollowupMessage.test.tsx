import { describe, it, expect } from "vitest"
import React from "react"
import { render } from "ink-testing-library"
import { AskFollowupMessage } from "../AskFollowupMessage.js"
import type { ExtensionChatMessage } from "../../../../../types/messages.js"

describe("AskFollowupMessage", () => {
	it("should render question and suggestions correctly", () => {
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "followup",
			text: JSON.stringify({
				question: "What would you like to do?",
				suggest: [{ answer: "Option 1" }, { answer: "Option 2" }, { answer: "Option 3" }],
			}),
			partial: false,
		}

		const { lastFrame } = render(<AskFollowupMessage message={message} />)

		expect(lastFrame()).toContain("What would you like to do?")
		expect(lastFrame()).toContain("1. Option 1")
		expect(lastFrame()).toContain("2. Option 2")
		expect(lastFrame()).toContain("3. Option 3")
	})

	it("should render suggestions with mode attribute", () => {
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "followup",
			text: JSON.stringify({
				question: "How should we proceed?",
				suggest: [
					{ answer: "Write code", mode: "code" },
					{ answer: "Debug issue", mode: "debug" },
				],
			}),
			partial: false,
		}

		const { lastFrame } = render(<AskFollowupMessage message={message} />)

		expect(lastFrame()).toContain("How should we proceed?")
		expect(lastFrame()).toContain("1. Write code")
		expect(lastFrame()).toContain("switch to code")
		expect(lastFrame()).toContain("2. Debug issue")
		expect(lastFrame()).toContain("switch to debug")
	})

	it("should handle the actual message format from the issue", () => {
		const message: ExtensionChatMessage = {
			ts: 1759531922682,
			type: "ask",
			ask: "followup",
			text: JSON.stringify({
				question:
					"I was unable to read the contents of the src/utils/paths.ts file as the operation was denied. Would you like me to try a different approach to analyze this file, or could you provide the file contents directly so I can explain what it does?",
				suggest: [
					{ answer: "Try using a different tool to analyze the file" },
					{ answer: "Provide the file contents directly in your next message" },
					{ answer: "Use search_files to look for references to this file in the codebase" },
					{ answer: "Skip this analysis - the file access is restricted" },
				],
			}),
			partial: false,
		}

		const { lastFrame } = render(<AskFollowupMessage message={message} />)

		expect(lastFrame()).toContain("I was unable to read the contents")
		expect(lastFrame()).toContain("1. Try using a different tool to analyze the file")
		expect(lastFrame()).toContain("2. Provide the file contents directly in your next message")
		expect(lastFrame()).toContain("3. Use search_files to look for references to this file in the codebase")
		expect(lastFrame()).toContain("4. Skip this analysis - the file access is restricted")
	})

	it("should handle message without suggestions", () => {
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "followup",
			text: JSON.stringify({
				question: "What is your preference?",
			}),
			partial: false,
		}

		const { lastFrame } = render(<AskFollowupMessage message={message} />)

		expect(lastFrame()).toContain("What is your preference?")
		expect(lastFrame()).not.toContain("Suggestions:")
	})

	it("should handle invalid JSON gracefully", () => {
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "followup",
			text: "invalid json {",
			partial: false,
		}

		const { lastFrame } = render(<AskFollowupMessage message={message} />)

		// Should render fallback with the raw text
		expect(lastFrame()).toContain("invalid json {")
	})

	it("should show answered indicator when message is answered", () => {
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "followup",
			text: JSON.stringify({
				question: "What would you like to do?",
				suggest: [{ answer: "Option 1" }],
			}),
			partial: false,
			isAnswered: true,
		}

		const { lastFrame } = render(<AskFollowupMessage message={message} />)

		expect(lastFrame()).toContain("✓ Answered")
	})
})

import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect } from "vitest"
import { SayCommandOutputMessage } from "../SayCommandOutputMessage.js"
import type { ExtensionChatMessage } from "../../../../../types/messages.js"

describe("SayCommandOutputMessage", () => {
	it("should render command output with text", () => {
		const message: ExtensionChatMessage = {
			type: "say",
			say: "command_output",
			text: "File created successfully\nBuild completed",
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayCommandOutputMessage message={message} />)
		expect(lastFrame()).toContain("File created successfully")
		expect(lastFrame()).toContain("Build completed")
	})

	it("should not render when text is empty", () => {
		const message: ExtensionChatMessage = {
			type: "say",
			say: "command_output",
			text: "",
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayCommandOutputMessage message={message} />)
		expect(lastFrame()).toBe("")
	})

	it("should not render when text is only whitespace", () => {
		const message: ExtensionChatMessage = {
			type: "say",
			say: "command_output",
			text: "   \n  \t  ",
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayCommandOutputMessage message={message} />)
		expect(lastFrame()).toBe("")
	})

	it("should render when text is undefined", () => {
		const message: ExtensionChatMessage = {
			type: "say",
			say: "command_output",
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayCommandOutputMessage message={message} />)
		expect(lastFrame()).toBe("")
	})

	it("should handle multiline command output", () => {
		const message: ExtensionChatMessage = {
			type: "say",
			say: "command_output",
			text: "npm install\ninstalling dependencies...\nDone in 2.5s",
			ts: Date.now(),
		}

		const { lastFrame } = render(<SayCommandOutputMessage message={message} />)
		const frame = lastFrame()
		expect(frame).toContain("npm install")
		expect(frame).toContain("installing dependencies")
		expect(frame).toContain("Done in 2.5s")
	})
})

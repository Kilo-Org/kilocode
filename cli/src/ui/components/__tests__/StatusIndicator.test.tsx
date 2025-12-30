/**
 * Tests for StatusIndicator component
 */

import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Provider as JotaiProvider } from "jotai"
import { createStore } from "jotai"
import { StatusIndicator } from "../StatusIndicator.js"
import { showFollowupSuggestionsAtom } from "../../../state/atoms/ui.js"
import { chatMessagesAtom } from "../../../state/atoms/extension.js"
import { exitPromptVisibleAtom } from "../../../state/atoms/keyboard.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

// Mock the hooks
vi.mock("../../../state/hooks/useWebviewMessage.js", () => ({
	useWebviewMessage: () => ({
		cancelTask: vi.fn(),
		resumeTask: vi.fn(),
	}),
}))

describe("StatusIndicator", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	it("should not render when disabled", () => {
		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={true} />
			</JotaiProvider>,
		)

		expect(lastFrame()).toBe("")
	})

	it("should show Thinking status and cancel hotkey when streaming", () => {
		// Set up a partial message to trigger streaming state
		const partialMessage: ExtensionChatMessage = {
			type: "say",
			say: "text",
			ts: Date.now(),
			text: "Processing...",
			partial: true,
		}
		store.set(chatMessagesAtom, [partialMessage])

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		expect(output).toContain("Thinking...")
		expect(output).toContain("to cancel")
		// Should show either Ctrl+X or Cmd+X depending on platform
		expect(output).toMatch(/(?:Ctrl|Cmd)\+X/)
	})

	it("should show followup hotkeys when suggestions are visible", () => {
		store.set(showFollowupSuggestionsAtom, true)

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		expect(output).toContain("to navigate")
		expect(output).toContain("to fill")
		expect(output).toContain("to submit")
	})

	it("should show general command hints when idle", () => {
		// No messages = not streaming
		store.set(chatMessagesAtom, [])
		store.set(showFollowupSuggestionsAtom, false)

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		expect(output).toContain("/help")
		expect(output).toContain("for commands")
	})

	it("should show exit confirmation prompt when Ctrl+C is pressed once", () => {
		store.set(exitPromptVisibleAtom, true)

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		expect(output).toMatch(/Press (?:Ctrl|Cmd)\+C again to exit\./)
	})

	it("should not show Thinking status when not streaming", () => {
		// Complete message = not streaming
		const completeMessage: ExtensionChatMessage = {
			type: "say",
			say: "text",
			ts: Date.now(),
			text: "Done!",
			partial: false,
		}
		store.set(chatMessagesAtom, [completeMessage])

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		expect(output).not.toContain("Thinking...")
	})

	it("should show resume task status and hotkey when resume_task is pending", () => {
		const resumeMessage: ExtensionChatMessage = {
			type: "ask",
			ask: "resume_task",
			ts: Date.now(),
			text: "",
		}
		store.set(chatMessagesAtom, [resumeMessage])

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		expect(output).toContain("Task ready to resume")
		expect(output).toContain("to resume")
		// Should show either Ctrl+R or Cmd+R depending on platform
		expect(output).toMatch(/(?:Ctrl|Cmd)\+R/)
	})

	it("should show resume task status for resume_completed_task", () => {
		const resumeMessage: ExtensionChatMessage = {
			type: "ask",
			ask: "resume_completed_task",
			ts: Date.now(),
			text: "",
		}
		store.set(chatMessagesAtom, [resumeMessage])

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		expect(output).toContain("Task ready to resume")
	})
})

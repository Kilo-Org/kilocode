/**
 * Tests for StatusIndicator component
 */

import React from "react"
import { render } from "ink-testing-library"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Provider as JotaiProvider } from "jotai"
import { createStore } from "jotai"
import { StatusIndicator } from "../StatusIndicator.js"
import { setFollowupSuggestionsAtom, isCancellingAtom } from "../../../state/atoms/ui.js"
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
		store.set(setFollowupSuggestionsAtom, [{ answer: "Yes, continue" }, { answer: "No, stop" }])

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
		store.set(setFollowupSuggestionsAtom, [])

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

	it("should show Cancelling status when isCancellingAtom is true", () => {
		// Set up streaming state with a partial message
		const partialMessage: ExtensionChatMessage = {
			type: "say",
			say: "text",
			ts: Date.now(),
			text: "Processing...",
			partial: true,
		}
		store.set(chatMessagesAtom, [partialMessage])
		// Set cancelling state
		store.set(isCancellingAtom, true)

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		expect(output).toContain("Cancelling...")
		// Should NOT show "Thinking..." when cancelling
		expect(output).not.toContain("Thinking...")
	})

	it("should show Cancelling instead of Thinking when both streaming and cancelling", () => {
		// Set up streaming state
		const partialMessage: ExtensionChatMessage = {
			type: "say",
			say: "text",
			ts: Date.now(),
			text: "Processing...",
			partial: true,
		}
		store.set(chatMessagesAtom, [partialMessage])
		store.set(isCancellingAtom, true)

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		// Should show Cancelling, not Thinking
		expect(output).toContain("Cancelling...")
		expect(output).not.toContain("Thinking...")
	})

	it("should show indicator after checkpoint_saved when task is still running", () => {
		// This reproduces the bug from issue #5251
		// After a checkpoint is saved, the indicator disappears because:
		// 1. The checkpoint_saved message is not partial
		// 2. The previous api_req_started has a cost (finished)
		// 3. The next api_req_started hasn't been sent yet
		// But the task is still running, so we should show an indicator

		const messages: ExtensionChatMessage[] = [
			// User started a task
			{
				type: "say",
				say: "text",
				ts: 1000,
				text: "Starting task...",
				partial: false,
			},
			// API request completed (has cost)
			{
				type: "say",
				say: "api_req_started",
				ts: 2000,
				text: JSON.stringify({ cost: 0.001, tokensIn: 100, tokensOut: 50 }),
				partial: false,
			},
			// Checkpoint was saved - this is the last message
			{
				type: "say",
				say: "checkpoint_saved",
				ts: 3000,
				text: "abc123",
				partial: false,
			},
		]
		store.set(chatMessagesAtom, messages)

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		// The task is still running (no completion_result), so we should show an indicator
		// Currently this fails because isStreamingAtom returns false
		expect(output).toMatch(/(?:Thinking|Processing)\.\.\./)
	})

	it("should NOT show indicator after completion_result", () => {
		// When the task is complete, we should NOT show any indicator
		const messages: ExtensionChatMessage[] = [
			{
				type: "say",
				say: "text",
				ts: 1000,
				text: "Starting task...",
				partial: false,
			},
			{
				type: "say",
				say: "api_req_started",
				ts: 2000,
				text: JSON.stringify({ cost: 0.001, tokensIn: 100, tokensOut: 50 }),
				partial: false,
			},
			{
				type: "say",
				say: "completion_result",
				ts: 3000,
				text: "Task completed successfully",
				partial: false,
			},
		]
		store.set(chatMessagesAtom, messages)

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		// Task is complete, should NOT show Thinking or Processing
		expect(output).not.toContain("Thinking...")
		expect(output).not.toContain("Processing...")
	})

	it("should NOT show indicator when waiting for tool approval", () => {
		// When waiting for user to approve a tool, we should NOT show indicator
		const messages: ExtensionChatMessage[] = [
			{
				type: "say",
				say: "text",
				ts: 1000,
				text: "Starting task...",
				partial: false,
			},
			{
				type: "say",
				say: "api_req_started",
				ts: 2000,
				text: JSON.stringify({ cost: 0.001, tokensIn: 100, tokensOut: 50 }),
				partial: false,
			},
			// Tool asking for approval
			{
				type: "ask",
				ask: "tool",
				ts: 3000,
				text: JSON.stringify({ tool: "write_to_file", path: "test.txt" }),
				partial: false,
			},
		]
		store.set(chatMessagesAtom, messages)

		const { lastFrame } = render(
			<JotaiProvider store={store}>
				<StatusIndicator disabled={false} />
			</JotaiProvider>,
		)

		const output = lastFrame()
		// Waiting for approval, should NOT show Thinking or Processing
		expect(output).not.toContain("Thinking...")
		expect(output).not.toContain("Processing...")
	})
})

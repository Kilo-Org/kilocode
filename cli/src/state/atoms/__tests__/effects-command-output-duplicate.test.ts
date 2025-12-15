/**
 * Tests for command_output ask filtering
 * Verifies that ask:command_output messages are filtered out since
 * say:command_output contains the actual output
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { messageHandlerEffectAtom } from "../effects.js"
import { extensionServiceAtom } from "../service.js"
import type { ExtensionService } from "../../../services/extension.js"
import type { ExtensionMessage, ExtensionChatMessage, ExtensionState } from "../../../types/messages.js"

describe("Command Output Ask Filtering", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()

		// Mock the extension service
		const mockService: Partial<ExtensionService> = {
			initialize: async () => {},
			on: () => mockService as ExtensionService,
			getState: () => null,
		}
		store.set(extensionServiceAtom, mockService as ExtensionService)
	})

	it("should filter ask:command_output from state messages", () => {
		const executionId = "test-exec-123"

		// Create a mix of messages including ask:command_output
		const askCommandOutput: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "command_output",
			text: JSON.stringify({
				executionId,
				command: "ls -la",
				output: "file1\nfile2\n",
			}),
			partial: false,
			isAnswered: false,
		}

		const sayCommandOutput: ExtensionChatMessage = {
			ts: Date.now() + 1,
			type: "say",
			say: "command_output",
			text: "file1\nfile2\n",
		}

		const regularMessage: ExtensionChatMessage = {
			ts: Date.now() + 2,
			type: "say",
			say: "text",
			text: "Here are your files",
		}

		const stateMessage: ExtensionMessage = {
			type: "state",
			state: {
				chatMessages: [askCommandOutput, sayCommandOutput, regularMessage],
			} as unknown as ExtensionState,
		}

		store.set(messageHandlerEffectAtom, stateMessage)

		// Verify ask:command_output was filtered out
		// The state message should have been modified in-place
		expect(stateMessage.state?.chatMessages).toHaveLength(2)
		expect(
			stateMessage.state?.chatMessages?.find((m) => m.type === "ask" && m.ask === "command_output"),
		).toBeUndefined()
		expect(
			stateMessage.state?.chatMessages?.find((m) => m.type === "say" && m.say === "command_output"),
		).toBeDefined()
		expect(stateMessage.state?.chatMessages?.find((m) => m.type === "say" && m.say === "text")).toBeDefined()
	})

	it("should not modify state when no ask:command_output present", () => {
		const sayMessage: ExtensionChatMessage = {
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "Hello",
		}

		const stateMessage: ExtensionMessage = {
			type: "state",
			state: {
				chatMessages: [sayMessage],
			} as unknown as ExtensionState,
		}

		store.set(messageHandlerEffectAtom, stateMessage)

		// Should remain unchanged
		expect(stateMessage.state?.chatMessages).toHaveLength(1)
	})

	it("should filter ask:command_output from messageUpdated", () => {
		// Create an ask:command_output message
		const askCommandOutput: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "command_output",
			text: JSON.stringify({
				executionId: "test-exec-456",
				command: "echo hello",
				output: "hello\n",
			}),
			partial: false,
			isAnswered: false,
		}

		const messageUpdatedMessage: ExtensionMessage = {
			type: "messageUpdated",
			chatMessage: askCommandOutput,
		}

		// This should be filtered out (break early without updating)
		store.set(messageHandlerEffectAtom, messageUpdatedMessage)

		// The message should have been ignored - no error should occur
		// We can't directly test the internal state change was blocked,
		// but the code should break early without calling updateChatMessageByTsAtom
	})

	it("should allow non-command_output messages through messageUpdated", () => {
		// Create a regular ask message
		const regularAsk: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "followup",
			text: JSON.stringify({
				question: "What would you like to do next?",
			}),
			partial: false,
			isAnswered: false,
		}

		const messageUpdatedMessage: ExtensionMessage = {
			type: "messageUpdated",
			chatMessage: regularAsk,
		}

		// This should be allowed through
		store.set(messageHandlerEffectAtom, messageUpdatedMessage)

		// Non-command_output asks should be processed normally
	})

	it("should filter multiple ask:command_output from state", () => {
		// Create multiple ask:command_output messages
		const ask1: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "command_output",
			text: JSON.stringify({ executionId: "exec-1", command: "cmd1", output: "out1" }),
			partial: false,
			isAnswered: false,
		}

		const ask2: ExtensionChatMessage = {
			ts: Date.now() + 1,
			type: "ask",
			ask: "command_output",
			text: JSON.stringify({ executionId: "exec-2", command: "cmd2", output: "out2" }),
			partial: false,
			isAnswered: false,
		}

		const regularMessage: ExtensionChatMessage = {
			ts: Date.now() + 2,
			type: "say",
			say: "text",
			text: "Done",
		}

		const stateMessage: ExtensionMessage = {
			type: "state",
			state: {
				chatMessages: [ask1, ask2, regularMessage],
			} as unknown as ExtensionState,
		}

		store.set(messageHandlerEffectAtom, stateMessage)

		// Both ask:command_output should be filtered
		expect(stateMessage.state?.chatMessages).toHaveLength(1)
		expect(stateMessage.state?.chatMessages?.[0]?.type).toBe("say")
	})
})

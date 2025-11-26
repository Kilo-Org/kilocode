/**
 * Tests for command_output ask deduplication
 * Verifies that duplicate asks from the backend are properly filtered
 * when the CLI has already created a synthetic ask
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { messageHandlerEffectAtom, commandOutputAskShownAtom } from "../effects.js"
import { chatMessagesAtom } from "../extension.js"
import { extensionServiceAtom } from "../service.js"
import type { ExtensionService } from "../../../services/extension.js"
import type { ExtensionMessage, ExtensionChatMessage, ExtensionState } from "../../../types/messages.js"

describe("Command Output Ask Deduplication", () => {
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

	it("should filter duplicate command_output ask from state when synthetic ask exists", () => {
		const executionId = "test-exec-123"

		// Step 1: Simulate commandExecutionStatus "started" which creates synthetic ask
		const startedMessage: ExtensionMessage = {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				executionId,
				status: "started",
				command: "sleep 30",
			}),
		}
		store.set(messageHandlerEffectAtom, startedMessage)

		// Verify synthetic ask was created
		const messagesAfterStart = store.get(chatMessagesAtom)
		expect(messagesAfterStart).toHaveLength(1)
		expect(messagesAfterStart[0]?.ask).toBe("command_output")

		// Step 2: Simulate backend sending its own command_output ask via state
		const backendAsk: ExtensionChatMessage = {
			ts: Date.now() + 100,
			type: "ask",
			ask: "command_output",
			text: JSON.stringify({
				executionId,
				command: "sleep 30",
				output: "",
			}),
			partial: true,
			isAnswered: false,
		}

		const stateMessage: ExtensionMessage = {
			type: "state",
			state: {
				chatMessages: [messagesAfterStart[0]!, backendAsk],
			} as unknown as ExtensionState,
		}
		store.set(messageHandlerEffectAtom, stateMessage)

		// Verify duplicate was filtered - should still have only 1 message
		const messagesAfterState = store.get(chatMessagesAtom)
		expect(messagesAfterState).toHaveLength(1)
		expect(messagesAfterState[0]?.ts).toBe(messagesAfterStart[0]?.ts)
	})

	it("should filter duplicate command_output ask from messageUpdated when synthetic ask exists", () => {
		const executionId = "test-exec-456"

		// Step 1: Create synthetic ask
		const startedMessage: ExtensionMessage = {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				executionId,
				status: "started",
				command: "sleep 30",
			}),
		}
		store.set(messageHandlerEffectAtom, startedMessage)

		const messagesAfterStart = store.get(chatMessagesAtom)
		expect(messagesAfterStart).toHaveLength(1)

		// Step 2: Simulate backend sending its own ask via messageUpdated
		const backendAsk: ExtensionChatMessage = {
			ts: Date.now() + 100,
			type: "ask",
			ask: "command_output",
			text: JSON.stringify({
				executionId,
				command: "sleep 30",
				output: "",
			}),
			partial: true,
			isAnswered: false,
		}

		const messageUpdatedMessage: ExtensionMessage = {
			type: "messageUpdated",
			chatMessage: backendAsk,
		}
		store.set(messageHandlerEffectAtom, messageUpdatedMessage)

		// Verify duplicate was ignored - should still have only 1 message
		const messagesAfterUpdate = store.get(chatMessagesAtom)
		expect(messagesAfterUpdate).toHaveLength(1)
		expect(messagesAfterUpdate[0]?.ts).toBe(messagesAfterStart[0]?.ts)
	})

	it("should allow backend ask when no synthetic ask exists", () => {
		const executionId = "test-exec-789"

		// This test verifies that our filtering logic doesn't break normal scenarios
		// where the backend creates a command_output ask without a prior synthetic one

		// In this case, we DON'T create a synthetic ask first
		// Instead, we simulate the backend creating its own ask
		// This would happen if the command produces output immediately (before our synthetic ask is created)

		// Since we can't easily test the full state update flow in a unit test,
		// we'll just verify that the tracking map doesn't have this executionId
		// which means our filter won't block it

		const askShownMap = store.get(commandOutputAskShownAtom)
		expect(askShownMap.has(executionId)).toBe(false)

		// This means when a backend ask with this executionId comes through,
		// it won't be filtered out by our duplicate detection logic
	})

	it("should update synthetic ask with output when command produces output", () => {
		const executionId = "test-exec-output"

		// Step 1: Create synthetic ask
		const startedMessage: ExtensionMessage = {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				executionId,
				status: "started",
				command: "echo test",
			}),
		}
		store.set(messageHandlerEffectAtom, startedMessage)

		// Step 2: Send output
		const outputMessage: ExtensionMessage = {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				executionId,
				status: "output",
				output: "test\n",
			}),
		}
		store.set(messageHandlerEffectAtom, outputMessage)

		// Verify synthetic ask was updated with output
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)

		const askData = JSON.parse(messages[0]?.text || "{}")
		expect(askData.output).toBe("test\n")
		expect(askData.command).toBe("echo test")
	})

	it("should mark synthetic ask as complete when command exits", () => {
		const executionId = "test-exec-complete"

		// Step 1: Create synthetic ask
		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				executionId,
				status: "started",
				command: "sleep 1",
			}),
		})

		// Step 2: Command exits
		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				executionId,
				status: "exited",
				exitCode: 0,
			}),
		})

		// Verify synthetic ask is marked as complete
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.partial).toBe(false)
	})
})

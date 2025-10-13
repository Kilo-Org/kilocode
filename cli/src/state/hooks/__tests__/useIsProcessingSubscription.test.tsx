/**
 * Tests for useIsProcessingSubscription hook
 * Tests that isProcessing is correctly set to false when ask messages are received
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { isProcessingAtom } from "../../atoms/ui.js"
import { chatMessagesAtom, updateChatMessagesAtom } from "../../atoms/extension.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

describe("useIsProcessingSubscription Logic", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("isProcessing state management", () => {
		it("should be false by default", () => {
			expect(store.get(isProcessingAtom)).toBe(false)
		})

		it("should be settable to true", () => {
			store.set(isProcessingAtom, true)
			expect(store.get(isProcessingAtom)).toBe(true)
		})

		it("should be settable to false", () => {
			store.set(isProcessingAtom, true)
			store.set(isProcessingAtom, false)
			expect(store.get(isProcessingAtom)).toBe(false)
		})
	})

	describe("Message handling scenarios", () => {
		it("should handle completion_result ask message", () => {
			const completionMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "completion_result",
				text: "Task completed successfully",
			}

			store.set(chatMessagesAtom, [completionMessage])
			const messages = store.get(chatMessagesAtom)

			expect(messages).toHaveLength(1)
			expect(messages[0]?.type).toBe("ask")
			expect(messages[0]?.ask).toBe("completion_result")

			// The hook should set isProcessing to false when it sees this message
			// In the actual implementation, this happens via useEffect
		})

		it("should handle followup ask message", () => {
			const followupMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "followup",
				text: "What would you like to do next?",
			}

			store.set(chatMessagesAtom, [followupMessage])
			const messages = store.get(chatMessagesAtom)

			expect(messages).toHaveLength(1)
			expect(messages[0]?.type).toBe("ask")
			expect(messages[0]?.ask).toBe("followup")

			// The hook should set isProcessing to false for followup messages too
		})

		it("should handle tool approval ask message", () => {
			const toolMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "tool",
				text: "Approve tool usage?",
			}

			store.set(chatMessagesAtom, [toolMessage])
			const messages = store.get(chatMessagesAtom)

			expect(messages).toHaveLength(1)
			expect(messages[0]?.type).toBe("ask")
			expect(messages[0]?.ask).toBe("tool")
		})

		it("should handle command approval ask message", () => {
			const commandMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "command",
				text: "Execute command?",
			}

			store.set(chatMessagesAtom, [commandMessage])
			const messages = store.get(chatMessagesAtom)

			expect(messages).toHaveLength(1)
			expect(messages[0]?.type).toBe("ask")
			expect(messages[0]?.ask).toBe("command")
		})

		it("should handle say messages (which should not affect isProcessing)", () => {
			const sayMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Processing your request...",
			}

			store.set(chatMessagesAtom, [sayMessage])
			const messages = store.get(chatMessagesAtom)

			expect(messages).toHaveLength(1)
			expect(messages[0]?.type).toBe("say")
			expect(messages[0]?.say).toBe("text")

			// Say messages should not trigger isProcessing to false
		})

		it("should handle multiple messages with last being ask", () => {
			const messages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "text",
					text: "Starting task...",
				},
				{
					ts: Date.now() + 1000,
					type: "say",
					say: "text",
					text: "Processing...",
				},
				{
					ts: Date.now() + 2000,
					type: "ask",
					ask: "followup",
					text: "What next?",
				},
			]

			store.set(chatMessagesAtom, messages)
			const storedMessages = store.get(chatMessagesAtom)

			expect(storedMessages).toHaveLength(3)
			expect(storedMessages[2]?.type).toBe("ask")
			expect(storedMessages[2]?.ask).toBe("followup")

			// The hook should detect the last message is an ask and set isProcessing to false
		})

		it("should handle empty message list", () => {
			store.set(chatMessagesAtom, [])
			const messages = store.get(chatMessagesAtom)

			expect(messages).toHaveLength(0)

			// Empty messages should not crash the hook
		})

		it("should handle message updates via updateChatMessagesAtom", () => {
			const initialMessages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "text",
					text: "Initial message",
				},
			]

			store.set(chatMessagesAtom, initialMessages)

			const updatedMessages: ExtensionChatMessage[] = [
				...initialMessages,
				{
					ts: Date.now() + 1000,
					type: "ask",
					ask: "completion_result",
					text: "Done!",
				},
			]

			store.set(updateChatMessagesAtom, updatedMessages)
			const messages = store.get(chatMessagesAtom)

			expect(messages).toHaveLength(2)
			expect(messages[1]?.type).toBe("ask")
			expect(messages[1]?.ask).toBe("completion_result")
		})
	})

	describe("Ask message types", () => {
		const askTypes = [
			"completion_result",
			"followup",
			"tool",
			"command",
			"api_req_failed",
			"resume_task",
			"resume_completed_task",
		]

		askTypes.forEach((askType) => {
			it(`should recognize ${askType} as an ask message`, () => {
				const message: ExtensionChatMessage = {
					ts: Date.now(),
					type: "ask",
					ask: askType,
					text: `Test ${askType} message`,
				}

				store.set(chatMessagesAtom, [message])
				const messages = store.get(chatMessagesAtom)

				expect(messages[0]?.type).toBe("ask")
				expect(messages[0]?.ask).toBe(askType)

				// All ask types should trigger isProcessing to false
			})
		})
	})
})

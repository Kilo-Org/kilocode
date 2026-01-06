/**
 * Tests for extension message update logic
 * Tests the simplified updateChatMessageByTsAtom that only updates existing messages
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { chatMessagesAtom, updateChatMessageByTsAtom, updateChatMessagesAtom } from "../extension.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

describe("updateChatMessageByTsAtom", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	it("should update existing message by timestamp with longer content", () => {
		// Setup: Add initial message
		const initialMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "Initial text",
			partial: false,
		}
		store.set(updateChatMessagesAtom, [initialMessage])

		// Update the message with longer content
		const updatedMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "Updated text with more content",
			partial: false,
		}
		store.set(updateChatMessageByTsAtom, updatedMessage)

		// Verify: Should have one message with updated text
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.text).toBe("Updated text with more content")
	})

	it("should ignore non-existent message (will come via state update)", () => {
		// Setup: Empty state
		store.set(updateChatMessagesAtom, [])

		// Try to update a message that doesn't exist
		const newMessage: ExtensionChatMessage = {
			ts: 1001,
			type: "say",
			say: "text",
			text: "New message",
			partial: false,
		}
		store.set(updateChatMessageByTsAtom, newMessage)

		// Verify: Should still be empty (message ignored, will come via state update)
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(0)
	})

	it("should ignore update for non-existent message even with different type", () => {
		// Setup: Add initial message
		const initialMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "First message",
			partial: false,
		}
		store.set(updateChatMessagesAtom, [initialMessage])

		// Try to update a different message that doesn't exist
		const newMessage: ExtensionChatMessage = {
			ts: 1001,
			type: "say",
			say: "api_req_started",
			text: "API request started",
			partial: false,
		}
		store.set(updateChatMessageByTsAtom, newMessage)

		// Verify: Should still have one message (new message ignored, will come via state update)
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.text).toBe("First message")
	})

	it("should always update partial messages regardless of content length", () => {
		// Setup: Add partial message
		const partialMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "Hello world",
			partial: true,
		}
		store.set(updateChatMessagesAtom, [partialMessage])

		// Update with shorter partial content (streaming can restart)
		const streamUpdate: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "Hi",
			partial: true,
		}
		store.set(updateChatMessageByTsAtom, streamUpdate)

		// Verify: Should accept the update even though it's shorter
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.text).toBe("Hi")
		expect(messages[0]?.partial).toBe(true)
	})

	it("should handle rapid streaming updates correctly", () => {
		// Setup: Add initial message via state
		const initialMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "H",
			partial: true,
		}
		store.set(updateChatMessagesAtom, [initialMessage])

		// Simulate rapid streaming updates with same timestamp
		const updates: ExtensionChatMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "He", partial: true },
			{ ts: 1000, type: "say", say: "text", text: "Hel", partial: true },
			{ ts: 1000, type: "say", say: "text", text: "Hell", partial: true },
			{ ts: 1000, type: "say", say: "text", text: "Hello", partial: false },
		]

		// Apply all updates
		for (const update of updates) {
			store.set(updateChatMessageByTsAtom, update)
		}

		// Verify: Should have only one message with final text
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.text).toBe("Hello")
		expect(messages[0]?.partial).toBe(false)
	})

	it("should ignore updates with shorter content for non-partial messages", () => {
		// Setup: Add complete message via updateChatMessageByTsAtom to initialize version map
		const completeMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "This is a long message",
			partial: false,
		}
		// First add via updateChatMessagesAtom
		store.set(updateChatMessagesAtom, [completeMessage])
		// Then update via updateChatMessageByTsAtom to initialize version tracking
		store.set(updateChatMessageByTsAtom, completeMessage)

		// Try to update with shorter content (should be ignored)
		const shorterMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "Short",
			partial: false,
		}
		store.set(updateChatMessageByTsAtom, shorterMessage)

		// Verify: Should keep the longer message (shorter update was ignored)
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.text).toBe("This is a long message")
	})

	it("should update non-partial messages when content changes but length stays the same", () => {
		// Setup: Add initial message and initialize version tracking
		const initialMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "api_req_started",
			text: '{"cost":0.0010}',
			partial: false,
		}
		store.set(updateChatMessagesAtom, [initialMessage])
		store.set(updateChatMessageByTsAtom, initialMessage)

		// Update with different content but identical length (cost changed, same number of digits)
		const updatedMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "api_req_started",
			text: '{"cost":0.0020}',
			partial: false,
		}
		expect(updatedMessage.text?.length).toBe(initialMessage.text?.length)
		store.set(updateChatMessageByTsAtom, updatedMessage)

		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.text).toBe('{"cost":0.0020}')
	})

	it("should handle ask messages correctly", () => {
		// Setup: Add partial ask message
		const partialAsk: ExtensionChatMessage = {
			ts: 1000,
			type: "ask",
			ask: "followup",
			text: "What would you like",
			partial: true,
		}
		store.set(updateChatMessagesAtom, [partialAsk])

		// Update with longer content
		const updatedAsk: ExtensionChatMessage = {
			ts: 1000,
			type: "ask",
			ask: "followup",
			text: "What would you like to do next?",
			partial: false,
		}
		store.set(updateChatMessageByTsAtom, updatedAsk)

		// Verify: Should have one message (updated)
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.text).toBe("What would you like to do next?")
	})

	it("should clear streaming flag when message completes", () => {
		// Setup: Add partial message
		const partialMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "Streaming...",
			partial: true,
		}
		store.set(updateChatMessagesAtom, [partialMessage])

		// Complete the message
		const completedMessage: ExtensionChatMessage = {
			ts: 1000,
			type: "say",
			say: "text",
			text: "Streaming complete!",
			partial: false,
		}
		store.set(updateChatMessageByTsAtom, completedMessage)

		// Verify: Message is updated and not partial
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.text).toBe("Streaming complete!")
		expect(messages[0]?.partial).toBe(false)
	})
})

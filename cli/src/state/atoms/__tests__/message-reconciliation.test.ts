/**
 * Tests for message reconciliation functionality
 * Verifies that streaming messages are protected from state rollbacks
 * and that version tracking prevents outdated updates
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import type { ExtensionChatMessage, ExtensionState } from "../../../types/messages.js"
import {
	chatMessagesAtom,
	messageVersionMapAtom,
	streamingMessagesSetAtom,
	updateExtensionStateAtom,
	updateChatMessageByTsAtom,
} from "../extension.js"

describe("Message Reconciliation", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("Streaming Protection", () => {
		it("should preserve streaming messages during state updates", () => {
			// Setup: Add initial message via state, then start streaming
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 1000,
						type: "say",
						say: "text",
						text: "Initial",
						partial: false,
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Start streaming
			const streamingMessage: ExtensionChatMessage = {
				ts: 1000,
				type: "say",
				say: "text",
				text: "This is a streaming message with more content",
				partial: true,
			}

			store.set(updateChatMessageByTsAtom, streamingMessage)

			// Verify streaming state is tracked
			const streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(true)

			// Simulate a state update with an older version of the same message
			const olderState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 1000,
						type: "say",
						say: "text",
						text: "This is shorter", // Older, shorter content
						partial: false,
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, olderState)

			// Verify the streaming message is preserved
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.text).toBe("This is a streaming message with more content")
			expect(messages[0]?.partial).toBe(true)
		})

		it("should clear streaming flag when message completes", () => {
			// Setup: Add initial message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 1000,
						type: "say",
						say: "text",
						text: "Initial",
						partial: false,
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Start streaming
			const streamingMessage: ExtensionChatMessage = {
				ts: 1000,
				type: "say",
				say: "text",
				text: "Streaming...",
				partial: true,
			}

			store.set(updateChatMessageByTsAtom, streamingMessage)
			expect(store.get(streamingMessagesSetAtom).has(1000)).toBe(true)

			// Complete the message
			const completedMessage: ExtensionChatMessage = {
				ts: 1000,
				type: "say",
				say: "text",
				text: "Streaming complete!",
				partial: false,
			}

			store.set(updateChatMessageByTsAtom, completedMessage)

			// Verify streaming flag is cleared
			expect(store.get(streamingMessagesSetAtom).has(1000)).toBe(false)
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.partial).toBe(false)
		})
	})

	describe("Version Tracking", () => {
		it("should reject updates with shorter content", () => {
			// Setup: Add initial message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 2000,
						type: "say",
						say: "text",
						text: "This is a long message with lots of content",
						partial: false,
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Try to update with shorter content
			const shorterMessage: ExtensionChatMessage = {
				ts: 2000,
				type: "say",
				say: "text",
				text: "Short",
				partial: false,
			}

			store.set(updateChatMessageByTsAtom, shorterMessage)

			// Verify the original message is preserved
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.text).toBe("This is a long message with lots of content")
		})

		it("should accept updates with longer content", () => {
			// Setup: Add initial message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 2000,
						type: "say",
						say: "text",
						text: "Short",
						partial: false,
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Update with longer content
			const longerMessage: ExtensionChatMessage = {
				ts: 2000,
				type: "say",
				say: "text",
				text: "This is a much longer message with more content",
				partial: false,
			}

			store.set(updateChatMessageByTsAtom, longerMessage)

			// Verify the longer message is accepted
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.text).toBe("This is a much longer message with more content")
		})

		it("should always accept partial messages for streaming", () => {
			// Setup: Add initial message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 3000,
						type: "say",
						say: "text",
						text: "This is a completed message",
						partial: false,
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Try to update with a shorter partial message (streaming restart)
			const partialMessage: ExtensionChatMessage = {
				ts: 3000,
				type: "say",
				say: "text",
				text: "New",
				partial: true,
			}

			store.set(updateChatMessageByTsAtom, partialMessage)

			// Verify partial message is accepted despite being shorter
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.text).toBe("New")
			expect(messages[0]?.partial).toBe(true)
		})
	})

	describe("Message Ordering", () => {
		it("should maintain chronological order", () => {
			// Setup: Add messages via state update first
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "First" },
					{ ts: 3000, type: "say", say: "text", text: "Third" },
					{ ts: 2000, type: "say", say: "text", text: "Second" },
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Verify they're sorted by timestamp
			const result = store.get(chatMessagesAtom)
			expect(result).toHaveLength(3)
			expect(result[0]?.text).toBe("First")
			expect(result[1]?.text).toBe("Second")
			expect(result[2]?.text).toBe("Third")
		})

		it("should handle out-of-order state updates", () => {
			// Receive a state update with messages
			const state: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "Older message" },
					{ ts: 2000, type: "say", say: "text", text: "Newer message" },
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, state)

			// Verify both messages are present and sorted
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.ts).toBe(1000)
			expect(messages[1]?.ts).toBe(2000)
		})
	})

	describe("Race Conditions", () => {
		it("should handle concurrent state and message updates", () => {
			// First add message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [{ ts: 1000, type: "say", say: "text", text: "A", partial: false }],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Simulate rapid streaming updates
			const streamingUpdates: ExtensionChatMessage[] = [
				{ ts: 1000, type: "say", say: "text", text: "AB", partial: true },
				{ ts: 1000, type: "say", say: "text", text: "ABC", partial: true },
			]

			// Apply streaming updates
			streamingUpdates.forEach((msg) => store.set(updateChatMessageByTsAtom, msg))

			// Simulate a state update arriving with an older version
			const state: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [{ ts: 1000, type: "say", say: "text", text: "A", partial: false }],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, state)

			// Verify the most recent streaming update is preserved
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.text).toBe("ABC")
			expect(messages[0]?.partial).toBe(true)
		})

		it("should handle multiple messages streaming simultaneously", () => {
			// Setup: Add initial messages via state update
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "Initial 1" },
					{ ts: 2000, type: "say", say: "text", text: "Initial 2" },
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Now start streaming updates for both messages
			const streamingMessage1: ExtensionChatMessage = {
				ts: 1000,
				type: "say",
				say: "text",
				text: "Message 1 streaming...",
				partial: true,
			}

			const streamingMessage2: ExtensionChatMessage = {
				ts: 2000,
				type: "say",
				say: "text",
				text: "Message 2 streaming...",
				partial: true,
			}

			store.set(updateChatMessageByTsAtom, streamingMessage1)
			store.set(updateChatMessageByTsAtom, streamingMessage2)

			// Verify both are tracked as streaming
			let streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(true)
			expect(streamingSet.has(2000)).toBe(true)

			// State update arrives with older content - should be rejected due to streaming protection
			const olderState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "Initial 1" }, // Older content
					{ ts: 2000, type: "say", say: "text", text: "Initial 2" }, // Older content
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, olderState)

			// Verify both streaming messages are preserved (protected by streaming flag)
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.text).toBe("Message 1 streaming...")
			expect(messages[0]?.partial).toBe(true)
			expect(messages[1]?.text).toBe("Message 2 streaming...")
			expect(messages[1]?.partial).toBe(true)

			// Verify streaming flags are still set
			streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(true)
			expect(streamingSet.has(2000)).toBe(true)
		})
	})

	describe("Version Tracking", () => {
		it("should reject updates with shorter content", () => {
			// Setup: Add initial message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 2000,
						type: "say",
						say: "text",
						text: "This is a long message with lots of content",
						partial: false,
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Try to update with shorter content
			const shorterMessage: ExtensionChatMessage = {
				ts: 2000,
				type: "say",
				say: "text",
				text: "Short",
				partial: false,
			}

			store.set(updateChatMessageByTsAtom, shorterMessage)

			// Verify the original message is preserved
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.text).toBe("This is a long message with lots of content")
		})

		it("should accept updates with longer content", () => {
			// Setup: Add initial message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 2000,
						type: "say",
						say: "text",
						text: "Short",
						partial: false,
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Update with longer content
			const longerMessage: ExtensionChatMessage = {
				ts: 2000,
				type: "say",
				say: "text",
				text: "This is a much longer message with more content",
				partial: false,
			}

			store.set(updateChatMessageByTsAtom, longerMessage)

			// Verify the longer message is accepted
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.text).toBe("This is a much longer message with more content")
		})

		it("should always accept partial messages for streaming", () => {
			// Setup: Add initial message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 3000,
						type: "say",
						say: "text",
						text: "This is a completed message",
						partial: false,
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Try to update with a shorter partial message (streaming restart)
			const partialMessage: ExtensionChatMessage = {
				ts: 3000,
				type: "say",
				say: "text",
				text: "New",
				partial: true,
			}

			store.set(updateChatMessageByTsAtom, partialMessage)

			// Verify partial message is accepted despite being shorter
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.text).toBe("New")
			expect(messages[0]?.partial).toBe(true)
		})
	})

	describe("Message Ordering", () => {
		it("should maintain chronological order", () => {
			// Setup: Add messages via state update first
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "First" },
					{ ts: 3000, type: "say", say: "text", text: "Third" },
					{ ts: 2000, type: "say", say: "text", text: "Second" },
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Verify they're sorted by timestamp
			const result = store.get(chatMessagesAtom)
			expect(result).toHaveLength(3)
			expect(result[0]?.text).toBe("First")
			expect(result[1]?.text).toBe("Second")
			expect(result[2]?.text).toBe("Third")
		})

		it("should handle out-of-order state updates", () => {
			// Receive a state update with messages
			const state: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "Older message" },
					{ ts: 2000, type: "say", say: "text", text: "Newer message" },
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, state)

			// Verify both messages are present and sorted
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.ts).toBe(1000)
			expect(messages[1]?.ts).toBe(2000)
		})
	})

	describe("Race Conditions", () => {
		it("should handle concurrent state and message updates", () => {
			// First add message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [{ ts: 1000, type: "say", say: "text", text: "A", partial: false }],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Simulate rapid streaming updates
			const streamingUpdates: ExtensionChatMessage[] = [
				{ ts: 1000, type: "say", say: "text", text: "AB", partial: true },
				{ ts: 1000, type: "say", say: "text", text: "ABC", partial: true },
			]

			// Apply streaming updates
			streamingUpdates.forEach((msg) => store.set(updateChatMessageByTsAtom, msg))

			// Simulate a state update arriving with an older version
			const state: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [{ ts: 1000, type: "say", say: "text", text: "A", partial: false }],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, state)

			// Verify the most recent streaming update is preserved
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.text).toBe("ABC")
			expect(messages[0]?.partial).toBe(true)
		})

		it("should handle multiple messages streaming simultaneously", () => {
			// Setup: Add initial messages via state update
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "Initial 1" },
					{ ts: 2000, type: "say", say: "text", text: "Initial 2" },
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Now start streaming updates for both messages
			const streamingMessage1: ExtensionChatMessage = {
				ts: 1000,
				type: "say",
				say: "text",
				text: "Message 1 streaming...",
				partial: true,
			}

			const streamingMessage2: ExtensionChatMessage = {
				ts: 2000,
				type: "say",
				say: "text",
				text: "Message 2 streaming...",
				partial: true,
			}

			store.set(updateChatMessageByTsAtom, streamingMessage1)
			store.set(updateChatMessageByTsAtom, streamingMessage2)

			// Verify both are tracked as streaming
			let streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(true)
			expect(streamingSet.has(2000)).toBe(true)

			// State update arrives with older content - should be rejected due to streaming protection
			const olderState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "Initial 1" }, // Older content
					{ ts: 2000, type: "say", say: "text", text: "Initial 2" }, // Older content
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, olderState)

			// Verify both streaming messages are preserved (protected by streaming flag)
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.text).toBe("Message 1 streaming...")
			expect(messages[0]?.partial).toBe(true)
			expect(messages[1]?.text).toBe("Message 2 streaming...")
			expect(messages[1]?.partial).toBe(true)

			// Verify streaming flags are still set
			streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(true)
			expect(streamingSet.has(2000)).toBe(true)
		})
	})

	describe("State Reconciliation", () => {
		it("should accept all messages from state (state is source of truth for count)", () => {
			// State determines which messages exist
			const state: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "First" },
					{ ts: 2000, type: "say", say: "text", text: "Second" },
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, state)

			// Should have both messages from state
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.text).toBe("First")
			expect(messages[1]?.text).toBe("Second")
		})

		it("should preserve streaming message content when state has older version", () => {
			// Setup: Initial state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [{ ts: 1000, type: "say", say: "text", text: "Initial" }],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// Start streaming with more content
			const streamingMessage: ExtensionChatMessage = {
				ts: 1000,
				type: "say",
				say: "text",
				text: "Initial with streaming content added",
				partial: true,
			}

			store.set(updateChatMessageByTsAtom, streamingMessage)

			// State update arrives with older (shorter) content
			const olderState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [{ ts: 1000, type: "say", say: "text", text: "Initial", partial: false }],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, olderState)

			// Should preserve the streaming content (longer version)
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.text).toBe("Initial with streaming content added")
			expect(messages[0]?.partial).toBe(true)
		})

		it("should accept newer state content when not actively streaming", () => {
			// Setup: Initial state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [{ ts: 1000, type: "say", say: "text", text: "Old content" }],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			// State update with new content (not streaming)
			const newerState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [{ ts: 1000, type: "say", say: "text", text: "New content from state" }],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, newerState)

			// Should accept the new state content
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.text).toBe("New content from state")
		})
	})

	describe("Version Map Management", () => {
		it("should track versions for all messages", () => {
			// Add messages via state first
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{ ts: 1000, type: "say", say: "text", text: "Short" },
					{ ts: 2000, type: "say", say: "text", text: "Medium length" },
					{ ts: 3000, type: "say", say: "text", text: "This is a very long message" },
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)

			const versionMap = store.get(messageVersionMapAtom)
			// Version = text.length + say.length
			expect(versionMap.get(1000)).toBe(9) // "Short" (5) + "text" (4)
			expect(versionMap.get(2000)).toBe(17) // "Medium length" (13) + "text" (4)
			expect(versionMap.get(3000)).toBe(31) // "This is a very long message" (27) + "text" (4)
		})

		it("should update versions when messages are updated", () => {
			// Add initial message via state
			const initialState: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [
					{
						ts: 1000,
						type: "say",
						say: "text",
						text: "Initial",
					},
				],
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}

			store.set(updateExtensionStateAtom, initialState)
			// Version = "Initial" (7) + "text" (4) = 11
			expect(store.get(messageVersionMapAtom).get(1000)).toBe(11)

			const updatedMessage: ExtensionChatMessage = {
				ts: 1000,
				type: "say",
				say: "text",
				text: "Updated with more content",
			}

			store.set(updateChatMessageByTsAtom, updatedMessage)
			// Version = "Updated with more content" (25) + "text" (4) = 29
			expect(store.get(messageVersionMapAtom).get(1000)).toBe(29)
		})
	})
})

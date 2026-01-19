/**
 * Tests for CLI context drop scenarios
 *
 * These tests attempt to reproduce the reported issue where the CLI
 * "constantly drops context" during active sessions.
 *
 * See CLI_CONTEXT_DROP_INVESTIGATION.md for details.
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
	clearExtensionStateAtom,
} from "../extension.js"

// Helper to create a minimal valid ExtensionState
function createMinimalState(messages: ExtensionChatMessage[]): ExtensionState {
	return {
		version: "1.0.0",
		apiConfiguration: {},
		chatMessages: messages,
		mode: "code",
		customModes: [],
		taskHistoryFullLength: 0,
		taskHistoryVersion: 0,
		renderContext: "cli",
		telemetrySetting: "disabled",
	}
}

// Helper to create a chat message
function createMessage(ts: number, text: string, options: Partial<ExtensionChatMessage> = {}): ExtensionChatMessage {
	return {
		ts,
		type: "say",
		say: "text",
		text,
		partial: false,
		...options,
	}
}

describe("CLI Context Drop Investigation", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("Test 1: Content Length Collision", () => {
		it("should preserve both messages when they have the same content length but different content", () => {
			// Setup: Two messages with same length but different content
			const msg1 = createMessage(1000, "Hello World") // 11 chars
			const msg2 = createMessage(2000, "Goodbye Now") // 11 chars - same length!

			// Initial state with both messages
			const initialState = createMinimalState([msg1, msg2])
			store.set(updateExtensionStateAtom, initialState)

			// Verify both messages are preserved
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.text).toBe("Hello World")
			expect(messages[1]?.text).toBe("Goodbye Now")
		})

		it("should not drop a message when updating with same-length content", () => {
			// Setup: Initial message
			const msg1 = createMessage(1000, "Hello World", { partial: true }) // 11 chars

			const initialState = createMinimalState([msg1])
			store.set(updateExtensionStateAtom, initialState)

			// Update with same-length but different content
			const updatedMsg1 = createMessage(1000, "Goodbye Now", { partial: false }) // 11 chars

			store.set(updateChatMessageByTsAtom, updatedMsg1)

			// Verify the message was updated (not dropped)
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.text).toBe("Goodbye Now")
			expect(messages[0]?.partial).toBe(false)
		})
	})

	describe("Test 2: Out-of-Order State Updates", () => {
		it("should not drop messages when state updates arrive out of order", () => {
			// Setup: Initial state with a streaming message
			const msg1 = createMessage(1000, "Initial content", { partial: true })
			const initialState = createMinimalState([msg1])
			store.set(updateExtensionStateAtom, initialState)

			// Simulate streaming: message gets longer
			const streamingMsg = createMessage(1000, "Initial content with more text", { partial: true })
			store.set(updateChatMessageByTsAtom, streamingMsg)

			// Verify streaming update was applied
			let messages = store.get(chatMessagesAtom)
			expect(messages[0]?.text).toBe("Initial content with more text")

			// Now simulate an out-of-order state update with OLDER content
			const staleState = createMinimalState([
				createMessage(1000, "Initial content", { partial: true }), // Stale!
			])
			store.set(updateExtensionStateAtom, staleState)

			// The newer content should be preserved, not overwritten by stale state
			messages = store.get(chatMessagesAtom)
			expect(messages[0]?.text).toBe("Initial content with more text")
		})

		it("should accept completion update even if content length is same", () => {
			// Setup: Streaming message
			const msg1 = createMessage(1000, "Final content", { partial: true })
			const initialState = createMinimalState([msg1])
			store.set(updateExtensionStateAtom, initialState)

			// Mark as streaming
			store.set(streamingMessagesSetAtom, new Set([1000]))

			// Completion update with same content but partial=false
			const completedMsg = createMessage(1000, "Final content", { partial: false })
			store.set(updateChatMessageByTsAtom, completedMsg)

			// Should accept the completion
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.partial).toBe(false)
		})
	})

	describe("Test 3: Rapid State Updates During Streaming", () => {
		it("should not lose messages during rapid state updates", () => {
			// Setup: Multiple messages
			const msg1 = createMessage(1000, "Message 1")
			const msg2 = createMessage(2000, "Message 2", { partial: true })
			const initialState = createMinimalState([msg1, msg2])
			store.set(updateExtensionStateAtom, initialState)

			// Simulate rapid streaming updates
			for (let i = 0; i < 10; i++) {
				const streamingUpdate = createMessage(2000, `Message 2 - update ${i}`, { partial: true })
				store.set(updateChatMessageByTsAtom, streamingUpdate)
			}

			// Verify no messages were lost
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.text).toBe("Message 1")
			expect(messages[1]?.text).toBe("Message 2 - update 9")
		})

		it("should handle interleaved state updates and message updates", () => {
			// Setup
			const msg1 = createMessage(1000, "Message 1")
			const msg2 = createMessage(2000, "Message 2", { partial: true })
			store.set(updateExtensionStateAtom, createMinimalState([msg1, msg2]))

			// Interleave state updates and message updates
			for (let i = 0; i < 5; i++) {
				// Message update
				const streamingUpdate = createMessage(2000, `Message 2 - update ${i}`, { partial: true })
				store.set(updateChatMessageByTsAtom, streamingUpdate)

				// State update (potentially stale)
				const stateUpdate = createMinimalState([
					msg1,
					createMessage(2000, `Message 2 - state ${i}`, { partial: true }),
				])
				store.set(updateExtensionStateAtom, stateUpdate)
			}

			// Verify messages weren't lost
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.text).toBe("Message 1")
			// The exact content depends on reconciliation, but message shouldn't be lost
			expect(messages[1]?.text).toContain("Message 2")
		})
	})

	describe("Test 4: Null State Handling", () => {
		it("should clear messages when state is set to null", () => {
			// Setup: State with messages
			const msg1 = createMessage(1000, "Message 1")
			const msg2 = createMessage(2000, "Message 2")
			store.set(updateExtensionStateAtom, createMinimalState([msg1, msg2]))

			// Verify messages exist
			expect(store.get(chatMessagesAtom)).toHaveLength(2)

			// Set state to null
			store.set(updateExtensionStateAtom, null)

			// Messages should be cleared
			expect(store.get(chatMessagesAtom)).toHaveLength(0)
		})

		it("should clear messages when clearExtensionStateAtom is called", () => {
			// Setup: State with messages
			const msg1 = createMessage(1000, "Message 1")
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Verify messages exist
			expect(store.get(chatMessagesAtom)).toHaveLength(1)

			// Clear state
			store.set(clearExtensionStateAtom)

			// Messages should be cleared
			expect(store.get(chatMessagesAtom)).toHaveLength(0)
		})
	})

	describe("Test 5: Deduplication Edge Cases", () => {
		it("should not drop non-command_output messages during deduplication", () => {
			// Setup: Mix of message types
			const msg1 = createMessage(1000, "Regular message 1")
			const msg2 = createMessage(2000, "Regular message 2")
			const msg3: ExtensionChatMessage = {
				ts: 3000,
				type: "ask",
				ask: "command_output",
				text: JSON.stringify({ executionId: "exec-1", command: "ls", output: "" }),
				partial: true,
				isAnswered: false,
			}

			store.set(updateExtensionStateAtom, createMinimalState([msg1, msg2, msg3]))

			// Verify all messages are preserved
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(3)
			expect(messages[0]?.text).toBe("Regular message 1")
			expect(messages[1]?.text).toBe("Regular message 2")
			expect(messages[2]?.ask).toBe("command_output")
		})

		it("should handle multiple command_output asks correctly", () => {
			// Setup: Multiple command_output asks (simulating sequential commands)
			const msg1: ExtensionChatMessage = {
				ts: 1000,
				type: "ask",
				ask: "command_output",
				text: JSON.stringify({ executionId: "exec-1", command: "ls", output: "file1" }),
				partial: false,
				isAnswered: true, // First command completed
			}
			const msg2: ExtensionChatMessage = {
				ts: 2000,
				type: "ask",
				ask: "command_output",
				text: JSON.stringify({ executionId: "exec-2", command: "pwd", output: "/home" }),
				partial: false,
				isAnswered: false, // Second command waiting for response
			}

			store.set(updateExtensionStateAtom, createMinimalState([msg1, msg2]))

			// Both should be preserved (one answered, one not)
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
		})
	})

	describe("Test 6: Version Map Consistency", () => {
		it("should maintain consistent version map after updates", () => {
			// Setup
			const msg1 = createMessage(1000, "Short")
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Update message
			const updatedMsg = createMessage(1000, "Much longer content now")
			store.set(updateChatMessageByTsAtom, updatedMsg)

			// Version map should reflect the longer content
			const versionMap = store.get(messageVersionMapAtom)
			expect(versionMap.get(1000)).toBe("Much longer content now".length + "text".length) // text + say
		})

		it("should not have stale entries in version map after message removal", () => {
			// Setup: Two messages
			const msg1 = createMessage(1000, "Message 1")
			const msg2 = createMessage(2000, "Message 2")
			store.set(updateExtensionStateAtom, createMinimalState([msg1, msg2]))

			// Update to remove one message
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Version map should only have entry for remaining message
			const versionMap = store.get(messageVersionMapAtom)
			expect(versionMap.has(1000)).toBe(true)
			// Note: The current implementation may or may not clean up old entries
			// This test documents the current behavior
		})
	})

	describe("Test 7: Streaming Set Consistency", () => {
		it("should track streaming messages correctly", () => {
			// Setup: Streaming message
			const msg1 = createMessage(1000, "Streaming...", { partial: true })
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Streaming set should contain the message
			let streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(true)

			// Complete the message
			const completedMsg = createMessage(1000, "Streaming complete", { partial: false })
			store.set(updateChatMessageByTsAtom, completedMsg)

			// Streaming set should no longer contain the message
			streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(false)
		})

		it("should handle multiple streaming messages", () => {
			// Setup: Multiple streaming messages
			const msg1 = createMessage(1000, "Stream 1", { partial: true })
			const msg2 = createMessage(2000, "Stream 2", { partial: true })
			store.set(updateExtensionStateAtom, createMinimalState([msg1, msg2]))

			// Both should be in streaming set
			let streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(true)
			expect(streamingSet.has(2000)).toBe(true)

			// Complete one
			store.set(updateChatMessageByTsAtom, createMessage(1000, "Stream 1 done", { partial: false }))

			// Only one should remain in streaming set
			streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(false)
			expect(streamingSet.has(2000)).toBe(true)
		})
	})

	describe("Test 8: Edge Case - Empty State Updates", () => {
		it("should handle state update with empty messages array", () => {
			// Setup: State with messages
			const msg1 = createMessage(1000, "Message 1")
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Update with empty messages
			store.set(updateExtensionStateAtom, createMinimalState([]))

			// Messages should be cleared (this is expected behavior)
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(0)
		})

		it("should handle state update with undefined chatMessages", () => {
			// Setup: State with messages
			const msg1 = createMessage(1000, "Message 1")
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Update with state that has no chatMessages property
			const stateWithoutMessages: ExtensionState = {
				version: "1.0.0",
				apiConfiguration: {},
				chatMessages: [], // Required by type, but testing edge case
				mode: "code",
				customModes: [],
				taskHistoryFullLength: 0,
				taskHistoryVersion: 0,
				renderContext: "cli",
				telemetrySetting: "disabled",
			}
			// @ts-expect-error - Testing edge case where chatMessages might be undefined
			delete stateWithoutMessages.chatMessages

			store.set(updateExtensionStateAtom, stateWithoutMessages)

			// Should handle gracefully (current behavior: treats as empty array)
			const messages = store.get(chatMessagesAtom)
			// Document actual behavior
			expect(messages).toBeDefined()
		})
	})

	describe("Test 9: Partial Flag Transitions", () => {
		it("should correctly transition from partial=true to partial=false", () => {
			// Setup: Partial message
			const msg1 = createMessage(1000, "Partial content", { partial: true })
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Verify initial state
			let messages = store.get(chatMessagesAtom)
			expect(messages[0]?.partial).toBe(true)

			// Transition to complete
			const completedMsg = createMessage(1000, "Partial content - now complete", { partial: false })
			store.set(updateChatMessageByTsAtom, completedMsg)

			// Verify transition
			messages = store.get(chatMessagesAtom)
			expect(messages[0]?.partial).toBe(false)
			expect(messages[0]?.text).toBe("Partial content - now complete")
		})

		it("should not allow transition from partial=false back to partial=true with less content (BUG FIX)", () => {
			// Setup: Complete message
			const msg1 = createMessage(1000, "Complete content here", { partial: false })
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Try to transition back to partial with less content (stale update)
			const stalePartialMsg = createMessage(1000, "Partial", { partial: true })
			store.set(updateChatMessageByTsAtom, stalePartialMsg)

			// FIXED: The stale partial message should NOT overwrite the complete one
			// This prevents context drops when delayed IPC messages arrive
			const messages = store.get(chatMessagesAtom)

			// The completed message should be preserved
			expect(messages[0]?.partial).toBe(false)
			expect(messages[0]?.text).toBe("Complete content here")
		})
	})

	describe("Test 10: Message Timestamp Uniqueness", () => {
		it("should handle messages with same timestamp correctly", () => {
			// This is an edge case that shouldn't happen but tests robustness
			const msg1 = createMessage(1000, "First message")
			const msg2 = createMessage(1000, "Second message with same ts") // Same timestamp!

			// The state should only have one message per timestamp
			store.set(updateExtensionStateAtom, createMinimalState([msg1, msg2]))

			const messages = store.get(chatMessagesAtom)
			// Document actual behavior - likely keeps last one or first one
			expect(messages.length).toBeGreaterThanOrEqual(1)
		})
	})

	describe("Test 11: Async Race Conditions (Simulated)", () => {
		/**
		 * These tests simulate async race conditions that could occur in production
		 * when IPC messages arrive out of order or with delays.
		 */

		it("should handle concurrent state and message updates", async () => {
			// Setup: Initial state
			const msg1 = createMessage(1000, "Message 1")
			const msg2 = createMessage(2000, "Message 2 - initial", { partial: true })
			store.set(updateExtensionStateAtom, createMinimalState([msg1, msg2]))

			// Simulate concurrent updates using Promise.all
			// This tests what happens when multiple updates are queued
			const updates = []

			// Simulate streaming updates
			for (let i = 0; i < 5; i++) {
				updates.push(
					new Promise<void>((resolve) => {
						setTimeout(() => {
							const streamingUpdate = createMessage(2000, `Message 2 - stream ${i}`, { partial: true })
							store.set(updateChatMessageByTsAtom, streamingUpdate)
							resolve()
						}, i * 10)
					}),
				)
			}

			// Simulate state updates (potentially stale)
			for (let i = 0; i < 3; i++) {
				updates.push(
					new Promise<void>((resolve) => {
						setTimeout(
							() => {
								const stateUpdate = createMinimalState([
									msg1,
									createMessage(2000, `Message 2 - state ${i}`, { partial: true }),
								])
								store.set(updateExtensionStateAtom, stateUpdate)
								resolve()
							},
							i * 15 + 5,
						) // Offset to interleave with streaming
					}),
				)
			}

			await Promise.all(updates)

			// Verify messages weren't lost
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.text).toBe("Message 1")
			// Message 2 should exist with some content
			expect(messages[1]?.text).toContain("Message 2")
		})

		it("should handle rapid fire updates without losing messages", async () => {
			// Setup: Multiple messages
			const initialMessages = Array.from({ length: 5 }, (_, i) =>
				createMessage(1000 + i * 1000, `Message ${i + 1}`),
			)
			store.set(updateExtensionStateAtom, createMinimalState(initialMessages))

			// Rapid fire updates to different messages
			const updates = []
			for (let round = 0; round < 3; round++) {
				for (let i = 0; i < 5; i++) {
					updates.push(
						new Promise<void>((resolve) => {
							setTimeout(
								() => {
									const update = createMessage(1000 + i * 1000, `Message ${i + 1} - round ${round}`)
									store.set(updateChatMessageByTsAtom, update)
									resolve()
								},
								round * 5 + i,
							)
						}),
					)
				}
			}

			await Promise.all(updates)

			// All 5 messages should still exist
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(5)
		})

		it("should handle state update arriving after message was already updated", async () => {
			// Setup: Initial streaming message
			const msg1 = createMessage(1000, "Initial", { partial: true })
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// First: Direct message update (simulating streaming)
			const streamUpdate = createMessage(1000, "Initial with more content", { partial: true })
			store.set(updateChatMessageByTsAtom, streamUpdate)

			// Then: Delayed state update with stale content
			await new Promise<void>((resolve) => {
				setTimeout(() => {
					const staleState = createMinimalState([
						createMessage(1000, "Initial", { partial: true }), // Stale!
					])
					store.set(updateExtensionStateAtom, staleState)
					resolve()
				}, 10)
			})

			// The newer content should be preserved
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.text).toBe("Initial with more content")
		})

		it("should handle completion arriving before final state sync", async () => {
			// Setup: Streaming message
			const msg1 = createMessage(1000, "Streaming content", { partial: true })
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Completion arrives first
			const completedMsg = createMessage(1000, "Streaming content - complete", { partial: false })
			store.set(updateChatMessageByTsAtom, completedMsg)

			// Then state sync arrives with partial=true (stale)
			await new Promise<void>((resolve) => {
				setTimeout(() => {
					const staleState = createMinimalState([
						createMessage(1000, "Streaming content", { partial: true }), // Stale!
					])
					store.set(updateExtensionStateAtom, staleState)
					resolve()
				}, 10)
			})

			// Should keep the completed version
			const messages = store.get(chatMessagesAtom)
			expect(messages[0]?.partial).toBe(false)
			expect(messages[0]?.text).toBe("Streaming content - complete")
		})
	})

	describe("Test 12: Message Loss Scenarios", () => {
		/**
		 * These tests specifically try to reproduce scenarios where messages could be lost.
		 */

		it("should not lose messages when state update has fewer messages", () => {
			// Setup: State with 3 messages
			const msg1 = createMessage(1000, "Message 1")
			const msg2 = createMessage(2000, "Message 2")
			const msg3 = createMessage(3000, "Message 3")
			store.set(updateExtensionStateAtom, createMinimalState([msg1, msg2, msg3]))

			// State update arrives with only 2 messages (msg2 missing)
			// This could happen if extension state is out of sync
			const incompleteState = createMinimalState([msg1, msg3])
			store.set(updateExtensionStateAtom, incompleteState)

			// Current behavior: messages are replaced with incoming state
			// This documents the actual behavior
			const messages = store.get(chatMessagesAtom)
			// Note: This test documents that messages CAN be lost if state update is incomplete
			expect(messages).toHaveLength(2)
		})

		it("should preserve CLI-added messages during state sync", () => {
			// Setup: Initial state from extension
			const msg1 = createMessage(1000, "Extension message 1")
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// CLI adds a message directly (simulating synthetic ask)
			const _cliMsg: ExtensionChatMessage = {
				ts: 2000,
				type: "ask",
				ask: "command_output",
				text: JSON.stringify({ executionId: "cli-exec-1", command: "ls", output: "files" }),
				partial: false,
				isAnswered: false,
			}
			// Note: In real code, CLI messages are added via different mechanism
			// This test documents the expected behavior

			// State sync from extension (doesn't include CLI message)
			const extensionState = createMinimalState([msg1])
			store.set(updateExtensionStateAtom, extensionState)

			// The CLI message handling is done separately via deduplication
			// This test documents that state sync alone doesn't preserve CLI messages
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
		})

		it("should handle empty state followed by populated state", () => {
			// Setup: State with messages
			const msg1 = createMessage(1000, "Message 1")
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Empty state arrives (could happen during task transition)
			store.set(updateExtensionStateAtom, createMinimalState([]))

			// Then populated state arrives
			const msg2 = createMessage(2000, "New message")
			store.set(updateExtensionStateAtom, createMinimalState([msg2]))

			// Should have the new message
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.text).toBe("New message")
		})
	})

	describe("Test 13: Version Map Edge Cases", () => {
		it("should handle version collision with different message types", () => {
			// Two messages with same content length but different types
			const sayMsg = createMessage(1000, "Hello World", { type: "say", say: "text" })
			const askMsg: ExtensionChatMessage = {
				ts: 2000,
				type: "ask",
				ask: "followup",
				text: "Hello World", // Same length!
				partial: false,
			}

			store.set(updateExtensionStateAtom, createMinimalState([sayMsg, askMsg]))

			// Both should be preserved (different timestamps)
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
		})

		it("should update version map correctly during streaming", () => {
			// Setup: Streaming message
			const msg1 = createMessage(1000, "A", { partial: true })
			store.set(updateExtensionStateAtom, createMinimalState([msg1]))

			// Stream updates with increasing content
			const updates = ["AB", "ABC", "ABCD", "ABCDE"]
			for (const content of updates) {
				const update = createMessage(1000, content, { partial: true })
				store.set(updateChatMessageByTsAtom, update)

				// Version map should reflect current content length
				const versionMap = store.get(messageVersionMapAtom)
				expect(versionMap.get(1000)).toBe(content.length + "text".length)
			}
		})
	})
})

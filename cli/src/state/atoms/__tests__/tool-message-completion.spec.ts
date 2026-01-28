/**
 * Tests for tool message completion scenarios
 *
 * This test file specifically addresses the bug where list_files and search_files
 * tools show "Total: 0 items" or "Found: 0 matches" even when files exist.
 *
 * The bug occurs because:
 * 1. Extension sends a partial message with empty content during streaming
 * 2. Extension sends a complete message with actual content
 * 3. The CLI's message reconciliation logic may reject the complete message
 *    under certain race conditions
 *
 * See: plans/list-files-search-files-zero-results-investigation.md
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import type { ExtensionChatMessage, ExtensionState } from "../../../types/messages.js"
import {
	chatMessagesAtom,
	streamingMessagesSetAtom,
	updateExtensionStateAtom,
	updateChatMessageByTsAtom,
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

// Helper to create a tool message (like list_files or search_files)
function createToolMessage(
	ts: number,
	content: string,
	partial: boolean,
	tool: string = "listFilesRecursive",
): ExtensionChatMessage {
	return {
		ts,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool,
			path: "webview-ui/src/kilocode/agent-manager",
			content,
			isOutsideWorkspace: false,
		}),
		partial,
	}
}

describe("Tool Message Completion", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("list_files tool completion", () => {
		it("should accept complete message after partial message via state update", () => {
			// Scenario: Extension sends partial message first, then complete message via state update
			// This is the normal flow for tool messages

			// Step 1: Initial state with partial message (empty content)
			const partialMessage = createToolMessage(1000, "", true)
			const initialState = createMinimalState([partialMessage])
			store.set(updateExtensionStateAtom, initialState)

			// Verify partial message is stored
			let messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(true)
			const parsedPartial = JSON.parse(messages[0]?.text || "{}")
			expect(parsedPartial.content).toBe("")

			// Step 2: State update with complete message (actual content)
			const completeMessage = createToolMessage(1000, "file1.ts\nfile2.ts\nfile3.ts", false)
			const completeState = createMinimalState([completeMessage])
			store.set(updateExtensionStateAtom, completeState)

			// Verify complete message is accepted
			messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(false)
			const parsedComplete = JSON.parse(messages[0]?.text || "{}")
			expect(parsedComplete.content).toBe("file1.ts\nfile2.ts\nfile3.ts")
		})

		it("should accept complete message after partial message via real-time update", () => {
			// Scenario: Extension sends partial message first, then complete message via real-time update
			// This tests the updateChatMessageByTsAtom path

			// Step 1: Initial state with partial message (empty content)
			const partialMessage = createToolMessage(1000, "", true)
			const initialState = createMinimalState([partialMessage])
			store.set(updateExtensionStateAtom, initialState)

			// Verify partial message is stored
			let messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(true)

			// Step 2: Real-time update with complete message
			const completeMessage = createToolMessage(1000, "file1.ts\nfile2.ts\nfile3.ts", false)
			store.set(updateChatMessageByTsAtom, completeMessage)

			// Verify complete message is accepted
			messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(false)
			const parsedComplete = JSON.parse(messages[0]?.text || "{}")
			expect(parsedComplete.content).toBe("file1.ts\nfile2.ts\nfile3.ts")
		})

		it("should handle race condition: state update arrives before real-time update", () => {
			// Scenario: State update with complete message arrives before real-time partial update
			// This can happen due to IPC timing issues

			// Step 1: Initial state with partial message
			const partialMessage = createToolMessage(1000, "", true)
			const initialState = createMinimalState([partialMessage])
			store.set(updateExtensionStateAtom, initialState)

			// Step 2: Real-time update marks it as streaming
			store.set(updateChatMessageByTsAtom, partialMessage)

			// Verify it's in streaming set
			const streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(true)

			// Step 3: State update with complete message arrives
			const completeMessage = createToolMessage(1000, "file1.ts\nfile2.ts\nfile3.ts", false)
			const completeState = createMinimalState([completeMessage])
			store.set(updateExtensionStateAtom, completeState)

			// Verify complete message is accepted (not rejected as stale)
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(false)
			const parsedComplete = JSON.parse(messages[0]?.text || "{}")
			expect(parsedComplete.content).toBe("file1.ts\nfile2.ts\nfile3.ts")
		})

		it("should handle race condition: complete state arrives while still marked as streaming", () => {
			// Scenario: The message is still in streamingSet when complete state arrives
			// This tests the PRIORITY 2 logic in reconcileMessages

			// Step 1: Initial state with partial message
			const partialMessage = createToolMessage(1000, "", true)
			const initialState = createMinimalState([partialMessage])
			store.set(updateExtensionStateAtom, initialState)

			// Step 2: Real-time update marks it as streaming
			store.set(updateChatMessageByTsAtom, partialMessage)

			// Verify it's in streaming set
			let streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(true)

			// Step 3: State update with complete message arrives (but streaming flag not yet cleared)
			const completeMessage = createToolMessage(1000, "file1.ts\nfile2.ts\nfile3.ts", false)
			const completeState = createMinimalState([completeMessage])
			store.set(updateExtensionStateAtom, completeState)

			// Verify complete message is accepted
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(false)
			const parsedComplete = JSON.parse(messages[0]?.text || "{}")
			expect(parsedComplete.content).toBe("file1.ts\nfile2.ts\nfile3.ts")

			// Verify streaming flag is cleared
			streamingSet = store.get(streamingMessagesSetAtom)
			expect(streamingSet.has(1000)).toBe(false)
		})
	})

	describe("search_files tool completion", () => {
		it("should accept complete search results after partial message", () => {
			// Same scenario but for search_files tool

			// Step 1: Initial state with partial message (empty content)
			const partialMessage = createToolMessage(2000, "", true, "searchFiles")
			const initialState = createMinimalState([partialMessage])
			store.set(updateExtensionStateAtom, initialState)

			// Verify partial message is stored
			let messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(true)

			// Step 2: State update with complete message (actual search results)
			const searchResults = `Found 17 results.

# src/core/kilocode/agent-manager/CliModelsFetcher.ts
 92 |  */
 93 | export async function fetchAvailableModels(
 94 | 	cliPath: string,
----`
			const completeMessage = createToolMessage(2000, searchResults, false, "searchFiles")
			const completeState = createMinimalState([completeMessage])
			store.set(updateExtensionStateAtom, completeState)

			// Verify complete message is accepted
			messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(false)
			const parsedComplete = JSON.parse(messages[0]?.text || "{}")
			expect(parsedComplete.content).toContain("Found 17 results")
		})
	})

	describe("Edge cases", () => {
		it("should NOT accept stale partial update after message is complete", () => {
			// This is the existing protection - ensure we don't break it

			// Step 1: Initial state with complete message
			const completeMessage = createToolMessage(3000, "file1.ts\nfile2.ts\nfile3.ts", false)
			const initialState = createMinimalState([completeMessage])
			store.set(updateExtensionStateAtom, initialState)

			// Verify complete message is stored
			let messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(false)

			// Step 2: Stale partial update arrives (should be rejected)
			const stalePartialMessage = createToolMessage(3000, "", true)
			store.set(updateChatMessageByTsAtom, stalePartialMessage)

			// Verify complete message is preserved
			messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(false)
			const parsedComplete = JSON.parse(messages[0]?.text || "{}")
			expect(parsedComplete.content).toBe("file1.ts\nfile2.ts\nfile3.ts")
		})

		it("should handle tool message with zero files correctly", () => {
			// Edge case: tool actually finds no files (legitimate empty result)

			// Step 1: Initial state with partial message
			const partialMessage = createToolMessage(4000, "", true)
			const initialState = createMinimalState([partialMessage])
			store.set(updateExtensionStateAtom, initialState)

			// Step 2: Complete message with "No files found" result
			const completeMessage = createToolMessage(4000, "No files found.", false)
			const completeState = createMinimalState([completeMessage])
			store.set(updateExtensionStateAtom, completeState)

			// Verify complete message is accepted
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(false)
			const parsedComplete = JSON.parse(messages[0]?.text || "{}")
			expect(parsedComplete.content).toBe("No files found.")
		})

		it("should handle multiple tool messages in sequence", () => {
			// Scenario: Multiple tool calls in sequence

			// Step 1: First tool message (partial)
			const partial1 = createToolMessage(5000, "", true, "listFilesRecursive")
			const state1 = createMinimalState([partial1])
			store.set(updateExtensionStateAtom, state1)

			// Step 2: First tool message (complete)
			const complete1 = createToolMessage(5000, "file1.ts", false, "listFilesRecursive")
			const state2 = createMinimalState([complete1])
			store.set(updateExtensionStateAtom, state2)

			// Step 3: Second tool message (partial)
			const partial2 = createToolMessage(6000, "", true, "searchFiles")
			const state3 = createMinimalState([complete1, partial2])
			store.set(updateExtensionStateAtom, state3)

			// Step 4: Second tool message (complete)
			const complete2 = createToolMessage(6000, "Found 5 results.", false, "searchFiles")
			const state4 = createMinimalState([complete1, complete2])
			store.set(updateExtensionStateAtom, state4)

			// Verify both messages are complete
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)
			expect(messages[0]?.partial).toBe(false)
			expect(messages[1]?.partial).toBe(false)

			const parsed1 = JSON.parse(messages[0]?.text || "{}")
			const parsed2 = JSON.parse(messages[1]?.text || "{}")
			expect(parsed1.content).toBe("file1.ts")
			expect(parsed2.content).toBe("Found 5 results.")
		})

		it("should auto-complete orphaned partial tool messages when subsequent message exists", () => {
			// Scenario: A partial tool message is followed by another message,
			// indicating the tool has completed but the complete message was missed.
			// The autoCompleteOrphanedPartialTools function should mark it as complete.

			// Step 1: Create state with partial tool message followed by another message
			const partialToolMessage: ExtensionChatMessage = {
				ts: 7000,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({
					tool: "listFilesRecursive",
					path: "src",
					content: "", // Empty content - partial
					isOutsideWorkspace: false,
				}),
				partial: true,
			}

			const subsequentMessage: ExtensionChatMessage = {
				ts: 8000,
				type: "say",
				say: "text",
				text: "Here are the files I found...",
				partial: false,
			}

			const state = createMinimalState([partialToolMessage, subsequentMessage])
			store.set(updateExtensionStateAtom, state)

			// Verify the partial tool message is auto-completed
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(2)

			// The first message (tool) should be marked as complete (partial=false)
			// because there's a subsequent message
			expect(messages[0]?.partial).toBe(false)
			expect(messages[0]?.ask).toBe("tool")

			// The second message should remain unchanged
			expect(messages[1]?.partial).toBe(false)
			expect(messages[1]?.say).toBe("text")
		})

		it("should NOT auto-complete partial tool message if it is the last message AND has no content", () => {
			// Scenario: A partial tool message is the last message in the array
			// AND has empty text content. It should remain partial because the
			// tool might still be executing.

			const partialToolMessage: ExtensionChatMessage = {
				ts: 9000,
				type: "ask",
				ask: "tool",
				text: "", // Empty text - truly partial, no content yet
				partial: true,
			}

			const state = createMinimalState([partialToolMessage])
			store.set(updateExtensionStateAtom, state)

			// Verify the partial tool message remains partial
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(true)
			expect(messages[0]?.ask).toBe("tool")
		})

		it("should auto-complete partial tool message if it has content (even if last message)", () => {
			// Scenario: A partial tool message is the last message but has content.
			// This means the tool has completed but the partial flag wasn't cleared.
			// We should mark it as complete so it displays properly.

			const partialToolWithContent: ExtensionChatMessage = {
				ts: 10000,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({
					tool: "listFilesRecursive",
					path: "src",
					content: "file1.ts\nfile2.ts\nfile3.ts", // Has content!
					isOutsideWorkspace: false,
				}),
				partial: true, // Still marked as partial (bug scenario)
			}

			const state = createMinimalState([partialToolWithContent])
			store.set(updateExtensionStateAtom, state)

			// Verify the partial tool message is auto-completed because it has content
			const messages = store.get(chatMessagesAtom)
			expect(messages).toHaveLength(1)
			expect(messages[0]?.partial).toBe(false) // Should be marked complete
			expect(messages[0]?.ask).toBe("tool")
		})
	})
})

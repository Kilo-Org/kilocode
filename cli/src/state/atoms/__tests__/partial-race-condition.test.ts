/**
 * Test for the specific race condition bug where command messages
 * with partial=true never transition to partial=false
 *
 * Bug scenario:
 * 1. Extension sends messageUpdated with partial=false
 * 2. Extension sends state update with stale partial=true version
 * 3. CLI should keep the partial=false version, not revert to partial=true
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import type { ExtensionChatMessage, ExtensionState } from "../../../types/messages.js"
import {
	chatMessagesAtom,
	updateExtensionStateAtom,
	updateChatMessageByTsAtom,
	streamingMessagesSetAtom,
} from "../extension.js"

describe("Partial Race Condition Bug Fix", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	it("should not revert partial=false to partial=true when stale state arrives", () => {
		// Step 1: Initial state with a command message (partial=true)
		const initialState: ExtensionState = {
			version: "1.0.0",
			apiConfiguration: {},
			chatMessages: [
				{
					ts: 1761239614416,
					type: "ask",
					ask: "command",
					text: "git status",
					partial: true,
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

		// Verify message is tracked as streaming
		expect(store.get(streamingMessagesSetAtom).has(1761239614416)).toBe(true)
		expect(store.get(chatMessagesAtom)[0]?.partial).toBe(true)

		// Step 2: Extension sends messageUpdated with partial=false (command complete)
		const completedMessage: ExtensionChatMessage = {
			ts: 1761239614416,
			type: "ask",
			ask: "command",
			text: "git status",
			partial: false,
		}

		store.set(updateChatMessageByTsAtom, completedMessage)

		// Verify message is now complete
		expect(store.get(chatMessagesAtom)[0]?.partial).toBe(false)
		expect(store.get(streamingMessagesSetAtom).has(1761239614416)).toBe(false)

		// Step 3: Stale state update arrives with partial=true (race condition)
		const staleState: ExtensionState = {
			version: "1.0.0",
			apiConfiguration: {},
			chatMessages: [
				{
					ts: 1761239614416,
					type: "ask",
					ask: "command",
					text: "git status",
					partial: true, // Stale partial flag
				},
			],
			mode: "code",
			customModes: [],
			taskHistoryFullLength: 0,
			taskHistoryVersion: 0,
			renderContext: "cli",
			telemetrySetting: "disabled",
		}

		store.set(updateExtensionStateAtom, staleState)

		// BUG FIX: Message should remain partial=false, not revert to partial=true
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(1)
		expect(messages[0]?.partial).toBe(false) // Should stay false!
		expect(messages[0]?.text).toBe("git status")
	})

	it("should auto-complete orphaned partial ask when subsequent messages arrive (CLI workaround)", () => {
		// Simulate the extension bug: partial ask message followed by other messages
		// without ever sending a partial=false update
		const stateWithOrphanedPartial: ExtensionState = {
			version: "1.0.0",
			apiConfiguration: {},
			chatMessages: [
				{
					ts: 1000,
					type: "ask",
					ask: "command",
					text: "git status",
					partial: true, // Orphaned - never completed by extension
				},
				{
					ts: 2000,
					type: "say",
					say: "checkpoint_saved",
					text: "abc123",
				},
				{
					ts: 3000,
					type: "say",
					say: "text",
					text: "Command executed",
				},
			],
			mode: "code",
			customModes: [],
			taskHistoryFullLength: 0,
			taskHistoryVersion: 0,
			renderContext: "cli",
			telemetrySetting: "disabled",
		}

		store.set(updateExtensionStateAtom, stateWithOrphanedPartial)

		// CLI should auto-complete the orphaned partial ask
		const messages = store.get(chatMessagesAtom)
		expect(messages).toHaveLength(3)
		expect(messages[0]?.partial).toBe(false) // Auto-completed!
		expect(messages[0]?.ask).toBe("command")
	})

	it("should handle the race condition for any ask message type", () => {
		// Test with followup message
		const initialState: ExtensionState = {
			version: "1.0.0",
			apiConfiguration: {},
			chatMessages: [
				{
					ts: 2000,
					type: "ask",
					ask: "followup",
					text: '{"question":"What should I do?"}',
					partial: true,
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

		// Complete the message via messageUpdated
		const completedMessage: ExtensionChatMessage = {
			ts: 2000,
			type: "ask",
			ask: "followup",
			text: '{"question":"What should I do?","suggest":[{"answer":"Option 1"},{"answer":"Option 2"}]}',
			partial: false,
		}

		store.set(updateChatMessageByTsAtom, completedMessage)
		expect(store.get(chatMessagesAtom)[0]?.partial).toBe(false)

		// Stale state arrives
		const staleState: ExtensionState = {
			version: "1.0.0",
			apiConfiguration: {},
			chatMessages: [
				{
					ts: 2000,
					type: "ask",
					ask: "followup",
					text: '{"question":"What should I do?"}',
					partial: true,
				},
			],
			mode: "code",
			customModes: [],
			taskHistoryFullLength: 0,
			taskHistoryVersion: 0,
			renderContext: "cli",
			telemetrySetting: "disabled",
		}

		store.set(updateExtensionStateAtom, staleState)

		// Should keep the completed version
		const messages = store.get(chatMessagesAtom)
		expect(messages[0]?.partial).toBe(false)
		expect(messages[0]?.text).toContain("suggest")
	})

	it("should still allow legitimate partial updates during active streaming", () => {
		// Initial state
		const initialState: ExtensionState = {
			version: "1.0.0",
			apiConfiguration: {},
			chatMessages: [
				{
					ts: 3000,
					type: "ask",
					ask: "command",
					text: "npm",
					partial: true,
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

		// Streaming update with more content
		const streamingUpdate: ExtensionChatMessage = {
			ts: 3000,
			type: "ask",
			ask: "command",
			text: "npm install",
			partial: true,
		}

		store.set(updateChatMessageByTsAtom, streamingUpdate)
		expect(store.get(chatMessagesAtom)[0]?.text).toBe("npm install")
		expect(store.get(chatMessagesAtom)[0]?.partial).toBe(true)

		// Another streaming update with even more content
		const streamingUpdate2: ExtensionChatMessage = {
			ts: 3000,
			type: "ask",
			ask: "command",
			text: "npm install express",
			partial: true,
		}

		store.set(updateChatMessageByTsAtom, streamingUpdate2)
		expect(store.get(chatMessagesAtom)[0]?.text).toBe("npm install express")
		expect(store.get(chatMessagesAtom)[0]?.partial).toBe(true)

		// State update with shorter content should be rejected (streaming protection)
		const staleState: ExtensionState = {
			version: "1.0.0",
			apiConfiguration: {},
			chatMessages: [
				{
					ts: 3000,
					type: "ask",
					ask: "command",
					text: "npm",
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

		store.set(updateExtensionStateAtom, staleState)

		// Should keep the longer streaming version
		expect(store.get(chatMessagesAtom)[0]?.text).toBe("npm install express")
		expect(store.get(chatMessagesAtom)[0]?.partial).toBe(true)
	})
})

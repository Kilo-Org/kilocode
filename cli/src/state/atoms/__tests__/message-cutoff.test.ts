/**
 * Tests for message cutoff timestamp functionality
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import {
	messagesAtom,
	messageCutoffTimestampAtom,
	setMessageCutoffTimestampAtom,
	resetMessageCutoffAtom,
	mergedMessagesAtom,
} from "../ui.js"
import { chatMessagesAtom } from "../extension.js"
import type { CliMessage } from "../../../types/cli.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

describe("Message Cutoff Timestamp", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("messageCutoffTimestampAtom", () => {
		it("should initialize to 0", () => {
			const cutoff = store.get(messageCutoffTimestampAtom)
			expect(cutoff).toBe(0)
		})

		it("should be settable via setMessageCutoffTimestampAtom", () => {
			const timestamp = Date.now()
			store.set(setMessageCutoffTimestampAtom, timestamp)
			expect(store.get(messageCutoffTimestampAtom)).toBe(timestamp)
		})

		it("should be resettable via resetMessageCutoffAtom", () => {
			store.set(setMessageCutoffTimestampAtom, Date.now())
			store.set(resetMessageCutoffAtom)
			expect(store.get(messageCutoffTimestampAtom)).toBe(0)
		})
	})

	describe("mergedMessagesAtom filtering", () => {
		it("should show all messages when cutoff is 0", () => {
			const cliMessages: CliMessage[] = [
				{ id: "1", type: "user", content: "test 1", ts: 1000 },
				{ id: "2", type: "user", content: "test 2", ts: 2000 },
			]

			const extensionMessages: ExtensionChatMessage[] = [
				{ ts: 1500, type: "say", say: "text", text: "response 1" },
				{ ts: 2500, type: "say", say: "text", text: "response 2" },
			]

			store.set(messagesAtom, cliMessages)
			store.set(chatMessagesAtom, extensionMessages)
			store.set(messageCutoffTimestampAtom, 0)

			const merged = store.get(mergedMessagesAtom)
			expect(merged).toHaveLength(4)
		})

		it("should filter out messages before cutoff timestamp", () => {
			const cliMessages: CliMessage[] = [
				{ id: "1", type: "user", content: "test 1", ts: 1000 },
				{ id: "2", type: "user", content: "test 2", ts: 2000 },
				{ id: "3", type: "user", content: "test 3", ts: 3000 },
			]

			const extensionMessages: ExtensionChatMessage[] = [
				{ ts: 1500, type: "say", say: "text", text: "response 1" },
				{ ts: 2500, type: "say", say: "text", text: "response 2" },
				{ ts: 3500, type: "say", say: "text", text: "response 3" },
			]

			store.set(messagesAtom, cliMessages)
			store.set(chatMessagesAtom, extensionMessages)
			store.set(messageCutoffTimestampAtom, 2000)

			const merged = store.get(mergedMessagesAtom)
			// Should only show messages with ts > 2000 (test 2 at 2000 is excluded)
			expect(merged).toHaveLength(3) // test 3, response 2, response 3
			expect(merged.every((m) => m.message.ts > 2000)).toBe(true)
		})

		it("should filter both CLI and extension messages", () => {
			const cliMessages: CliMessage[] = [
				{ id: "1", type: "user", content: "old cli", ts: 1000 },
				{ id: "2", type: "user", content: "new cli", ts: 3000 },
			]

			const extensionMessages: ExtensionChatMessage[] = [
				{ ts: 1500, type: "say", say: "text", text: "old ext" },
				{ ts: 3500, type: "say", say: "text", text: "new ext" },
			]

			store.set(messagesAtom, cliMessages)
			store.set(chatMessagesAtom, extensionMessages)
			store.set(messageCutoffTimestampAtom, 2000)

			const merged = store.get(mergedMessagesAtom)
			expect(merged).toHaveLength(2)
			expect(merged[0]?.message.ts).toBe(3000)
			expect(merged[1]?.message.ts).toBe(3500)
		})

		it("should show no messages when cutoff is after all messages", () => {
			const cliMessages: CliMessage[] = [
				{ id: "1", type: "user", content: "test 1", ts: 1000 },
				{ id: "2", type: "user", content: "test 2", ts: 2000 },
			]

			const extensionMessages: ExtensionChatMessage[] = [
				{ ts: 1500, type: "say", say: "text", text: "response 1" },
			]

			store.set(messagesAtom, cliMessages)
			store.set(chatMessagesAtom, extensionMessages)
			store.set(messageCutoffTimestampAtom, 5000)

			const merged = store.get(mergedMessagesAtom)
			expect(merged).toHaveLength(0)
		})

		it("should maintain chronological order after filtering", () => {
			const cliMessages: CliMessage[] = [
				{ id: "1", type: "user", content: "test 1", ts: 1000 },
				{ id: "2", type: "user", content: "test 2", ts: 3000 },
			]

			const extensionMessages: ExtensionChatMessage[] = [
				{ ts: 2000, type: "say", say: "text", text: "response 1" },
				{ ts: 4000, type: "say", say: "text", text: "response 2" },
			]

			store.set(messagesAtom, cliMessages)
			store.set(chatMessagesAtom, extensionMessages)
			store.set(messageCutoffTimestampAtom, 1500)

			const merged = store.get(mergedMessagesAtom)
			expect(merged).toHaveLength(3)
			expect(merged[0]?.message.ts).toBe(2000)
			expect(merged[1]?.message.ts).toBe(3000)
			expect(merged[2]?.message.ts).toBe(4000)
		})
	})

	describe("integration with /clear command flow", () => {
		it("should simulate /clear command behavior", () => {
			// Setup: Add some messages
			const oldMessages: CliMessage[] = [
				{ id: "1", type: "user", content: "old message 1", ts: 1000 },
				{ id: "2", type: "user", content: "old message 2", ts: 2000 },
			]

			const oldExtMessages: ExtensionChatMessage[] = [
				{ ts: 1500, type: "say", say: "text", text: "old response" },
			]

			store.set(messagesAtom, oldMessages)
			store.set(chatMessagesAtom, oldExtMessages)

			// Verify messages are visible
			let merged = store.get(mergedMessagesAtom)
			expect(merged).toHaveLength(3)

			// Simulate /clear: set cutoff to now
			const clearTime = Date.now()
			store.set(setMessageCutoffTimestampAtom, clearTime)

			// Old messages should be hidden
			merged = store.get(mergedMessagesAtom)
			expect(merged).toHaveLength(0)

			// Add new messages after clear
			const newMessages: CliMessage[] = [{ id: "3", type: "welcome", content: "cleared", ts: clearTime + 100 }]

			const newExtMessages: ExtensionChatMessage[] = [
				{ ts: clearTime + 200, type: "say", say: "text", text: "new response" },
			]

			store.set(messagesAtom, [...oldMessages, ...newMessages])
			store.set(chatMessagesAtom, [...oldExtMessages, ...newExtMessages])

			// Only new messages should be visible
			merged = store.get(mergedMessagesAtom)
			expect(merged).toHaveLength(2)
			expect(merged.every((m) => m.message.ts > clearTime)).toBe(true)
		})

		it("should simulate new task resetting cutoff", () => {
			// Setup: Messages are hidden by cutoff
			const messages: CliMessage[] = [{ id: "1", type: "user", content: "hidden", ts: 1000 }]

			store.set(messagesAtom, messages)
			store.set(setMessageCutoffTimestampAtom, 2000)

			// Messages should be hidden
			let merged = store.get(mergedMessagesAtom)
			expect(merged).toHaveLength(0)

			// Simulate new task: reset cutoff
			store.set(resetMessageCutoffAtom)

			// Messages should be visible again
			merged = store.get(mergedMessagesAtom)
			expect(merged).toHaveLength(1)
		})
	})
})

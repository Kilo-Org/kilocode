/**
 * Tests for isStreamingAtom
 * Tests that isStreaming correctly reflects the streaming state based on messages
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { isStreamingAtom } from "../../atoms/ui.js"
import { chatMessagesAtom, updateChatMessagesAtom } from "../../atoms/extension.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

describe("isStreamingAtom Logic", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("isStreaming state management", () => {
		it("should be false by default (no messages)", () => {
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should be true when last message is partial", () => {
			const partialMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Processing...",
				partial: true,
			}
			store.set(chatMessagesAtom, [partialMessage])
			expect(store.get(isStreamingAtom)).toBe(true)
		})

		it("should be false when last message is complete", () => {
			const completeMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Done!",
				partial: false,
			}
			store.set(chatMessagesAtom, [completeMessage])
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should be false when tool is asking for approval", () => {
			const toolMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "readFile", path: "test.ts" }),
			}
			store.set(chatMessagesAtom, [toolMessage])
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should be true when API request hasn't finished (no cost)", () => {
			const apiReqMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ request: "test" }), // No cost field
			}
			store.set(chatMessagesAtom, [apiReqMessage])
			expect(store.get(isStreamingAtom)).toBe(true)
		})

		it("should be false when API request has finished (has cost)", () => {
			const apiReqMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ request: "test", cost: 0.01 }),
			}
			store.set(chatMessagesAtom, [apiReqMessage])
			expect(store.get(isStreamingAtom)).toBe(false)
		})
	})

	describe("Message handling scenarios", () => {
		it("should not be streaming for completion_result ask message", () => {
			const completionMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "completion_result",
				text: "Task completed successfully",
			}

			store.set(chatMessagesAtom, [completionMessage])
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should not be streaming for followup ask message", () => {
			const followupMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "followup",
				text: "What would you like to do next?",
			}

			store.set(chatMessagesAtom, [followupMessage])
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should not be streaming for tool approval ask message", () => {
			const toolMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "readFile" }),
			}

			store.set(chatMessagesAtom, [toolMessage])
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should not be streaming for command approval ask message", () => {
			const commandMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "ask",
				ask: "command",
				text: "Execute command?",
			}

			store.set(chatMessagesAtom, [commandMessage])
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should not be streaming for complete say messages", () => {
			const sayMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Processing your request...",
				partial: false,
			}

			store.set(chatMessagesAtom, [sayMessage])
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should be streaming for partial say messages", () => {
			const sayMessage: ExtensionChatMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: "Processing your request...",
				partial: true,
			}

			store.set(chatMessagesAtom, [sayMessage])
			expect(store.get(isStreamingAtom)).toBe(true)
		})

		it("should handle multiple messages with last being complete", () => {
			const messages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "text",
					text: "Starting task...",
					partial: false,
				},
				{
					ts: Date.now() + 1000,
					type: "say",
					say: "text",
					text: "Processing...",
					partial: false,
				},
				{
					ts: Date.now() + 2000,
					type: "ask",
					ask: "followup",
					text: "What next?",
				},
			]

			store.set(chatMessagesAtom, messages)
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should handle empty message list", () => {
			store.set(chatMessagesAtom, [])
			expect(store.get(isStreamingAtom)).toBe(false)
		})

		it("should handle message updates via updateChatMessagesAtom", () => {
			const initialMessages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "text",
					text: "Initial message",
					partial: true,
				},
			]

			store.set(chatMessagesAtom, initialMessages)
			expect(store.get(isStreamingAtom)).toBe(true)

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
			expect(store.get(isStreamingAtom)).toBe(false)
		})
	})
})

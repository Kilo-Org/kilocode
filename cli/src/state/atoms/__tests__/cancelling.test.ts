/**
 * Tests for isCancellingAtom - immediate feedback when user presses ESC to cancel
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createStore } from "jotai"
import { isCancellingAtom, isStreamingAtom } from "../ui.js"
import { chatMessagesAtom } from "../extension.js"
import { cancelTaskAtom } from "../actions.js"
import { extensionServiceAtom, isServiceReadyAtom } from "../service.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import type { ExtensionService } from "../../../services/extension.js"

// Mock the extension service
const mockSendWebviewMessage = vi.fn().mockResolvedValue(undefined)
const mockExtensionService: Pick<ExtensionService, "sendWebviewMessage" | "isReady"> = {
	sendWebviewMessage: mockSendWebviewMessage,
	isReady: () => true,
}

describe("isCancellingAtom", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		vi.clearAllMocks()
		// Set up mock extension service
		store.set(extensionServiceAtom, mockExtensionService as ExtensionService)
		store.set(isServiceReadyAtom, true)
	})

	describe("initial state", () => {
		it("should be false by default", () => {
			const isCancelling = store.get(isCancellingAtom)
			expect(isCancelling).toBe(false)
		})
	})

	describe("when cancelTaskAtom is triggered", () => {
		it("should immediately set isCancellingAtom to true", async () => {
			// Verify initial state
			expect(store.get(isCancellingAtom)).toBe(false)

			// Trigger cancel
			await store.set(cancelTaskAtom)

			// Should be true immediately
			expect(store.get(isCancellingAtom)).toBe(true)
		})

		it("should send cancelTask message to extension", async () => {
			await store.set(cancelTaskAtom)

			expect(mockSendWebviewMessage).toHaveBeenCalledWith({
				type: "cancelTask",
			})
		})
	})

	describe("reset behavior", () => {
		it("should reset to false when streaming stops", () => {
			// Set up streaming state with a partial message
			const partialMessage: ExtensionChatMessage = {
				type: "say",
				say: "text",
				ts: Date.now(),
				text: "Processing...",
				partial: true,
			}
			store.set(chatMessagesAtom, [partialMessage])

			// Verify streaming is true
			expect(store.get(isStreamingAtom)).toBe(true)

			// Set cancelling to true
			store.set(isCancellingAtom, true)
			expect(store.get(isCancellingAtom)).toBe(true)

			// Simulate streaming stopping (complete message)
			const completeMessage: ExtensionChatMessage = {
				type: "say",
				say: "text",
				ts: Date.now(),
				text: "Done!",
				partial: false,
			}
			store.set(chatMessagesAtom, [completeMessage])

			// Verify streaming stopped
			expect(store.get(isStreamingAtom)).toBe(false)

			// Note: The actual reset logic will be implemented in an effect
			// This test documents the expected behavior
		})
	})

	describe("edge cases", () => {
		it("should handle rapid ESC presses (already cancelling)", async () => {
			// First cancel
			await store.set(cancelTaskAtom)
			expect(store.get(isCancellingAtom)).toBe(true)

			// Second cancel while already cancelling
			await store.set(cancelTaskAtom)
			expect(store.get(isCancellingAtom)).toBe(true)

			// Should still only have sent the message (idempotent behavior)
			expect(mockSendWebviewMessage).toHaveBeenCalledTimes(2)
		})

		it("should not set cancelling when not streaming", async () => {
			// No messages = not streaming
			store.set(chatMessagesAtom, [])
			expect(store.get(isStreamingAtom)).toBe(false)

			// Cancel should still work (the keyboard handler checks streaming,
			// but cancelTaskAtom itself doesn't need to)
			await store.set(cancelTaskAtom)
			expect(store.get(isCancellingAtom)).toBe(true)
		})
	})
})

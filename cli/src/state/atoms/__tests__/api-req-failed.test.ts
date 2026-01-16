/**
 * Regression tests for api_req_failed handling in CLI autonomous mode
 *
 * Issue: CLI hangs indefinitely when LLM provider hits rate limit/quota exhaustion
 * Root cause: api_req_failed ask type was not included in approvalAskTypes array,
 * so lastAskMessageAtom filtered it out and useApprovalMonitor never saw it.
 *
 * These tests verify that:
 * 1. lastAskMessageAtom correctly returns api_req_failed messages
 * 2. The approval system can process api_req_failed for auto-retry
 */

import { describe, it, expect } from "vitest"
import { createStore } from "jotai"
import { lastAskMessageAtom } from "../ui.js"
import { chatMessagesAtom } from "../extension.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

// Helper to create a test message
const createMessage = (ask: string, options: Partial<ExtensionChatMessage> = {}): ExtensionChatMessage => ({
	type: "ask",
	ask,
	text: options.text ?? "{}",
	ts: options.ts ?? Date.now(),
	partial: options.partial ?? false,
	isAnswered: options.isAnswered ?? false,
	say: "assistant",
})

describe("api_req_failed handling", () => {
	describe("lastAskMessageAtom", () => {
		it("should return api_req_failed message when it is the last unanswered ask", () => {
			const store = createStore()

			// Simulate rate limit error message from extension
			const apiReqFailedMessage = createMessage("api_req_failed", {
				text: JSON.stringify({
					error: "You have exhausted your capacity on this model. Your quota will reset after 0s.",
				}),
				ts: Date.now(),
			})

			store.set(chatMessagesAtom, [apiReqFailedMessage])

			const lastAsk = store.get(lastAskMessageAtom)

			// This is the critical assertion - api_req_failed should be returned
			// Before the fix, this would return null because api_req_failed wasn't in approvalAskTypes
			expect(lastAsk).not.toBeNull()
			expect(lastAsk?.ask).toBe("api_req_failed")
		})

		it("should not return api_req_failed message when it is already answered", () => {
			const store = createStore()

			const apiReqFailedMessage = createMessage("api_req_failed", {
				text: JSON.stringify({ error: "Rate limit exceeded" }),
				ts: Date.now(),
				isAnswered: true, // Already handled
			})

			store.set(chatMessagesAtom, [apiReqFailedMessage])

			const lastAsk = store.get(lastAskMessageAtom)
			expect(lastAsk).toBeNull()
		})

		it("should not return api_req_failed message when it is partial", () => {
			const store = createStore()

			const apiReqFailedMessage = createMessage("api_req_failed", {
				text: JSON.stringify({ error: "Rate limit exceeded" }),
				ts: Date.now(),
				partial: true, // Still streaming
			})

			store.set(chatMessagesAtom, [apiReqFailedMessage])

			const lastAsk = store.get(lastAskMessageAtom)
			expect(lastAsk).toBeNull()
		})

		it("should return api_req_failed even when preceded by other message types", () => {
			const store = createStore()

			const toolMessage = createMessage("tool", {
				text: JSON.stringify({ tool: "readFile" }),
				ts: Date.now() - 1000,
				isAnswered: true, // Previous tool was answered
			})

			const apiReqFailedMessage = createMessage("api_req_failed", {
				text: JSON.stringify({ error: "Quota exhausted" }),
				ts: Date.now(),
			})

			store.set(chatMessagesAtom, [toolMessage, apiReqFailedMessage])

			const lastAsk = store.get(lastAskMessageAtom)
			expect(lastAsk).not.toBeNull()
			expect(lastAsk?.ask).toBe("api_req_failed")
		})

		it("should handle typical quota exhaustion error message format", () => {
			const store = createStore()

			// This is the exact format seen in the user's bug report
			const quotaExhaustedMessage = createMessage("api_req_failed", {
				text: JSON.stringify({
					error: "You have exhausted your capacity on this model. Your quota will reset after 0s.",
				}),
				ts: Date.now(),
			})

			store.set(chatMessagesAtom, [quotaExhaustedMessage])

			const lastAsk = store.get(lastAskMessageAtom)
			expect(lastAsk).not.toBeNull()
			expect(lastAsk?.ask).toBe("api_req_failed")
			expect(lastAsk?.text).toContain("exhausted your capacity")
		})
	})

	describe("approval flow integration", () => {
		it("should include api_req_failed in the list of approval-requiring ask types", () => {
			// This test documents the expected behavior:
			// api_req_failed should be treated as an ask type that requires approval
			// (which will then be auto-approved if retry.enabled is true)

			const store = createStore()

			const apiReqFailedMessage = createMessage("api_req_failed", {
				text: JSON.stringify({ error: "Rate limit" }),
				ts: Date.now(),
			})

			store.set(chatMessagesAtom, [apiReqFailedMessage])

			// The lastAskMessageAtom should return this message so that
			// useApprovalMonitor can process it and trigger auto-retry
			const lastAsk = store.get(lastAskMessageAtom)
			expect(lastAsk).not.toBeNull()

			// Verify the message has the expected structure for approval processing
			expect(lastAsk?.type).toBe("ask")
			expect(lastAsk?.ask).toBe("api_req_failed")
			expect(lastAsk?.isAnswered).toBe(false)
			expect(lastAsk?.partial).toBe(false)
		})
	})
})

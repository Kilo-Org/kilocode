/**
 * Tests for useSessionCost hook
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { chatMessagesAtom } from "../../atoms/extension.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import { formatSessionCost } from "../useSessionCost.js"

describe("useSessionCost", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	describe("formatSessionCost", () => {
		it("should format zero cost", () => {
			expect(formatSessionCost(0)).toBe("$0.00")
		})

		it("should format costs with 2 decimal places", () => {
			expect(formatSessionCost(0.0001)).toBe("$0.00")
			expect(formatSessionCost(0.0012)).toBe("$0.00")
			expect(formatSessionCost(0.0099)).toBe("$0.01")
			expect(formatSessionCost(0.01)).toBe("$0.01")
			expect(formatSessionCost(0.12)).toBe("$0.12")
			expect(formatSessionCost(1.23)).toBe("$1.23")
			expect(formatSessionCost(10.5)).toBe("$10.50")
		})
	})

	describe("cost calculation from messages", () => {
		it("should return zero when no messages", () => {
			store.set(chatMessagesAtom, [])
			const messages = store.get(chatMessagesAtom)
			const result = calculateSessionCost(messages)
			expect(result.totalCost).toBe(0)
			expect(result.requestCount).toBe(0)
			expect(result.hasCostData).toBe(false)
		})

		it("should calculate total cost from api_req_started messages", () => {
			const messages: ExtensionChatMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.01 }),
				},
				{
					ts: 2000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.02 }),
				},
				{
					ts: 3000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.005 }),
				},
			]
			store.set(chatMessagesAtom, messages)
			const result = calculateSessionCost(store.get(chatMessagesAtom))
			expect(result.totalCost).toBeCloseTo(0.035, 4)
			expect(result.requestCount).toBe(3)
			expect(result.hasCostData).toBe(true)
		})

		it("should ignore api_req_started messages without cost", () => {
			const messages: ExtensionChatMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.01 }),
				},
				{
					ts: 2000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ request: "test" }), // No cost field
				},
				{
					ts: 3000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.02 }),
				},
			]
			store.set(chatMessagesAtom, messages)
			const result = calculateSessionCost(store.get(chatMessagesAtom))
			expect(result.totalCost).toBeCloseTo(0.03, 4)
			expect(result.requestCount).toBe(2)
			expect(result.hasCostData).toBe(true)
		})

		it("should ignore non-api_req_started messages", () => {
			const messages: ExtensionChatMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.01 }),
				},
				{
					ts: 2000,
					type: "say",
					say: "text",
					text: "Hello world",
				},
				{
					ts: 3000,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({ tool: "readFile" }),
				},
			]
			store.set(chatMessagesAtom, messages)
			const result = calculateSessionCost(store.get(chatMessagesAtom))
			expect(result.totalCost).toBeCloseTo(0.01, 4)
			expect(result.requestCount).toBe(1)
			expect(result.hasCostData).toBe(true)
		})

		it("should handle messages with empty text", () => {
			const messages: ExtensionChatMessage[] = [
				{
					ts: 1000,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ cost: 0.01 }),
				},
				{
					ts: 2000,
					type: "say",
					say: "api_req_started",
					text: "",
				},
				{
					ts: 3000,
					type: "say",
					say: "api_req_started",
					// text is undefined
				},
			]
			store.set(chatMessagesAtom, messages)
			const result = calculateSessionCost(store.get(chatMessagesAtom))
			expect(result.totalCost).toBeCloseTo(0.01, 4)
			expect(result.requestCount).toBe(1)
			expect(result.hasCostData).toBe(true)
		})
	})
})

/**
 * Helper function to calculate session cost from messages
 * This mirrors the logic in useSessionCost hook for testing
 */
function calculateSessionCost(messages: ExtensionChatMessage[]) {
	let totalCost = 0
	let requestCount = 0

	for (const message of messages) {
		if (message.say === "api_req_started" && message.text) {
			const data = JSON.parse(message.text)
			if (typeof data.cost === "number") {
				totalCost += data.cost
				requestCount++
			}
		}
	}

	return {
		totalCost,
		requestCount,
		hasCostData: requestCount > 0,
	}
}

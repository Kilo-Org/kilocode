// kilocode_change - new file
// npx vitest run src/shared/__tests__/getApiMetrics-context-indicator.spec.ts
// Regression tests for context indicator placeholder message handling

import type { ClineMessage } from "@roo-code/types"

import { getApiMetrics } from "../getApiMetrics"

describe("getApiMetrics - context indicator regression tests", () => {
	// Helper function to create a placeholder api_req_started message (only apiProtocol)
	const createPlaceholderApiReqMessage = (ts: number = 2000): ClineMessage => ({
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({ apiProtocol: "anthropic" }),
		ts,
	})

	// Helper function to create a complete api_req_started message with token data
	const createCompleteApiReqMessage = (tokensIn: number, tokensOut: number, ts: number = 1000): ClineMessage => ({
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({
			apiProtocol: "anthropic",
			tokensIn,
			tokensOut,
			cacheWrites: 0,
			cacheReads: 0,
			cost: 0.001,
		}),
		ts,
	})

	describe("placeholder message handling", () => {
		it("should return 0 contextTokens when only a placeholder message exists", () => {
			// This is the initial state when a new task starts
			const messages: ClineMessage[] = [createPlaceholderApiReqMessage(1000)]

			const result = getApiMetrics(messages)

			// Expected: 0 because there's no previous message with token data
			expect(result.contextTokens).toBe(0)
		})

		it("should use previous message's token data when last message is a placeholder", () => {
			// This is the state that causes flickering:
			// - First message has complete token data from previous request
			// - Second message is a placeholder for the new request (no token data yet)
			const messages: ClineMessage[] = [
				createCompleteApiReqMessage(1000, 500, 1000), // Previous request with tokens
				createPlaceholderApiReqMessage(2000), // New request placeholder (no tokens)
			]

			const result = getApiMetrics(messages)

			// BUG: Currently returns 0 because the placeholder message sets contextTokens = 0
			// EXPECTED: Should return 1500 (1000 + 500) from the previous complete message
			// because the placeholder doesn't have valid token data yet
			expect(result.contextTokens).toBe(1500)
		})

		it("should use the last complete message when multiple placeholders exist", () => {
			const messages: ClineMessage[] = [
				createCompleteApiReqMessage(800, 400, 1000), // Complete request
				createPlaceholderApiReqMessage(2000), // Placeholder 1
				createPlaceholderApiReqMessage(3000), // Placeholder 2
			]

			const result = getApiMetrics(messages)

			// Should return 1200 (800 + 400) from the complete message
			expect(result.contextTokens).toBe(1200)
		})

		it("should correctly update when placeholder gets token data", () => {
			// This simulates the state after the API response comes back
			const messages: ClineMessage[] = [
				createCompleteApiReqMessage(1000, 500, 1000), // Previous request
				createCompleteApiReqMessage(1200, 600, 2000), // New request with tokens
			]

			const result = getApiMetrics(messages)

			// Should return 1800 (1200 + 600) from the latest complete message
			expect(result.contextTokens).toBe(1800)
		})

		it("should handle mixed messages with placeholder at the end", () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "text", text: "Hello", ts: 500 },
				createCompleteApiReqMessage(500, 250, 1000),
				{ type: "say", say: "text", text: "Response", ts: 1500 },
				createPlaceholderApiReqMessage(2000),
			]

			const result = getApiMetrics(messages)

			// Should return 750 (500 + 250) from the complete message
			expect(result.contextTokens).toBe(750)
		})
	})

	describe("state update simulation", () => {
		// These tests simulate the sequence of state updates that cause flickering

		it("should not flicker between 0 and actual value during state updates", () => {
			// Simulate the sequence of messages during an API request lifecycle

			// State 1: Previous request complete
			const state1: ClineMessage[] = [createCompleteApiReqMessage(1000, 500, 1000)]
			const result1 = getApiMetrics(state1)
			expect(result1.contextTokens).toBe(1500)

			// State 2: New request started (placeholder added)
			const state2: ClineMessage[] = [
				createCompleteApiReqMessage(1000, 500, 1000),
				createPlaceholderApiReqMessage(2000),
			]
			const result2 = getApiMetrics(state2)
			// BUG: This currently returns 0, causing the flicker
			// EXPECTED: Should return 1500 (from previous request) until new data arrives
			expect(result2.contextTokens).toBe(1500)

			// State 3: New request complete (placeholder updated with token data)
			const state3: ClineMessage[] = [
				createCompleteApiReqMessage(1000, 500, 1000),
				createCompleteApiReqMessage(1200, 600, 2000),
			]
			const result3 = getApiMetrics(state3)
			expect(result3.contextTokens).toBe(1800)
		})

		it("should maintain consistent contextTokens across rapid state updates", () => {
			const previousRequest = createCompleteApiReqMessage(1000, 500, 1000)
			const placeholder = createPlaceholderApiReqMessage(2000)

			// Simulate multiple rapid state updates (as might happen during streaming)
			const states = [
				[previousRequest],
				[previousRequest, placeholder],
				[previousRequest, placeholder], // Duplicate update
				[previousRequest, placeholder], // Another duplicate
			]

			const results = states.map((state) => getApiMetrics(state).contextTokens)

			// All results should be consistent (no flickering)
			// Currently: [1500, 0, 0, 0] - causes flickering
			// Expected: [1500, 1500, 1500, 1500] - no flickering
			expect(results).toEqual([1500, 1500, 1500, 1500])
		})
	})

	describe("edge cases", () => {
		it("should accept explicitly set tokensIn: 0 and tokensOut: 0 as valid data", () => {
			// When tokens are explicitly set to 0, this is valid data (e.g., a very
			// small request that rounds to 0). We should use this value, not fall
			// back to the previous message.
			const messages: ClineMessage[] = [
				createCompleteApiReqMessage(1000, 500, 1000),
				{
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						apiProtocol: "anthropic",
						tokensIn: 0,
						tokensOut: 0,
					}),
					ts: 2000,
				},
			]

			const result = getApiMetrics(messages)

			// When tokens are explicitly 0, this is valid data - use it
			// (0 + 0 = 0, which is the correct context token count for this request)
			expect(result.contextTokens).toBe(0)
		})

		it("should handle placeholder with only apiProtocol field", () => {
			const messages: ClineMessage[] = [
				createCompleteApiReqMessage(1000, 500, 1000),
				{
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ apiProtocol: "openai" }),
					ts: 2000,
				},
			]

			const result = getApiMetrics(messages)

			// Should use previous message's token data
			expect(result.contextTokens).toBe(1500)
		})

		it("should handle condense_context followed by placeholder", () => {
			const messages: ClineMessage[] = [
				{
					type: "say",
					say: "condense_context",
					contextCondense: {
						cost: 0.002,
						newContextTokens: 800,
						prevContextTokens: 1600,
						summary: "Context condensed",
					},
					ts: 1000,
				},
				createPlaceholderApiReqMessage(2000),
			]

			const result = getApiMetrics(messages)

			// Should use condense_context's newContextTokens
			expect(result.contextTokens).toBe(800)
		})
	})
})

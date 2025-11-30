/**
 * Tests for context utilities
 */

import { describe, it, expect } from "vitest"
import { calculateContextUsage, getContextColor, formatContextUsage, calculateTokenDistribution } from "../context.js"
import type { ExtensionChatMessage, ProviderSettings, RouterModels } from "../../types/messages.js"

describe("context utilities", () => {
	describe("calculateContextUsage", () => {
		it("should return zero usage for empty messages (new task)", () => {
			const result = calculateContextUsage([], null)
			expect(result.percentage).toBe(0)
			expect(result.tokensUsed).toBe(0)
			expect(result.maxTokens).toBe(0)
			expect(result.reservedForOutput).toBe(0)
			expect(result.availableSize).toBe(0)
		})

		it("should extract token counts from api_req_started messages", () => {
			const apiConfig: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "anthropic/claude-sonnet-4.5",
			}

			const routerModels: Partial<RouterModels> = {
				openrouter: {
					"anthropic/claude-sonnet-4.5": {
						contextWindow: 200000,
						supportsPromptCache: true,
						maxTokens: 8192,
					},
				},
			}

			const messages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 1000,
						tokensOut: 500,
						cacheWrites: 0,
						cacheReads: 0,
						apiProtocol: "openai",
					}),
				},
			]

			const result = calculateContextUsage(messages, apiConfig, routerModels as RouterModels)
			expect(result.tokensUsed).toBe(1500) // tokensIn + tokensOut for OpenAI
			expect(result.maxTokens).toBe(200000)
			expect(result.percentage).toBeGreaterThan(0)
			expect(result.percentage).toBeLessThan(100)
		})

		it("should handle Anthropic protocol with cache tokens", () => {
			const apiConfig: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "anthropic/claude-sonnet-4.5",
			}

			const routerModels: Partial<RouterModels> = {
				openrouter: {
					"anthropic/claude-sonnet-4.5": {
						contextWindow: 200000,
						supportsPromptCache: true,
						maxTokens: 8192,
					},
				},
			}

			const messages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 1000,
						tokensOut: 500,
						cacheWrites: 200,
						cacheReads: 300,
						apiProtocol: "anthropic",
					}),
				},
			]

			const result = calculateContextUsage(messages, apiConfig, routerModels as RouterModels)
			// For Anthropic: tokensIn + tokensOut + cacheWrites + cacheReads
			expect(result.tokensUsed).toBe(2000)
			expect(result.maxTokens).toBe(200000)
		})

		it("should get context window from model info", () => {
			const apiConfig: ProviderSettings = {
				apiProvider: "kilocode",
				kilocodeModel: "anthropic/claude-sonnet-4.5",
			}

			const routerModels: Partial<RouterModels> = {
				kilocode: {
					"anthropic/claude-sonnet-4.5": {
						contextWindow: 200000,
						supportsPromptCache: true,
						maxTokens: 8192,
					},
				},
			}

			const messages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 1000,
						tokensOut: 500,
						apiProtocol: "openai",
					}),
				},
			]

			const result = calculateContextUsage(messages, apiConfig, routerModels as RouterModels)
			expect(result.maxTokens).toBe(200000)
			expect(result.tokensUsed).toBe(1500)
		})

		it("should return N/A state when no context window available", () => {
			const messages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					text: "Regular message without API data",
				},
			]

			const result = calculateContextUsage(messages, null)
			expect(result.maxTokens).toBe(0)
			expect(result.percentage).toBe(0)
		})

		it("should use the last api_req_started message for context tokens", () => {
			const apiConfig: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "anthropic/claude-sonnet-4.5",
			}

			const routerModels: Partial<RouterModels> = {
				openrouter: {
					"anthropic/claude-sonnet-4.5": {
						contextWindow: 200000,
						supportsPromptCache: true,
						maxTokens: 8192,
					},
				},
			}

			const messages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 1000,
						tokensOut: 500,
						apiProtocol: "openai",
					}),
				},
				{
					ts: Date.now() + 1,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({
						tokensIn: 2000,
						tokensOut: 1000,
						apiProtocol: "openai",
					}),
				},
			]

			const result = calculateContextUsage(messages, apiConfig, routerModels as RouterModels)
			// Should use the last message's tokens
			expect(result.tokensUsed).toBe(3000)
			expect(result.maxTokens).toBe(200000)
		})

		it("should return zero tokens when no api_req_started messages exist", () => {
			const messages: ExtensionChatMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					text: "Regular message without token data",
				},
			]

			const result = calculateContextUsage(messages, null)
			expect(result.tokensUsed).toBe(0)
		})
	})

	describe("getContextColor", () => {
		it("should return green for low usage", () => {
			expect(getContextColor(0)).toBe("green")
			expect(getContextColor(30)).toBe("green")
			expect(getContextColor(60)).toBe("green")
		})

		it("should return yellow for medium usage", () => {
			expect(getContextColor(61)).toBe("yellow")
			expect(getContextColor(75)).toBe("yellow")
			expect(getContextColor(85)).toBe("yellow")
		})

		it("should return red for high usage", () => {
			expect(getContextColor(86)).toBe("red")
			expect(getContextColor(95)).toBe("red")
			expect(getContextColor(100)).toBe("red")
		})
	})

	describe("formatContextUsage", () => {
		it("should format percentage correctly when data is available", () => {
			expect(
				formatContextUsage({
					percentage: 45,
					tokensUsed: 45,
					maxTokens: 100,
					reservedForOutput: 8192,
					availableSize: 0,
				}),
			).toBe("45%")
			expect(
				formatContextUsage({
					percentage: 100,
					tokensUsed: 100,
					maxTokens: 100,
					reservedForOutput: 8192,
					availableSize: 0,
				}),
			).toBe("100%")
		})

		it("should return '0%' for new empty task", () => {
			expect(
				formatContextUsage({
					percentage: 0,
					tokensUsed: 0,
					maxTokens: 0,
					reservedForOutput: 0,
					availableSize: 0,
				}),
			).toBe("0%")
		})

		it("should return 'N/A' when context data not available", () => {
			expect(
				formatContextUsage({
					percentage: 0,
					tokensUsed: 1500,
					maxTokens: 0,
					reservedForOutput: 0,
					availableSize: 0,
				}),
			).toBe("N/A")
		})
	})

	describe("calculateTokenDistribution", () => {
		it("should calculate correct percentages for token distribution", () => {
			const result = calculateTokenDistribution(200000, 50000, 8192)

			expect(result.reservedForOutput).toBe(8192)
			expect(result.availableSize).toBe(200000 - 50000 - 8192)
			// Percentages should sum to 100
			const totalPercent = result.currentPercent + result.reservedPercent + result.availablePercent
			expect(Math.round(totalPercent)).toBe(100)
		})

		it("should handle zero context tokens", () => {
			const result = calculateTokenDistribution(200000, 0, 8192)

			expect(result.currentPercent).toBe(0)
			expect(result.reservedForOutput).toBe(8192)
			expect(result.availableSize).toBeGreaterThan(0)
		})

		it("should use default reserved tokens when maxTokens not provided", () => {
			const result = calculateTokenDistribution(200000, 50000)

			expect(result.reservedForOutput).toBe(8192) // ANTHROPIC_DEFAULT_MAX_TOKENS
		})

		it("should handle edge case where tokens exceed context window", () => {
			const result = calculateTokenDistribution(10000, 15000, 1000)

			// Available size should be 0 (clamped to non-negative)
			expect(result.availableSize).toBe(0)
			// Should still calculate percentages
			expect(result.currentPercent).toBeGreaterThan(0)
		})
	})
})

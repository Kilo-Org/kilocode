/**
 * Context usage calculation utilities
 */

import type { ExtensionChatMessage, ProviderSettings } from "../types/messages.js"
import type { ProviderConfig } from "../config/types.js"
import { type RouterModels, getCurrentModelId, getModelsByProvider } from "../constants/providers/models.js"
import { logs } from "../services/logs.js"

// Default max tokens reserved for model output (matches Anthropic's default)
const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192

export interface ContextUsage {
	percentage: number
	tokensUsed: number
	maxTokens: number
	reservedForOutput: number
	availableSize: number
}

export interface TokenDistribution {
	currentPercent: number
	reservedPercent: number
	availablePercent: number
	reservedForOutput: number
	availableSize: number
}

/**
 * Get the context window from model info
 * Returns 0 if model info is not available
 */
function getContextWindowFromModel(apiConfig: ProviderSettings | null, routerModels: RouterModels | null): number {
	if (!apiConfig || !apiConfig.apiProvider) {
		return 0
	}

	try {
		// Get current model ID
		const currentModelId = getCurrentModelId({
			providerConfig: {
				id: "default",
				provider: apiConfig.apiProvider || "",
				...apiConfig,
			} as ProviderConfig,
			routerModels,
			kilocodeDefaultModel: apiConfig.kilocodeModel || "",
		})

		// Get models for the provider
		const { models } = getModelsByProvider({
			provider: apiConfig.apiProvider,
			routerModels,
			kilocodeDefaultModel: apiConfig.kilocodeModel || "",
		})

		// Get model info
		const modelInfo = models[currentModelId]

		// Return context window from model info
		return modelInfo?.contextWindow || 0
	} catch (error) {
		logs.debug("Failed to get context window from model", "ContextUtils", { error })
		return 0
	}
}

/**
 * Extract actual context tokens from the last API request in messages
 * This matches the webview's approach of using real token counts from API responses
 */
function getContextTokensFromMessages(messages: ExtensionChatMessage[]): number {
	// Look for the last api_req_started message which contains actual token usage
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (!message) continue

		if (message.type === "say" && message.say === "api_req_started" && message.text) {
			try {
				const parsedText = JSON.parse(message.text)
				const { tokensIn, tokensOut, cacheWrites, cacheReads, apiProtocol } = parsedText

				// Skip placeholder messages that only have apiProtocol but no token data
				// These are sent at the start of API requests before the response is received
				const hasValidTokenData = typeof tokensIn === "number" || typeof tokensOut === "number"
				if (!hasValidTokenData) {
					// This is a placeholder message, continue searching backwards
					continue
				}

				// Calculate context tokens based on API protocol (matches getApiMetrics logic)
				if (apiProtocol === "anthropic") {
					return (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
				} else {
					// For OpenAI (or when protocol is not specified)
					return (tokensIn || 0) + (tokensOut || 0)
				}
			} catch (error) {
				logs.debug("Failed to parse api_req_started message", "ContextUtils", { error })
				continue
			}
		} else if (message.type === "say" && message.say === "condense_context") {
			// Check if message has contextCondense metadata
			const contextCondense = message.metadata as { newContextTokens?: number } | undefined
			if (contextCondense && typeof contextCondense.newContextTokens === "number") {
				return contextCondense.newContextTokens
			}
		}
	}

	return 0
}

/**
 * Calculate token distribution within the context window
 * This matches the webview's calculateTokenDistribution function
 */
export function calculateTokenDistribution(
	contextWindow: number,
	contextTokens: number,
	maxTokens?: number,
): TokenDistribution {
	// Handle potential invalid inputs with positive fallbacks
	const safeContextWindow = Math.max(0, contextWindow)
	const safeContextTokens = Math.max(0, contextTokens)

	// Get the actual max tokens value from the model
	// If maxTokens is valid (positive and not equal to context window), use it, otherwise reserve default tokens
	const reservedForOutput =
		maxTokens && maxTokens > 0 && maxTokens !== safeContextWindow ? maxTokens : ANTHROPIC_DEFAULT_MAX_TOKENS

	// Calculate available size
	const availableSize = Math.max(0, safeContextWindow - safeContextTokens - reservedForOutput)

	// Calculate percentages - ensure they sum to exactly 100%
	const total = safeContextTokens + reservedForOutput + availableSize

	// Safeguard against division by zero
	if (total <= 0) {
		return {
			currentPercent: 0,
			reservedPercent: 0,
			availablePercent: 0,
			reservedForOutput,
			availableSize,
		}
	}

	return {
		currentPercent: (safeContextTokens / total) * 100,
		reservedPercent: (reservedForOutput / total) * 100,
		availablePercent: (availableSize / total) * 100,
		reservedForOutput,
		availableSize,
	}
}

/**
 * Calculate context usage from chat messages
 * This now uses actual token counts from API responses, matching the webview implementation
 * @param messages - Array of chat messages
 * @param apiConfig - API configuration containing model info
 * @returns Context usage information
 */
export function calculateContextUsage(
	messages: ExtensionChatMessage[],
	apiConfig: ProviderSettings | null,
	routerModels: RouterModels | null = null,
): ContextUsage {
	try {
		// Get actual context tokens from messages (not estimated)
		const contextTokens = getContextTokensFromMessages(messages)

		// Get context window from model info
		const contextWindow = getContextWindowFromModel(apiConfig, routerModels)

		// If no context window available from model info, return N/A state
		if (contextWindow === 0) {
			return {
				percentage: 0,
				tokensUsed: contextTokens,
				maxTokens: 0,
				reservedForOutput: 0,
				availableSize: 0,
			}
		}

		// Get maxTokens setting if available
		const maxTokens = typeof apiConfig?.modelMaxTokens === "number" ? apiConfig.modelMaxTokens : undefined

		// Calculate token distribution
		const distribution = calculateTokenDistribution(contextWindow, contextTokens, maxTokens)

		return {
			percentage: Math.round(distribution.currentPercent),
			tokensUsed: contextTokens,
			maxTokens: contextWindow,
			reservedForOutput: distribution.reservedForOutput,
			availableSize: distribution.availableSize,
		}
	} catch (error) {
		logs.debug("Failed to calculate context usage", "ContextUtils", { error })
		return {
			percentage: 0,
			tokensUsed: 0,
			maxTokens: 0,
			reservedForOutput: 0,
			availableSize: 0,
		}
	}
}

/**
 * Get a color for the context percentage
 * @param percentage - Context usage percentage (0-100)
 * @returns Color name for Ink Text component
 */
export function getContextColor(percentage: number): string {
	if (percentage >= 86) {
		return "red"
	}
	if (percentage >= 61) {
		return "yellow"
	}
	return "green"
}

/**
 * Format the context usage for display
 * @param usage - Context usage information
 * @returns Formatted string
 */
export function formatContextUsage(usage: ContextUsage): string {
	// If maxTokens is 0, context data is not available
	if (usage.maxTokens === 0) {
		// If tokensUsed is also 0, it's a new empty task
		if (usage.tokensUsed === 0) {
			return "0%"
		}
		// Otherwise, data is not available
		return "N/A"
	}
	return `${usage.percentage}%`
}

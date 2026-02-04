import type { TokenUsage, ToolUsage, ToolName, ClineMessage } from "@roo-code/types"

export type ParsedApiReqStartedTextType = {
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost?: number // Only present if consolidateApiRequests has been called
	apiProtocol?: "anthropic" | "openai"
}

/**
 * Consolidates token usage metrics from an array of ClineMessages.
 *
 * This function processes 'condense_context' messages and 'api_req_started' messages that have been
 * consolidated with their corresponding 'api_req_finished' messages by the consolidateApiRequests function.
 * It extracts and sums up the tokensIn, tokensOut, cacheWrites, cacheReads, and cost from these messages.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A TokenUsage object containing totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, totalCost, and contextTokens.
 *
 * @example
 * const messages = [
 *   { type: "say", say: "api_req_started", text: '{"request":"GET /api/data","tokensIn":10,"tokensOut":20,"cost":0.005}', ts: 1000 }
 * ];
 * const { totalTokensIn, totalTokensOut, totalCost } = consolidateTokenUsage(messages);
 * // Result: { totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.005 }
 */
export function consolidateTokenUsage(messages: ClineMessage[]): TokenUsage {
	const result: TokenUsage = {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: undefined,
		totalCacheReads: undefined,
		totalCost: 0,
		contextTokens: 0,
	}

	// Calculate running totals.
	messages.forEach((message) => {
		if (message.type === "say" && message.say === "api_req_started" && message.text) {
			try {
				const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
				const { tokensIn, tokensOut, cacheWrites, cacheReads, cost } = parsedText

				if (typeof tokensIn === "number") {
					result.totalTokensIn += tokensIn
				}

				if (typeof tokensOut === "number") {
					result.totalTokensOut += tokensOut
				}

				if (typeof cacheWrites === "number") {
					result.totalCacheWrites = (result.totalCacheWrites ?? 0) + cacheWrites
				}

				if (typeof cacheReads === "number") {
					result.totalCacheReads = (result.totalCacheReads ?? 0) + cacheReads
				}

				if (typeof cost === "number") {
					result.totalCost += cost
				}
			} catch (error) {
				console.error("Error parsing JSON:", error)
			}
		} else if (message.type === "say" && message.say === "condense_context") {
			result.totalCost += message.contextCondense?.cost ?? 0
		}
	})

	// Calculate context tokens, from the last API request started or condense
	// context message.
	result.contextTokens = 0

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (!message) continue

		if (message.type === "say" && message.say === "api_req_started" && message.text) {
			try {
				const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
				const { tokensIn, tokensOut } = parsedText

				// Since tokensIn now stores TOTAL input tokens (including cache tokens),
				// we no longer need to add cacheWrites and cacheReads separately.
				// This applies to both Anthropic and OpenAI protocols.
				result.contextTokens = (tokensIn || 0) + (tokensOut || 0)
			} catch {
				// Ignore JSON parse errors
				continue
			}
		} else if (message.type === "say" && message.say === "condense_context") {
			result.contextTokens = message.contextCondense?.newContextTokens ?? 0
		}
		if (result.contextTokens) {
			break
		}
	}

	return result
}

/**
 * Check if token usage has changed by comparing relevant properties.
 * @param current - Current token usage data
 * @param snapshot - Previous snapshot to compare against
 * @returns true if any relevant property has changed or snapshot is undefined
 */
export function hasTokenUsageChanged(current: TokenUsage, snapshot?: TokenUsage): boolean {
	if (!snapshot) {
		return true
	}

	const keysToCompare: (keyof TokenUsage)[] = [
		"totalTokensIn",
		"totalTokensOut",
		"totalCacheWrites",
		"totalCacheReads",
		"totalCost",
		"contextTokens",
	]

	return keysToCompare.some((key) => current[key] !== snapshot[key])
}

/**
 * Check if tool usage has changed by comparing attempts and failures.
 * @param current - Current tool usage data
 * @param snapshot - Previous snapshot to compare against (undefined treated as empty)
 * @returns true if any tool's attempts/failures have changed between current and snapshot
 */
export function hasToolUsageChanged(current: ToolUsage, snapshot?: ToolUsage): boolean {
	// Treat undefined snapshot as empty object for consistent comparison
	const effectiveSnapshot = snapshot ?? {}

	const currentKeys = Object.keys(current) as ToolName[]
	const snapshotKeys = Object.keys(effectiveSnapshot) as ToolName[]

	// Check if number of tools changed
	if (currentKeys.length !== snapshotKeys.length) {
		return true
	}

	// Check if any tool's stats changed
	return currentKeys.some((key) => {
		const currentTool = current[key]
		const snapshotTool = effectiveSnapshot[key]

		if (!snapshotTool || !currentTool) {
			return true
		}

		return currentTool.attempts !== snapshotTool.attempts || currentTool.failures !== snapshotTool.failures
	})
}

import type { ModelInfo } from "@roo-code/types"

function calculateApiCostInternal(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens: number,
	cacheReadInputTokens: number,
): number {
	const cacheWritesCost = ((modelInfo.cacheWritesPrice || 0) / 1_000_000) * cacheCreationInputTokens
	const cacheReadsCost = ((modelInfo.cacheReadsPrice || 0) / 1_000_000) * cacheReadInputTokens
	const baseInputCost = ((modelInfo.inputPrice || 0) / 1_000_000) * inputTokens
	const outputCost = ((modelInfo.outputPrice || 0) / 1_000_000) * outputTokens
	//TOdo: If OpenAi service_tier=flex, price is 0.5x if service_tier=priority,price is 2x.
	const totalCost = cacheWritesCost + cacheReadsCost + baseInputCost + outputCost
	return totalCost
}

// For Anthropic compliant usage, the input tokens count does NOT include the
// cached tokens.
export function calculateApiCostAnthropic(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
): number {
	return calculateApiCostInternal(
		modelInfo,
		inputTokens,
		outputTokens,
		cacheCreationInputTokens || 0,
		cacheReadInputTokens || 0,
	)
}

// For OpenAI compliant usage, the input tokens count INCLUDES the cached tokens.
export function calculateApiCostOpenAI(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
): number {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationInputTokensNum - cacheReadInputTokensNum)

	return calculateApiCostInternal(
		modelInfo,
		nonCachedInputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
	)
}
if 
export const parseApiPrice = (price: any) => (price ? parseFloat(price) * 1_000_000 : undefined)

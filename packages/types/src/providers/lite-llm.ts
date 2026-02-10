import type { ModelInfo } from "../model.js"

// https://docs.litellm.ai/
export const litellmDefaultModelId = "claude-3-7-sonnet-20250219"

export const litellmDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	supportsNativeTools: true,
	defaultToolProtocol: "native",
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
}

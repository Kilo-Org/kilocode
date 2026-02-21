// kilocode_change - new file
// AIhubmix is a dynamic provider, models are fetched from API
// Only fallback types are defined here

import type { ModelInfo } from "../model.js"

export type AihubmixModelId = string

export const aihubmixDefaultModelId = "claude-opus-4-5"

export const aihubmixDefaultModelInfo: ModelInfo = {
	maxTokens: 32000,
	contextWindow: 200000,
	supportsImages: true,
	supportsPromptCache: true,
	supportsNativeTools: true,
	defaultToolProtocol: "native" as const,
	inputPrice: 5,
	outputPrice: 25,
	description: "AIhubmix unified model provider",
}

// kilocode_change - new file
// AIhubmix is a dynamic provider, models are fetched from API
// Only fallback types are defined here

export type AihubmixModelId = string

export const aihubmixDefaultModelId = "claude-opus-4-5"

export const aihubmixDefaultModelInfo = {
	maxTokens: 8192,
	contextWindow: 128000,
	supportsImages: true,
	supportsPromptCache: false,
	supportsNativeTools: true,
	defaultToolProtocol: "native" as const,
	inputPrice: 3,
	outputPrice: 15,
	description: "AIhubmix unified model provider",
}

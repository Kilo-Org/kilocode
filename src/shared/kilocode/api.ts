export const kilocodeOpenrouterModels = {
	"google/gemini-2.5-pro-preview-03-25": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 10,
		description: "Gemini 2.5 Pro via OpenRouter",
	},
	"openai/gpt-4.1": {
		maxTokens: 32_768,
		contextWindow: 1_047_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2,
		outputPrice: 8,
	},
	"google/gemini-2.5-flash-preview": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
}

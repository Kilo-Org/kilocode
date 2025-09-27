import type { ModelInfo } from "../model.js"

export type GeminiModelId = keyof typeof geminiModels

export const geminiDefaultModelId: GeminiModelId = "gemini-2.0-flash-001"

const withDefaults = ({
	maxTokens,
	contextWindow,
	supportsPromptCache,
	supportsImages = true,
	description,
	supportsReasoningBudget,
}: {
	maxTokens: number | null
	contextWindow: number
	supportsPromptCache: boolean
	supportsImages?: boolean
	description?: string
	supportsReasoningBudget?: boolean
}): ModelInfo => ({
	maxTokens,
	contextWindow,
	supportsPromptCache,
	supportsImages,
	description,
	supportsReasoningBudget,
})

export const geminiModels = {
	"gemini-flash-latest": withDefaults({
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsPromptCache: true,
		supportsReasoningBudget: true,
		description: "Gemini 2.5 Flash (Latest)",
	}),
	"gemini-1.5-pro-002": withDefaults({
		maxTokens: 8_192,
		contextWindow: 2_000_000,
		supportsPromptCache: true,
		description: "Stable version of Gemini 1.5 Pro 002",
	}),
	"gemini-1.5-pro": withDefaults({
		maxTokens: 8_192,
		contextWindow: 2_000_000,
		supportsPromptCache: false,
		description: "Stable version of Gemini 1.5 Pro",
	}),
	"gemini-1.5-flash": withDefaults({
		maxTokens: 8_192,
		contextWindow: 1_000_000,
		supportsPromptCache: false,
		description: "Gemini 1.5 Flash",
	}),
	"gemini-1.5-flash-002": withDefaults({
		maxTokens: 8_192,
		contextWindow: 1_000_000,
		supportsPromptCache: true,
		description: "Gemini 1.5 Flash 002",
	}),
	"gemini-1.5-flash-8b": withDefaults({
		maxTokens: 8_192,
		contextWindow: 1_000_000,
		supportsPromptCache: true,
		description: "Gemini 1.5 Flash-8B",
	}),
	"gemini-1.5-flash-8b-001": withDefaults({
		maxTokens: 8_192,
		contextWindow: 1_000_000,
		supportsPromptCache: true,
		description: "Gemini 1.5 Flash-8B 001",
	}),
	"gemini-2.5-flash": withDefaults({
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsPromptCache: true,
		supportsReasoningBudget: true,
		description: "Gemini 2.5 Flash",
	}),
	"gemini-2.5-pro": withDefaults({
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsPromptCache: true,
		supportsReasoningBudget: true,
		description: "Gemini 2.5 Pro",
	}),
	"gemini-2.0-flash": withDefaults({
		maxTokens: 8_192,
		contextWindow: 1_048_576,
		supportsPromptCache: true,
		description: "Gemini 2.0 Flash",
	}),
	"gemini-2.0-flash-001": withDefaults({
		maxTokens: 8_192,
		contextWindow: 1_048_576,
		supportsPromptCache: true,
		description: "Gemini 2.0 Flash 001",
	}),
	"gemini-2.0-flash-lite-001": withDefaults({
		maxTokens: 8_192,
		contextWindow: 1_048_576,
		supportsPromptCache: true,
		description: "Gemini 2.0 Flash-Lite 001",
	}),
	"gemini-2.0-flash-lite": withDefaults({
		maxTokens: 8_192,
		contextWindow: 1_048_576,
		supportsPromptCache: true,
		description: "Gemini 2.0 Flash-Lite",
	}),
	"gemini-2.0-flash-preview-image-generation": withDefaults({
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsPromptCache: false,
		description: "Gemini 2.0 Flash Preview Image Generation",
	}),
} satisfies Record<string, ModelInfo>

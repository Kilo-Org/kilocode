import {
	type ModelInfo,
	type ProviderSettings,
	ANTHROPIC_DEFAULT_MAX_TOKENS,
	CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS,
} from "@roo-code/types"

// ApiHandlerOptions

export type ApiHandlerOptions = Omit<ProviderSettings, "apiProvider">

// kilocode_change start
// Cerebras
// https://inference-docs.cerebras.ai/api-reference/models

// Cerebras AI Inference Model Definitions - Updated August 2025

export const cerebrasModels = {
	"gpt-oss-120b": {
		maxTokens: 65536,
		contextWindow: 65536,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 0.69,
		description: "OpenAI's GPT-OSS model with ~3000 tokens/s",
	},
	"llama-4-scout-17b-16e-instruct": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.65,
		outputPrice: 0.85,
		description: "Llama 4 Scout with ~2600 tokens/s",
	},
	"llama-4-maverick-17b-128e-instruct": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.6,
		description: "Llama 4 Maverick with ~1500 tokens/s",
	},
	"llama3.1-8b": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
		description: "Fast and efficient model with ~2200 tokens/s",
	},
	"llama-3.3-70b": {
		maxTokens: 65536,
		contextWindow: 65536,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.85,
		outputPrice: 1.2,
		description: "Powerful model with ~2100 tokens/s",
	},
	"qwen-3-32b": {
		maxTokens: 65536,
		contextWindow: 65536,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.4,
		outputPrice: 0.8,
		description: "SOTA coding performance with ~2600 tokens/s",
	},
	"qwen-3-235b-a22b-instruct-2507": {
		maxTokens: 64000,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 1.2,
		description: "Intelligent model with ~1400 tokens/s",
	},
	"qwen-3-235b-a22b-thinking-2507": {
		maxTokens: 65536,
		contextWindow: 65536,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 1.2,
		description: "SOTA performance with ~1700 tokens/s",
	},
	"qwen-3-coder-480b": {
		maxTokens: 65536,
		contextWindow: 65536,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.0,
		outputPrice: 2.0,
		description: "SOTA coding model with ~2000 tokens/s",
	},
	"deepseek-r1-distill-llama-70b": {
		maxTokens: 65536,
		contextWindow: 65536,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 2.2,
		outputPrice: 2.5,
		description: "Deepseek R1 Distill with ~2600 tokens/s",
	},
} as const satisfies Record<string, ModelInfo>

export type CerebrasModelId = keyof typeof cerebrasModels
export const cerebrasDefaultModelId: CerebrasModelId = "gpt-oss-120b"

// kilocode_change end

// RouterName

const routerNames = [
	"openrouter",
	"requesty",
	"glama",
	"unbound",
	"litellm",
	"kilocode-openrouter",
	"ollama",
	"lmstudio",
] as const

export type RouterName = (typeof routerNames)[number]

export const isRouterName = (value: string): value is RouterName => routerNames.includes(value as RouterName)

export function toRouterName(value?: string): RouterName {
	if (value && isRouterName(value)) {
		return value
	}

	throw new Error(`Invalid router name: ${value}`)
}

// RouterModels

export type ModelRecord = Record<string, ModelInfo>

export type RouterModels = Record<RouterName, ModelRecord>

// Reasoning

export const shouldUseReasoningBudget = ({
	model,
	settings,
}: {
	model: ModelInfo
	settings?: ProviderSettings
}): boolean => !!model.requiredReasoningBudget || (!!model.supportsReasoningBudget && !!settings?.enableReasoningEffort)

export const shouldUseReasoningEffort = ({
	model,
	settings,
}: {
	model: ModelInfo
	settings?: ProviderSettings
}): boolean => (!!model.supportsReasoningEffort && !!settings?.reasoningEffort) || !!model.reasoningEffort

export const DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS = 16_384
export const DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS = 8_192
export const GEMINI_25_PRO_MIN_THINKING_TOKENS = 128

// Max Tokens

export const getModelMaxOutputTokens = ({
	modelId,
	model,
	settings,
	format,
}: {
	modelId: string
	model: ModelInfo
	settings?: ProviderSettings
	format?: "anthropic" | "openai" | "gemini" | "openrouter"
}): number | undefined => {
	// Check for Claude Code specific max output tokens setting
	if (settings?.apiProvider === "claude-code") {
		return settings.claudeCodeMaxOutputTokens || CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS
	}

	if (shouldUseReasoningBudget({ model, settings })) {
		return settings?.modelMaxTokens || DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS
	}

	const isAnthropicContext =
		modelId.includes("claude") ||
		format === "anthropic" ||
		(format === "openrouter" && modelId.startsWith("anthropic/"))

	// For "Hybrid" reasoning models, discard the model's actual maxTokens for Anthropic contexts
	if (model.supportsReasoningBudget && isAnthropicContext) {
		return ANTHROPIC_DEFAULT_MAX_TOKENS
	}

	// For Anthropic contexts, always ensure a maxTokens value is set
	if (isAnthropicContext && (!model.maxTokens || model.maxTokens === 0)) {
		return ANTHROPIC_DEFAULT_MAX_TOKENS
	}

	// If model has explicit maxTokens, clamp it to 20% of the context window
	if (model.maxTokens) {
		return Math.min(model.maxTokens, Math.ceil(model.contextWindow * 0.2))
	}

	// For non-Anthropic formats without explicit maxTokens, return undefined
	if (format) {
		return undefined
	}

	// Default fallback
	return ANTHROPIC_DEFAULT_MAX_TOKENS
}

// GetModelsOptions

export type GetModelsOptions =
	| { provider: "openrouter"; apiKey?: string; baseUrl?: string } // kilocode_change: add apiKey, baseUrl
	| { provider: "glama" }
	| { provider: "requesty"; apiKey?: string }
	| { provider: "unbound"; apiKey?: string }
	| { provider: "litellm"; apiKey: string; baseUrl: string }
	| { provider: "kilocode-openrouter"; kilocodeToken?: string } // kilocode_change
	| { provider: "cerebras"; cerebrasApiKey?: string } // kilocode_change
	| { provider: "ollama"; baseUrl?: string }
	| { provider: "lmstudio"; baseUrl?: string }

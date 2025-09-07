import type { ModelInfo } from "../model.js"

// Default fallback values for DeepInfra when model metadata is not yet loaded.
export const cometApiDefaultModelId = "claude-sonnet-4-20250514"

export const cometApiDefaultModelInfo: ModelInfo = {
	maxTokens: 64_000, // Overridden to 8k if `enableReasoningEffort` is false.
	contextWindow: 200_000, // Default 200K, extendable to 1M with beta flag 'context-1m-2025-08-07'
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 3.0, // $3 per million input tokens (≤200K context)
	outputPrice: 15.0, // $15 per million output tokens (≤200K context)
	cacheWritesPrice: 3.75, // $3.75 per million tokens
	cacheReadsPrice: 0.3, // $0.30 per million tokens
	supportsReasoningBudget: true,
	// Tiered pricing for extended context (requires beta flag 'context-1m-2025-08-07')
	tiers: [
		{
			contextWindow: 1_000_000, // 1M tokens with beta flag
			inputPrice: 6.0, // $6 per million input tokens (>200K context)
			outputPrice: 22.5, // $22.50 per million output tokens (>200K context)
			cacheWritesPrice: 7.5, // $7.50 per million tokens (>200K context)
			cacheReadsPrice: 0.6, // $0.60 per million tokens (>200K context)
		},
	],
}

// Mirror OpenRouter-style defaults for feature flags and model groupings
export const COMETAPI_DEFAULT_PROVIDER_NAME = "[default]"

// Models known or expected to support prompt caching on Comet API
export const COMETAPI_PROMPT_CACHING_MODELS = new Set<string>([
	// Claude family
	"claude-3-7-sonnet-latest",
	"claude-sonnet-4-20250514",
	"claude-sonnet-4-20250514-thinking",
	"claude-opus-4-1-20250805",
	"claude-opus-4-1-20250805-thinking",
	// Gemini family
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
	"gemini-2.0-flash",
	// GPT family (modern Chat models often support caching)
	"gpt-5-chat-latest",
	"chatgpt-4o-latest",
])

// Models that support Computer Use-style tool/vision actions on Comet API
export const COMETAPI_COMPUTER_USE_MODELS = new Set<string>([
	"claude-3-7-sonnet-latest",
	"claude-sonnet-4-20250514",
	"claude-opus-4-1-20250805",
])

// Models that require reasoning budget to be enabled (e.g., explicit "thinking" variants)
// Keep this list minimal for backwards compatibility.
export const COMETAPI_REQUIRED_REASONING_BUDGET_MODELS = new Set<string>([
	"claude-sonnet-4-20250514-thinking",
	"claude-opus-4-1-20250805-thinking",
])

// Models that optionally support a reasoning budget or extended reasoning mode
export const COMETAPI_REASONING_BUDGET_MODELS = new Set<string>([
	// Claude
	"claude-3-7-sonnet-latest",
	"claude-sonnet-4-20250514",
	"claude-sonnet-4-20250514-thinking",
	"claude-opus-4-1-20250805",
	"claude-opus-4-1-20250805-thinking",
	// Gemini
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
	// OpenAI (reasoning-capable lines)
	"o3-pro-2025-06-10",
	"o4-mini-2025-04-16",
	"gpt-5-chat-latest",
])

// Minimal static models mapping for Comet API (used as fallback/merge in fetcher)
export const cometApiModels: Record<string, ModelInfo> = {
	[cometApiDefaultModelId]: cometApiDefaultModelInfo,
}

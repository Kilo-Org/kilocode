import type { ModelInfo } from "../model.js"

// https://openrouter.ai/models?order=newest&supported_parameters=tools
export const openRouterDefaultModelId = "axon-code"

export const openRouterDefaultModelInfo: ModelInfo = {
	maxTokens: 32000,
	contextWindow: 200_000,
	supportsImages: false,
	supportsComputerUse: false,
	supportsPromptCache: false,
	inputPrice: 1.0,
	outputPrice: 4.0,
	cacheWritesPrice: 0.0,
	cacheReadsPrice: 0.0,
	description: "Axon Code is super intelligent LLM model for coding tasks",
}

export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

export const OPEN_ROUTER_PROMPT_CACHING_MODELS = new Set([
	"anthropic/claude-3-haiku",
	"anthropic/claude-3-haiku:beta",
	"anthropic/claude-3-opus",
	"anthropic/claude-3-opus:beta",
	"anthropic/claude-3-sonnet",
	"anthropic/claude-3-sonnet:beta",
	"anthropic/claude-3.5-haiku",
	"anthropic/claude-3.5-haiku-20241022",
	"anthropic/claude-3.5-haiku-20241022:beta",
	"anthropic/claude-3.5-haiku:beta",
	"anthropic/claude-3.5-sonnet",
	"anthropic/claude-3.5-sonnet-20240620",
	"anthropic/claude-3.5-sonnet-20240620:beta",
	"anthropic/claude-3.5-sonnet:beta",
	"anthropic/claude-3.7-sonnet",
	"anthropic/claude-3.7-sonnet:beta",
	"anthropic/claude-3.7-sonnet:thinking",
	"anthropic/claude-sonnet-4",
	"anthropic/claude-sonnet-4.5",
	"anthropic/claude-opus-4",
	"anthropic/claude-opus-4.1",
	"google/gemini-2.5-flash-preview",
	"google/gemini-2.5-flash-preview:thinking",
	"google/gemini-2.5-flash-preview-05-20",
	"google/gemini-2.5-flash-preview-05-20:thinking",
	"google/gemini-2.5-flash",
	"google/gemini-2.5-flash-lite-preview-06-17",
	"google/gemini-2.0-flash-001",
	"google/gemini-flash-1.5",
	"google/gemini-flash-1.5-8b",
])

// https://www.anthropic.com/news/3-5-models-and-computer-use
export const OPEN_ROUTER_COMPUTER_USE_MODELS = new Set([
	"anthropic/claude-3.5-sonnet",
	"anthropic/claude-3.5-sonnet:beta",
	"anthropic/claude-3.7-sonnet",
	"anthropic/claude-3.7-sonnet:beta",
	"anthropic/claude-3.7-sonnet:thinking",
	"anthropic/claude-sonnet-4",
	"anthropic/claude-sonnet-4.5",
	"anthropic/claude-opus-4",
	"anthropic/claude-opus-4.1",
])

// When we first launched these models we didn't have support for
// enabling/disabling the reasoning budget for hybrid models. Now that we
// do support this we should give users the option to enable/disable it
// whenever possible. However these particular (virtual) model ids with the
// `:thinking` suffix always require the reasoning budget to be enabled, so
// for backwards compatibility we should still require it.
// We should *not* be adding new models to this set.
export const OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS = new Set([
	"anthropic/claude-3.7-sonnet:thinking",
	"google/gemini-2.5-pro",
	"google/gemini-2.5-flash-preview-05-20:thinking",
])

export const OPEN_ROUTER_REASONING_BUDGET_MODELS = new Set([
	"anthropic/claude-3.7-sonnet:beta",
	"anthropic/claude-opus-4",
	"anthropic/claude-opus-4.1",
	"anthropic/claude-sonnet-4",
	"anthropic/claude-sonnet-4.5",
	"anthropic/claude-haiku-4.5",
	"google/gemini-2.5-pro-preview",
	"google/gemini-2.5-pro",
	"google/gemini-2.5-flash-preview-05-20",
	"google/gemini-2.5-flash",
	"google/gemini-2.5-flash-lite-preview-06-17",
	// Also include the models that require the reasoning budget to be enabled
	// even though `OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS` takes precedence.
	"anthropic/claude-3.7-sonnet:thinking",
	"google/gemini-2.5-flash-preview-05-20:thinking",
])

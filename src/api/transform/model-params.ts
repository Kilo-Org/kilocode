import {
	type ModelInfo,
	type ProviderSettings,
	type VerbosityLevel,
	type ReasoningEffortExtended,
	ANTHROPIC_DEFAULT_MAX_TOKENS,
} from "@roo-code/types"

import {
	DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS,
	DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS,
	GEMINI_25_PRO_MIN_THINKING_TOKENS,
	shouldUseReasoningBudget,
	shouldUseReasoningEffort,
	getModelMaxOutputTokens,
} from "../../shared/api"

import {
	type AnthropicReasoningParams,
	type OpenAiReasoningParams,
	type GeminiReasoningParams,
	type OpenRouterReasoningParams,
	getAnthropicReasoning,
	getOpenAiReasoning,
	getGeminiReasoning,
	getOpenRouterReasoning,
} from "./reasoning"
type Format = "anthropic" | "openai" | "gemini" | "openrouter" | "zenmux"

type GetModelParamsOptions<T extends Format> = {
	format: T
	modelId: string
	model: ModelInfo
	settings: ProviderSettings
	defaultTemperature?: number
}

type BaseModelParams = {
	maxTokens: number | undefined
	temperature: number | undefined
	reasoningEffort: ReasoningEffortExtended | undefined
	reasoningBudget: number | undefined
	verbosity: VerbosityLevel | undefined
	tools?: boolean
}

type AnthropicModelParams = {
	format: "anthropic"
	reasoning: AnthropicReasoningParams | undefined
} & BaseModelParams

type OpenAiModelParams = {
	format: "openai"
	reasoning: OpenAiReasoningParams | undefined
} & BaseModelParams

type GeminiModelParams = {
	format: "gemini"
	reasoning: GeminiReasoningParams | undefined
} & BaseModelParams

type OpenRouterModelParams = {
	format: "openrouter"
	reasoning: OpenRouterReasoningParams | undefined
} & BaseModelParams

// kilocode_change start
type ZenMuxModelParams = {
	format: "zenmux"
	reasoning: OpenRouterReasoningParams | undefined
} & BaseModelParams
// kilocode_change end

export type ModelParams =
	| AnthropicModelParams
	| OpenAiModelParams
	| GeminiModelParams
	| OpenRouterModelParams
	| ZenMuxModelParams // kilocode_change

// Function overloads for specific return types
export function getModelParams(options: GetModelParamsOptions<"anthropic">): AnthropicModelParams
export function getModelParams(options: GetModelParamsOptions<"openai">): OpenAiModelParams
export function getModelParams(options: GetModelParamsOptions<"gemini">): GeminiModelParams
export function getModelParams(options: GetModelParamsOptions<"openrouter">): OpenRouterModelParams
export function getModelParams(options: GetModelParamsOptions<"zenmux">): OpenRouterModelParams
export function getModelParams({
	format,
	modelId,
	model,
	settings,
	defaultTemperature = 0,
}: GetModelParamsOptions<Format>): ModelParams {
	const {
		modelMaxTokens: customMaxTokens,
		modelMaxThinkingTokens: customMaxThinkingTokens,
		modelTemperature: customTemperature,
		reasoningEffort: customReasoningEffort,
		verbosity: customVerbosity,
	} = settings

	// Use the centralized logic for computing maxTokens
	const maxTokens = getModelMaxOutputTokens({
		modelId,
		model,
		settings,
		format,
	})

	let temperature = customTemperature ?? model.defaultTemperature ?? defaultTemperature
	let reasoningBudget: ModelParams["reasoningBudget"] = undefined
	let reasoningEffort: ModelParams["reasoningEffort"] = undefined
	let verbosity: VerbosityLevel | undefined = model.supportsVerbosity ? customVerbosity : undefined // kilocode_change

	// kilocode_change start
	if (model.supportsAdaptiveThinking && settings.enableReasoningEffort !== false) {
		temperature = 1.0
	} else if (shouldUseReasoningBudget({ model, settings })) {
		// kilocode_change end
		// Check if this is a Gemini 2.5 Pro model
		const isGemini25Pro = modelId.includes("gemini-2.5-pro")

		// If `customMaxThinkingTokens` is not specified use the default.
		// For Gemini 2.5 Pro, default to 128 instead of 8192
		const defaultThinkingTokens = isGemini25Pro
			? GEMINI_25_PRO_MIN_THINKING_TOKENS
			: DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS
		reasoningBudget = customMaxThinkingTokens ?? defaultThinkingTokens

		// Reasoning cannot exceed 80% of the `maxTokens` value.
		// maxTokens should always be defined for reasoning budget models, but add a guard just in case
		if (maxTokens && reasoningBudget > Math.floor(maxTokens * 0.8)) {
			reasoningBudget = Math.floor(maxTokens * 0.8)
		}

		// Reasoning cannot be less than minimum tokens.
		// For Gemini 2.5 Pro models, the minimum is 128 tokens
		// For other models, the minimum is 1024 tokens
		const minThinkingTokens = isGemini25Pro ? GEMINI_25_PRO_MIN_THINKING_TOKENS : 1024
		if (reasoningBudget < minThinkingTokens) {
			reasoningBudget = minThinkingTokens
		}

		// Let's assume that "Hybrid" reasoning models require a temperature of
		// 1.0 since Anthropic does.
		temperature = 1.0
	} else if (shouldUseReasoningEffort({ model, settings })) {
		// "Traditional" reasoning models use the `reasoningEffort` parameter.
		// Only fallback to model default if user hasn't explicitly set a value.
		// If customReasoningEffort is "disable", don't fallback to model default.
		const effort =
			customReasoningEffort !== undefined
				? customReasoningEffort
				: (model.reasoningEffort as ReasoningEffortExtended | "disable" | undefined)
		// Capability and settings checks are handled by shouldUseReasoningEffort.
		// Here we simply propagate the resolved effort into the params, while
		// still treating "disable" as an omission.
		if (effort && effort !== "disable") {
			reasoningEffort = effort as ReasoningEffortExtended
		}
	}

	const params: BaseModelParams = { maxTokens, temperature, reasoningEffort, reasoningBudget, verbosity }

	if (format === "anthropic") {
		return {
			format,
			...params,
			reasoning: getAnthropicReasoning({ model, reasoningBudget, reasoningEffort, settings }),
		}
	} else if (format === "openai") {
		// Special case for o1 and o3-mini, which don't support temperature.
		// TODO: Add a `supportsTemperature` field to the model info.
		if (modelId.startsWith("o1") || modelId.startsWith("o3-mini")) {
			params.temperature = undefined
		}

		return {
			format,
			...params,
			reasoning: getOpenAiReasoning({ model, reasoningBudget, reasoningEffort, settings }),
			tools: model.supportsNativeTools,
		}
	} else if (format === "gemini") {
		return {
			format,
			...params,
			reasoning: getGeminiReasoning({ model, reasoningBudget, reasoningEffort, settings }),
		}
	} else {
		// Special case for o1-pro, which doesn't support temperature.
		// Note that OpenRouter's `supported_parameters` field includes
		// `temperature`, which is probably a bug.
		// TODO: Add a `supportsTemperature` field to the model info and populate
		// it appropriately in the OpenRouter fetcher.
		if (modelId === "openai/o1-pro") {
			params.temperature = undefined
		}

		return {
			format,
			...params,
			// kilocode_change start
			reasoning: shouldDisableReasoning(modelId, reasoningEffort)
				? { enabled: false }
				: getOpenRouterReasoning({ model, reasoningBudget, reasoningEffort, settings }),
			// kilocode_change end
		}
	}
}

// kilocode_change start
function shouldDisableReasoning(modelId: string, reasoningEffort: ReasoningEffortExtended | undefined) {
	const supportsReasoningToggle =
		modelId.startsWith("deepseek/deepseek-v3.1") ||
		modelId.startsWith("deepseek/deepseek-chat-v3.1") ||
		modelId.startsWith("x-ai/grok-4-fast") ||
		modelId.startsWith("z-ai/glm-4.6")
	return supportsReasoningToggle && reasoningEffort === "minimal"
}
// kilocode_change end

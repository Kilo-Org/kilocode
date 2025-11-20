import { BetaThinkingConfigParam } from "@anthropic-ai/sdk/resources/beta"
import OpenAI from "openai"
import type { GenerateContentConfig } from "@google/genai"

import type { ModelInfo, ProviderSettings, ReasoningEffortWithMinimal } from "@roo-code/types"

import { shouldUseReasoningBudget, shouldUseReasoningEffort } from "../../shared/api"

export type OpenRouterReasoningParams = {
	effort?: ReasoningEffortWithMinimal
	max_tokens?: number
	exclude?: boolean
	enabled?: boolean // kilocode_change
}

export type RooReasoningParams = {
	enabled?: boolean
	effort?: ReasoningEffortWithMinimal
}

export type AnthropicReasoningParams = BetaThinkingConfigParam

export type OpenAiReasoningParams = { reasoning_effort: OpenAI.Chat.ChatCompletionCreateParams["reasoning_effort"] }

export type GeminiReasoningParams = GenerateContentConfig["thinkingConfig"]

export type GetModelReasoningOptions = {
	model: ModelInfo
	reasoningBudget: number | undefined
	reasoningEffort: ReasoningEffortWithMinimal | undefined
	settings: ProviderSettings
}

export const getOpenRouterReasoning = ({
	model,
	reasoningBudget,
	reasoningEffort,
	settings,
}: GetModelReasoningOptions): OpenRouterReasoningParams | undefined =>
	shouldUseReasoningBudget({ model, settings })
		? { max_tokens: reasoningBudget }
		: shouldUseReasoningEffort({ model, settings })
			? reasoningEffort
				? { effort: reasoningEffort }
				: undefined
			: undefined

export const getRooReasoning = ({
	model,
	reasoningEffort,
	settings,
}: GetModelReasoningOptions): RooReasoningParams | undefined => {
	// Check if model supports reasoning effort
	if (!model.supportsReasoningEffort) {
		return undefined
	}

	// If enableReasoningEffort is explicitly false, return enabled: false
	if (settings.enableReasoningEffort === false) {
		return { enabled: false }
	}

	// If reasoning effort is provided, return it with enabled: true
	if (reasoningEffort && reasoningEffort !== "minimal") {
		return { enabled: true, effort: reasoningEffort }
	}

	// If reasoningEffort is explicitly undefined (None selected), disable reasoning
	// This ensures we explicitly tell the backend not to use reasoning
	if (reasoningEffort === undefined) {
		return { enabled: false }
	}

	// Default: no reasoning parameter (reasoning not enabled)
	return undefined
}

export const getAnthropicReasoning = ({
	model,
	reasoningBudget,
	settings,
}: GetModelReasoningOptions): AnthropicReasoningParams | undefined =>
	shouldUseReasoningBudget({ model, settings }) ? { type: "enabled", budget_tokens: reasoningBudget! } : undefined

export const getOpenAiReasoning = ({
	model,
	reasoningEffort,
	settings,
}: GetModelReasoningOptions): OpenAiReasoningParams | undefined => {
	if (!shouldUseReasoningEffort({ model, settings })) {
		return undefined
	}

	// If model has reasoning effort capability, return object even if effort is undefined
	// This preserves the reasoning_effort field in the API call
	if (reasoningEffort === "minimal") {
		return undefined
	}

	return { reasoning_effort: reasoningEffort }
}

export const getGeminiReasoning = ({
	model,
	reasoningBudget,
	settings,
}: GetModelReasoningOptions): GeminiReasoningParams | undefined =>
	shouldUseReasoningBudget({ model, settings })
		? { thinkingBudget: reasoningBudget!, includeThoughts: true }
		: undefined

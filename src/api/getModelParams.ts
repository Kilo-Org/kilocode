import { ApiHandlerOptions, ModelInfo } from "../shared/api"
import { BetaThinkingConfigParam } from "@anthropic-ai/sdk/resources/beta/messages"
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from "./providers/constants"

export function getModelParams({
	options,
	model,
	defaultMaxTokens,
	defaultTemperature = 0,
	defaultReasoningEffort,
}: {
	options: ApiHandlerOptions
	model: ModelInfo
	defaultMaxTokens?: number
	defaultTemperature?: number
	defaultReasoningEffort?: "low" | "medium" | "high"
}) {
	const {
		modelMaxTokens: customMaxTokens,
		modelMaxThinkingTokens: customMaxThinkingTokens,
		modelTemperature: customTemperature,
		reasoningEffort: customReasoningEffort,
	} = options

	let maxTokens = model.maxTokens ?? defaultMaxTokens
	let thinking: BetaThinkingConfigParam | undefined = undefined
	let temperature = customTemperature ?? defaultTemperature
	const reasoningEffort = customReasoningEffort ?? defaultReasoningEffort

	if (model.thinking) {
		// Only honor `customMaxTokens` for thinking models.
		maxTokens = customMaxTokens ?? maxTokens

		// Clamp the thinking budget to be at most 80% of max tokens and at
		// least 1024 tokens.
		const maxBudgetTokens = Math.floor((maxTokens || ANTHROPIC_DEFAULT_MAX_TOKENS) * 0.8)
		const budgetTokens = Math.max(Math.min(customMaxThinkingTokens ?? maxBudgetTokens, maxBudgetTokens), 1024)
		thinking = { type: "enabled", budget_tokens: budgetTokens }

		// Anthropic "Thinking" models require a temperature of 1.0.
		temperature = 1.0
	}

	return { maxTokens, thinking, temperature, reasoningEffort }
}

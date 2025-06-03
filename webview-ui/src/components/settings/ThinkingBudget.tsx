import { useEffect } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { Slider } from "@/components/ui"

import { ProviderSettings, ModelInfo } from "@roo/shared/api"

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384
const DEFAULT_MAX_THINKING_TOKENS = 8_192

interface ThinkingBudgetProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	modelInfo?: ModelInfo
	useOpenAiThinkingLogic?: boolean
}

export const ThinkingBudget = ({
	apiConfiguration,
	setApiConfigurationField,
	modelInfo,
	useOpenAiThinkingLogic = false,
}: ThinkingBudgetProps) => {
	const { t } = useAppTranslation()

	const isThinkingModel = !!modelInfo && !!modelInfo.thinking && !!modelInfo.maxTokens

	// For OpenAI compatible providers, use the thinking enabled logic
	// For other providers, use the original thinking model logic
	const shouldShowThinkingBudget = useOpenAiThinkingLogic
		? isThinkingModel || apiConfiguration.openAiThinkingEnabled === true
		: isThinkingModel

	const customMaxOutputTokens =
		apiConfiguration.modelMaxTokens ??
		(modelInfo?.maxTokens && modelInfo.maxTokens > 0 ? modelInfo.maxTokens : DEFAULT_MAX_OUTPUT_TOKENS)
	const customMaxThinkingTokens = apiConfiguration.modelMaxThinkingTokens ?? DEFAULT_MAX_THINKING_TOKENS

	// Dynamically expand or shrink the max thinking budget based on the custom
	// max output tokens so that there's always a 20% buffer.
	const modelMaxThinkingTokens = modelInfo?.maxThinkingTokens
		? Math.min(modelInfo.maxThinkingTokens, Math.floor(0.8 * customMaxOutputTokens))
		: Math.floor(0.8 * customMaxOutputTokens)

	// If the custom max thinking tokens are going to exceed it's limit due
	// to the custom max output tokens being reduced then we need to shrink it
	// appropriately.
	useEffect(() => {
		if (shouldShowThinkingBudget && customMaxThinkingTokens > modelMaxThinkingTokens) {
			setApiConfigurationField("modelMaxThinkingTokens", modelMaxThinkingTokens)
		}
	}, [shouldShowThinkingBudget, customMaxThinkingTokens, modelMaxThinkingTokens, setApiConfigurationField])

	return shouldShowThinkingBudget && modelInfo?.maxTokens ? (
		<div className="flex flex-col gap-1">
			<div className="font-medium">{t("settings:thinkingBudget.maxThinkingTokens")}</div>
			<div className="flex items-center gap-1" data-testid="thinking-budget">
				<Slider
					min={0}
					max={modelMaxThinkingTokens}
					step={1024}
					value={[customMaxThinkingTokens]}
					onValueChange={([value]) => setApiConfigurationField("modelMaxThinkingTokens", value)}
				/>
				<div className="w-12 text-sm text-center">{customMaxThinkingTokens}</div>
			</div>
		</div>
	) : null
}

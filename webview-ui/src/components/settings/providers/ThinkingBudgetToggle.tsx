import { useEffect } from "react"
import { Checkbox } from "vscrui"
import { ProviderSettings, ModelInfo } from "@roo/shared/api"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Slider } from "@src/components/ui"

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384
const DEFAULT_MAX_THINKING_TOKENS = 8_192

interface ThinkingBudgetToggleProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	modelInfo?: ModelInfo
}

export const ThinkingBudgetToggle = ({
	apiConfiguration,
	setApiConfigurationField,
	modelInfo,
}: ThinkingBudgetToggleProps) => {
	const { t } = useAppTranslation()

	// Support for OpenAI-compatible providers only
	const isOpenAiProvider = apiConfiguration.apiProvider === "openai"

	// Use unified field name for OpenAI providers
	const thinkingEnabledField = "openAiThinkingEnabled"
	const isThinkingEnabled = apiConfiguration?.openAiThinkingEnabled ?? false

	// Thinking budget logic (only when enabled)
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
		if (isOpenAiProvider && isThinkingEnabled && customMaxThinkingTokens > modelMaxThinkingTokens) {
			setApiConfigurationField("modelMaxThinkingTokens", modelMaxThinkingTokens)
		}
	}, [isOpenAiProvider, isThinkingEnabled, customMaxThinkingTokens, modelMaxThinkingTokens, setApiConfigurationField])

	if (!isOpenAiProvider) {
		return null
	}

	return (
		<div className="flex flex-col gap-1">
			<Checkbox
				checked={isThinkingEnabled}
				onChange={(checked: boolean) => {
					setApiConfigurationField(thinkingEnabledField as keyof ProviderSettings, checked)
				}}>
				{t("settings:providers.controlThinkingBudget")}
			</Checkbox>
			{isThinkingEnabled && modelInfo?.maxTokens && (
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
			)}
		</div>
	)
}

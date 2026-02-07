/*
Semantics for Reasoning Effort (ThinkingBudget)

Capability surface:
- modelInfo.supportsReasoningEffort: boolean | Array&lt;"disable" | "none" | "minimal" | "low" | "medium" | "high"&gt;
  - true  → UI shows ["low","medium","high"]
  - array → UI shows exactly the provided values

Selection behavior:
- "disable":
  - Label: t("settings:providers.reasoningEffort.none")
  - set enableReasoningEffort = false
  - persist reasoningEffort = "disable"
  - request builders omit any reasoning parameter/body sections
- "none":
  - Label: t("settings:providers.reasoningEffort.none")
  - set enableReasoningEffort = true
  - persist reasoningEffort = "none"
  - request builders include reasoning with value "none"
- "minimal" | "low" | "medium" | "high":
  - set enableReasoningEffort = true
  - persist the selected value
  - request builders include reasoning with the selected effort

Required:
- If modelInfo.requiredReasoningEffort is true, do not synthesize a "None" choice. Only show values from the capability.
- On mount, if unset and a default exists, set enableReasoningEffort = true and use modelInfo.reasoningEffort.

Notes:
- Current selection is normalized to the capability: unsupported persisted values are not shown.
- Both "disable" and "none" display as the "None" label per UX, but are wired differently as above.
- "minimal" uses t("settings:providers.reasoningEffort.minimal").
*/

import { useEffect } from "react"
import { Checkbox } from "vscrui"

import {
	type ProviderSettings,
	type ModelInfo,
	type ReasoningEffortWithMinimal,
	reasoningEfforts,
} from "@roo-code/types"

import {
	DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS,
	DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS,
	GEMINI_25_PRO_MIN_THINKING_TOKENS,
} from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Slider, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"

interface ThinkingBudgetProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	modelInfo?: ModelInfo
}

export const ThinkingBudget = ({ apiConfiguration, setApiConfigurationField, modelInfo }: ThinkingBudgetProps) => {
	const { t } = useAppTranslation()
	const { id: selectedModelId } = useSelectedModel(apiConfiguration)

	// Check if this is a Gemini 2.5 Pro model
	const isGemini25Pro = selectedModelId && selectedModelId.includes("gemini-2.5-pro")
	const minThinkingTokens = isGemini25Pro ? GEMINI_25_PRO_MIN_THINKING_TOKENS : 1024

	// Check model capabilities
	const isReasoningSupported = !!modelInfo && modelInfo.supportsReasoningBinary
	const isReasoningBudgetSupported = !!modelInfo && modelInfo.supportsReasoningBudget
	const isReasoningBudgetRequired = !!modelInfo && modelInfo.requiredReasoningBudget
	const isReasoningEffortSupported = !!modelInfo && modelInfo.supportsReasoningEffort

	// Build available reasoning efforts list from capability
	const supports = modelInfo?.supportsReasoningEffort
	const baseAvailableOptions: ReadonlyArray<ReasoningEffortWithMinimal> =
		supports === true
			? (reasoningEfforts as readonly ReasoningEffortWithMinimal[])
			: Array.isArray(supports)
				? (supports as ReadonlyArray<ReasoningEffortWithMinimal>)
				: (reasoningEfforts as readonly ReasoningEffortWithMinimal[])

	// "disable" turns off reasoning entirely; "none" is a valid reasoning level.
	// Both display as "None" in the UI but behave differently.
	// Add "disable" option only when:
	// 1. requiredReasoningEffort is not true, AND
	// 2. supportsReasoningEffort is boolean true (not an explicit array)
	// When the model provides an explicit array, respect those exact values.
	type ReasoningEffortOption = ReasoningEffortWithMinimal | "none" | "disable"
	const shouldAutoAddDisable =
		!modelInfo?.requiredReasoningEffort && supports === true && !baseAvailableOptions.includes("disable" as any)
	const availableOptions: ReadonlyArray<ReasoningEffortOption> = shouldAutoAddDisable
		? (["disable", ...baseAvailableOptions] as ReasoningEffortOption[])
		: (baseAvailableOptions as ReadonlyArray<ReasoningEffortOption>)

	// Default reasoning effort - use model's default if available
	// GPT-5 models have "medium" as their default in the model configuration
	const modelDefaultReasoningEffort = modelInfo?.reasoningEffort as ReasoningEffortWithMinimal | undefined
	const defaultReasoningEffort: ReasoningEffortOption = modelInfo?.requiredReasoningEffort
		? modelDefaultReasoningEffort || "medium"
		: "disable"
	// Current reasoning effort from settings, or fall back to default
	const storedReasoningEffort = apiConfiguration.reasoningEffort as ReasoningEffortOption | undefined
	const currentReasoningEffort: ReasoningEffortOption = storedReasoningEffort || defaultReasoningEffort

	// Set default reasoning effort when model supports it and no value is set
	useEffect(() => {
		if (isReasoningEffortSupported && !apiConfiguration.reasoningEffort) {
			// Only set a default if reasoning is required, otherwise leave as undefined (which maps to "disable")
			if (modelInfo?.requiredReasoningEffort && defaultReasoningEffort !== "disable") {
				setApiConfigurationField("reasoningEffort", defaultReasoningEffort as ReasoningEffortWithMinimal, false)
			}
		}
	}, [
		isReasoningEffortSupported,
		apiConfiguration.reasoningEffort,
		defaultReasoningEffort,
		modelInfo?.requiredReasoningEffort,
		setApiConfigurationField,
	])

	// Sync enableReasoningEffort based on selection
	// "disable" turns off reasoning; "none" is a valid level (reasoning enabled)
	useEffect(() => {
		if (!isReasoningEffortSupported) return
		const shouldEnable = modelInfo?.requiredReasoningEffort || currentReasoningEffort !== "disable"
		if (shouldEnable && apiConfiguration.enableReasoningEffort !== true) {
			setApiConfigurationField("enableReasoningEffort", true, false)
		}
	}, [
		isReasoningEffortSupported,
		modelInfo?.requiredReasoningEffort,
		currentReasoningEffort,
		apiConfiguration.enableReasoningEffort,
		setApiConfigurationField,
	])

	const enableReasoningEffort = apiConfiguration.enableReasoningEffort
	// kilocode_change
	const enableBinaryReasoningEffort = apiConfiguration.enableReasoningEffort ?? true
	const customMaxOutputTokens = apiConfiguration.modelMaxTokens || DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS
	const customMaxThinkingTokens =
		apiConfiguration.modelMaxThinkingTokens || DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS

	// Dynamically expand or shrink the max thinking budget based on the custom
	// max output tokens so that there's always a 20% buffer.
	const modelMaxThinkingTokens = modelInfo?.maxThinkingTokens
		? Math.min(modelInfo.maxThinkingTokens, Math.floor(0.8 * customMaxOutputTokens))
		: Math.floor(0.8 * customMaxOutputTokens)

	// If the custom max thinking tokens are going to exceed it's limit due
	// to the custom max output tokens being reduced then we need to shrink it
	// appropriately.
	useEffect(() => {
		if (isReasoningBudgetSupported && customMaxThinkingTokens > modelMaxThinkingTokens) {
			setApiConfigurationField("modelMaxThinkingTokens", modelMaxThinkingTokens, false)
		}
	}, [isReasoningBudgetSupported, customMaxThinkingTokens, modelMaxThinkingTokens, setApiConfigurationField])

	// kilocode_change start
	// If the custom max output tokens are going to exceed it's limit due
	// to the model info max tokens then we need to shrink it appropriately.
	useEffect(() => {
		if (isReasoningBudgetSupported && modelInfo?.maxTokens && customMaxOutputTokens > modelInfo.maxTokens) {
			setApiConfigurationField("modelMaxTokens", modelInfo.maxTokens || DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS)
		}
	}, [isReasoningBudgetSupported, customMaxOutputTokens, modelInfo?.maxTokens, setApiConfigurationField])
	// kilocode_change end

	if (!modelInfo) {
		return null
	}

	// Models with supportsReasoningBinary (binary reasoning) show a simple on/off toggle
	if (isReasoningSupported) {
		return (
			<div className="flex flex-col gap-1">
				<Checkbox
					checked={enableBinaryReasoningEffort}
					onChange={(checked: boolean) =>
						setApiConfigurationField("enableReasoningEffort", checked === true)
					}>
					{t("settings:providers.useReasoning")}
				</Checkbox>
			</div>
		)
	}

	return isReasoningBudgetSupported && !!modelInfo.maxTokens ? (
		<>
			{!isReasoningBudgetRequired &&
				apiConfiguration.apiProvider !== "virtual-quota-fallback" /*kilocode_change*/ && (
					<div className="flex flex-col gap-1">
						<Checkbox
							checked={enableReasoningEffort}
							onChange={(checked: boolean) =>
								setApiConfigurationField("enableReasoningEffort", checked === true)
							}>
							{t("settings:providers.useReasoning")}
						</Checkbox>
					</div>
				)}
			{(isReasoningBudgetRequired || enableReasoningEffort) && (
				<>
					<div className="flex flex-col gap-1">
						<div className="font-medium">{t("settings:thinkingBudget.maxTokens")}</div>
						<div className="flex items-center gap-1">
							<Slider
								min={8192}
								max={Math.max(
									modelInfo.maxTokens || 8192,
									customMaxOutputTokens,
									DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS,
								)}
								step={1024}
								value={[customMaxOutputTokens]}
								onValueChange={([value]) => setApiConfigurationField("modelMaxTokens", value)}
							/>
							<div className="w-12 text-sm text-center">{customMaxOutputTokens}</div>
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<div className="font-medium">{t("settings:thinkingBudget.maxThinkingTokens")}</div>
						<div className="flex items-center gap-1" data-testid="reasoning-budget">
							<Slider
								min={minThinkingTokens}
								max={modelMaxThinkingTokens}
								step={minThinkingTokens === 128 ? 128 : 1024}
								value={[customMaxThinkingTokens]}
								onValueChange={([value]) => setApiConfigurationField("modelMaxThinkingTokens", value)}
							/>
							<div className="w-12 text-sm text-center">{customMaxThinkingTokens}</div>
						</div>
					</div>
				</>
			)}
		</>
	) : isReasoningEffortSupported ? (
		<div className="flex flex-col gap-1" data-testid="reasoning-effort">
			<div className="flex justify-between items-center">
				<label className="block font-medium mb-1">{t("settings:providers.reasoningEffort.label")}</label>
			</div>
			<Select
				value={currentReasoningEffort}
				onValueChange={(value: ReasoningEffortOption) => {
					// "disable" turns off reasoning entirely; "none" is a valid reasoning level
					if (value === "disable") {
						setApiConfigurationField("enableReasoningEffort", false)
						setApiConfigurationField("reasoningEffort", "disable")
					} else {
						// "none", "minimal", "low", "medium", "high" all enable reasoning
						setApiConfigurationField("enableReasoningEffort", true)
						setApiConfigurationField("reasoningEffort", value as ReasoningEffortWithMinimal)
					}
				}}>
				<SelectTrigger className="w-full">
					<SelectValue
						placeholder={
							currentReasoningEffort
								? currentReasoningEffort === "none" || currentReasoningEffort === "disable"
									? t("settings:providers.reasoningEffort.none")
									: t(`settings:providers.reasoningEffort.${currentReasoningEffort}`)
								: t("settings:common.select")
						}
					/>
				</SelectTrigger>
				<SelectContent>
					{availableOptions.map((value) => (
						<SelectItem key={value} value={value}>
							{value === "none" || value === "disable"
								? t("settings:providers.reasoningEffort.none")
								: t(`settings:providers.reasoningEffort.${value}`)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	) : null
}

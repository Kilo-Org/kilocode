import { useEffect } from "react"

import { type ProviderSettings, type ModelInfo, type ReasoningEffort, reasoningEfforts } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

interface SimpleThinkingBudgetProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	modelInfo?: ModelInfo
}

// Extended type to include "none" option
type ReasoningEffortWithNone = ReasoningEffort | "none"

export const SimpleThinkingBudget = ({
	apiConfiguration,
	setApiConfigurationField,
	modelInfo,
}: SimpleThinkingBudgetProps) => {
	const { t } = useAppTranslation()

	// Check model capabilities
	const isReasoningEffortSupported = !!modelInfo && modelInfo.supportsReasoningEffort
	const isReasoningEffortRequired = !!modelInfo && modelInfo.requiredReasoningEffort

	// Build available reasoning efforts list
	// Include "none" option unless reasoning effort is required
	const baseEfforts = [...reasoningEfforts] as ReasoningEffort[]
	const availableReasoningEfforts: ReadonlyArray<ReasoningEffortWithNone> = isReasoningEffortRequired
		? baseEfforts
		: (["none", ...baseEfforts] as ReasoningEffortWithNone[])

	// Default reasoning effort - use model's default if available, otherwise "medium"
	const modelDefaultReasoningEffort = modelInfo?.reasoningEffort as ReasoningEffort | undefined
	const defaultReasoningEffort: ReasoningEffortWithNone = isReasoningEffortRequired
		? modelDefaultReasoningEffort || "medium"
		: "none"

	// Current reasoning effort - treat undefined/null as "none"
	const currentReasoningEffort: ReasoningEffortWithNone =
		(apiConfiguration.reasoningEffort as ReasoningEffort | undefined) || defaultReasoningEffort

	// Set default reasoning effort when model supports it and no value is set
	useEffect(() => {
		if (isReasoningEffortSupported && !apiConfiguration.reasoningEffort) {
			// Only set a default if reasoning is required, otherwise leave as undefined (which maps to "none")
			if (isReasoningEffortRequired && defaultReasoningEffort !== "none") {
				setApiConfigurationField("reasoningEffort", defaultReasoningEffort as ReasoningEffort, false)
			}
		}
	}, [
		isReasoningEffortSupported,
		isReasoningEffortRequired,
		apiConfiguration.reasoningEffort,
		defaultReasoningEffort,
		setApiConfigurationField,
	])

	useEffect(() => {
		if (!isReasoningEffortSupported) return
		const shouldEnable = isReasoningEffortRequired || currentReasoningEffort !== "none"
		if (shouldEnable && apiConfiguration.enableReasoningEffort !== true) {
			setApiConfigurationField("enableReasoningEffort", true, false)
		}
	}, [
		isReasoningEffortSupported,
		isReasoningEffortRequired,
		currentReasoningEffort,
		apiConfiguration.enableReasoningEffort,
		setApiConfigurationField,
	])
	if (!modelInfo || !isReasoningEffortSupported) {
		return null
	}

	return (
		<div className="flex flex-col gap-1" data-testid="simple-reasoning-effort">
			<div className="flex justify-between items-center">
				<label className="block font-medium mb-1">{t("settings:providers.reasoningEffort.label")}</label>
			</div>
			<Select
				value={currentReasoningEffort}
				onValueChange={(value: ReasoningEffortWithNone) => {
					// If "none" is selected, clear the reasoningEffort field
					if (value === "none") {
						setApiConfigurationField("reasoningEffort", undefined)
					} else {
						setApiConfigurationField("reasoningEffort", value as ReasoningEffort)
					}
				}}>
				<SelectTrigger className="w-full">
					<SelectValue
						placeholder={
							currentReasoningEffort
								? currentReasoningEffort === "none"
									? t("settings:providers.reasoningEffort.none")
									: t(`settings:providers.reasoningEffort.${currentReasoningEffort}`)
								: t("settings:common.select")
						}
					/>
				</SelectTrigger>
				<SelectContent>
					{availableReasoningEfforts.map((value) => (
						<SelectItem key={value} value={value}>
							{value === "none"
								? t("settings:providers.reasoningEffort.none")
								: t(`settings:providers.reasoningEffort.${value}`)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}

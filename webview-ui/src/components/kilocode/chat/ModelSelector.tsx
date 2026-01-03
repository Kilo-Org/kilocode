import { useMemo } from "react"
import { SelectDropdown, DropdownOptionType } from "@/components/ui"
import { OPENROUTER_DEFAULT_PROVIDER_NAME, type ProviderSettings } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { prettyModelName } from "../../../utils/prettyModelName"
import { useProviderModels } from "../hooks/useProviderModels"
import { getModelIdKey, getSelectedModelId } from "../hooks/useSelectedModel"
import { usePreferredModels } from "@/components/ui/hooks/kilocode/usePreferredModels"

interface ModelSelectorProps {
	currentApiConfigName?: string
	apiConfiguration: ProviderSettings
	fallbackText: string
	virtualQuotaActiveModel?: { id: string; name: string; activeProfileNumber?: number } // kilocode_change: Add virtual quota active model for UI display
}

export const ModelSelector = ({
	currentApiConfigName,
	apiConfiguration,
	fallbackText,
	virtualQuotaActiveModel, //kilocode_change
}: ModelSelectorProps) => {
	const { t } = useAppTranslation()
	const { provider, providerModels, providerDefaultModel, isLoading, isError } = useProviderModels(apiConfiguration)
	const selectedModelId = getSelectedModelId({
		provider,
		apiConfiguration,
		defaultModelId: providerDefaultModel,
	})
	const modelIdKey = getModelIdKey({ provider })
	const isAutocomplete = apiConfiguration.profileType === "autocomplete"

	const modelsIds = usePreferredModels(providerModels)
	const options = useMemo(() => {
		const missingModelIds = modelsIds.indexOf(selectedModelId) >= 0 ? [] : [selectedModelId]
		return missingModelIds.concat(modelsIds).map((modelId) => ({
			value: modelId,
			label: providerModels[modelId]?.displayName ?? prettyModelName(modelId),
			type: DropdownOptionType.ITEM,
		}))
	}, [modelsIds, providerModels, selectedModelId])

	const disabled = isLoading || isError || isAutocomplete

	const onChange = (value: string) => {
		if (!currentApiConfigName) {
			return
		}
		if (apiConfiguration[modelIdKey] === value) {
			// don't reset openRouterSpecificProvider
			return
		}
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				[modelIdKey]: value,
				openRouterSpecificProvider: OPENROUTER_DEFAULT_PROVIDER_NAME,
			},
		})
	}

	if (isLoading) {
		return null
	}

	// kilocode_change start: Display active model for virtual quota fallback
	if (provider === "virtual-quota-fallback" && virtualQuotaActiveModel) {
		return (
			<span className="text-xs text-vscode-descriptionForeground opacity-70 truncate">
				{prettyModelName(virtualQuotaActiveModel.id)}
				{virtualQuotaActiveModel.activeProfileNumber !== undefined && (
					<> ({virtualQuotaActiveModel.activeProfileNumber})</>
				)}
			</span>
		)
	}
	// kilocode_change end

	if (isError || isAutocomplete || options.length <= 0) {
		return <span className="text-xs text-vscode-descriptionForeground opacity-70 truncate">{fallbackText}</span>
	}

	return (
		<SelectDropdown
			value={selectedModelId}
			disabled={disabled}
			title={t("chat:selectApiConfig")}
			options={options}
			onChange={onChange}
			contentClassName="max-h-[300px] overflow-y-auto"
			triggerClassName={cn(
				"w-full text-ellipsis overflow-hidden p-0",
				"bg-transparent border-transparent hover:bg-transparent hover:border-transparent",
			)}
			triggerIcon={false}
			itemClassName="group"
		/>
	)
}

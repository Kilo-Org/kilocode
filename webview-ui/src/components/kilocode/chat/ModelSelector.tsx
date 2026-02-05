import { useMemo, useState, useEffect } from "react"
import { SelectDropdown, DropdownOptionType, type DropdownOption } from "@/components/ui"
import { OPENROUTER_DEFAULT_PROVIDER_NAME, type ProviderSettings } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { OCAModelService } from "@src/services/OCAModelService"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { prettyModelName } from "../../../utils/prettyModelName"
import { useProviderModels } from "../hooks/useProviderModels"
import { getModelIdKey, getSelectedModelId } from "../hooks/useSelectedModel"
import { useGroupedModelIds } from "@/components/ui/hooks/kilocode/usePreferredModels"
import OcaAcknowledgeModal from "../common/OcaAcknowledgeModal"

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

	const { preferredModelIds, restModelIds } = useGroupedModelIds(providerModels)
	const [ackOpen, setAckOpen] = useState(false)
	const [pendingModelId, setPendingModelId] = useState<string | null>(null)
	const bannerHtml = pendingModelId ? (providerModels as any)?.[pendingModelId]?.banner : undefined

	const options = useMemo(() => {
		const result: DropdownOption[] = []

		// Check if selected model is missing from the lists
		const allModelIds = [...preferredModelIds, ...restModelIds]
		const isMissingSelectedModel = selectedModelId && !allModelIds.includes(selectedModelId)

		// Add "Recommended models" section if there are preferred models
		if (preferredModelIds.length > 0) {
			result.push({
				value: "__label_recommended__",
				label: t("settings:modelPicker.recommendedModels"),
				type: DropdownOptionType.LABEL,
			})

			preferredModelIds.forEach((modelId) => {
				result.push({
					value: modelId,
					label: providerModels[modelId]?.displayName ?? prettyModelName(modelId),
					type: DropdownOptionType.ITEM,
				})
			})
		}

		// Add "All models" section
		if (restModelIds.length > 0) {
			result.push({
				value: "__label_all__",
				label: t("settings:modelPicker.allModels"),
				type: DropdownOptionType.LABEL,
			})

			// Add missing selected model at the top of "All models" if not in any list
			if (isMissingSelectedModel) {
				result.push({
					value: selectedModelId,
					label: providerModels[selectedModelId]?.displayName ?? prettyModelName(selectedModelId),
					type: DropdownOptionType.ITEM,
				})
			}

			restModelIds.forEach((modelId) => {
				result.push({
					value: modelId,
					label: providerModels[modelId]?.displayName ?? prettyModelName(modelId),
					type: DropdownOptionType.ITEM,
				})
			})
		} else if (isMissingSelectedModel) {
			// If there are no rest models but we have a missing selected model, add it
			result.push({
				value: selectedModelId,
				label: providerModels[selectedModelId]?.displayName ?? prettyModelName(selectedModelId),
				type: DropdownOptionType.ITEM,
			})
		}

		return result
	}, [preferredModelIds, restModelIds, providerModels, selectedModelId, t])

	const disabled = isLoading || isError || isAutocomplete

	useEffect(() => {
		if (provider !== "oca") return
		try {
			OCAModelService.setOcaModels(providerModels as any)
		} catch (err) {
			console.debug("ModelSelector: failure setting OCA models", err)
		}

		const saved = OCAModelService.getOcaSelectedModelId()
		const first = Object.keys(providerModels || {})[0]
		const target = saved || first

		if (!target || !currentApiConfigName) return
		if (selectedModelId === target || !providerModels[target]) return

		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				[getModelIdKey({ provider })]: target,
				openRouterSpecificProvider: OPENROUTER_DEFAULT_PROVIDER_NAME,
			},
		})
		try {
			OCAModelService.setOcaSelectedModelId(target)
		} catch (err) {
			console.debug("ModelSelector: failure setting selected OCA model", err)
		}
	}, [provider, providerModels, selectedModelId, currentApiConfigName, apiConfiguration])

	const onChange = (value: string) => {
		if (!currentApiConfigName) {
			return
		}
		if (apiConfiguration[modelIdKey] === value) {
			// don't reset openRouterSpecificProvider
			return
		}
		if (provider === "oca" && (providerModels as any)?.[value]?.banner) {
			setPendingModelId(value)
			setAckOpen(true)
			return
		}
		if (provider === "oca") {
			try {
				OCAModelService.setOcaSelectedModelId(value)
			} catch (err) {
				console.debug("ModelSelector: failure setting selected OCA model on change", err)
			}
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

	const onAcknowledge = () => {
		if (!currentApiConfigName || !pendingModelId || apiConfiguration[modelIdKey] === pendingModelId) {
			setAckOpen(false)
			setPendingModelId(null)
			return
		}
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				[modelIdKey]: pendingModelId,
				openRouterSpecificProvider: OPENROUTER_DEFAULT_PROVIDER_NAME,
			},
		})
		try {
			if (provider === "oca") {
				OCAModelService.setOcaSelectedModelId(pendingModelId)
			}
		} catch (err) {
			console.debug("ModelSelector: failure setting selected OCA model on acknowledge", err)
		}
		setAckOpen(false)
		setPendingModelId(null)
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
		<>
			<OcaAcknowledgeModal
				open={ackOpen}
				bannerHtml={bannerHtml ?? undefined}
				onAcknowledge={onAcknowledge}
				onCancel={() => {
					setAckOpen(false)
					setPendingModelId(null)
				}}
			/>
			<SelectDropdown
				value={selectedModelId}
				disabled={disabled}
				title={t("chat:selectApiConfig")}
				options={options}
				onChange={onChange}
				contentClassName="max-h-[400px] overflow-y-auto"
				triggerClassName={cn(
					"w-full text-ellipsis overflow-hidden p-0",
					"bg-transparent border-transparent hover:bg-transparent hover:border-transparent",
				)}
				triggerIcon={false}
				itemClassName="group"
			/>
		</>
	)
}

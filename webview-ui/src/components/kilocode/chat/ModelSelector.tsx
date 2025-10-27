import { useMemo, useState } from "react"
import { SelectDropdown, DropdownOptionType } from "@/components/ui"
import { OPENROUTER_DEFAULT_PROVIDER_NAME, type ProviderSettings } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { prettyModelName } from "../../../utils/prettyModelName"
import { useProviderModels } from "../hooks/useProviderModels"
import { getModelIdKey, getSelectedModelId } from "../hooks/useSelectedModel"
import { usePreferredModels } from "@/components/ui/hooks/kilocode/usePreferredModels"
import OcaAcknowledgeModal from "../common/OcaAcknowledgeModal"

interface ModelSelectorProps {
	currentApiConfigName?: string
	apiConfiguration: ProviderSettings
	fallbackText: string
}

export const ModelSelector = ({ currentApiConfigName, apiConfiguration, fallbackText }: ModelSelectorProps) => {
	const { t } = useAppTranslation()
	const { provider, providerModels, providerDefaultModel, isLoading, isError } = useProviderModels(apiConfiguration)
	const selectedModelId = getSelectedModelId({
		provider,
		apiConfiguration,
		defaultModelId: providerDefaultModel,
	})
	const modelIdKey = getModelIdKey({ provider })

	// OCA model acknowledgement gating (Settings and Chat)
	const [ackOpen, setAckOpen] = useState(false)
	const [pendingModelId, setPendingModelId] = useState<string | null>(null)
	const bannerHtml = pendingModelId ? (providerModels as any)?.[pendingModelId]?.banner : undefined

	const modelsIds = usePreferredModels(providerModels)
	const options = useMemo(() => {
		const missingModelIds = modelsIds.indexOf(selectedModelId) >= 0 ? [] : [selectedModelId]
		return missingModelIds.concat(modelsIds).map((modelId) => ({
			value: modelId,
			label: providerModels[modelId]?.displayName ?? prettyModelName(modelId),
			type: DropdownOptionType.ITEM,
		}))
	}, [modelsIds, providerModels, selectedModelId])

	const disabled = isLoading || isError

	const onChange = (value: string) => {
		if (!currentApiConfigName) return
		if (apiConfiguration[modelIdKey] === value) return

		// Gate OCA models that require acknowledgement
		if (provider === "oca" && (providerModels as any)?.[value]?.banner) {
			setPendingModelId(value)
			setAckOpen(true)
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

	const onAcknowledge = () => {
		if (!currentApiConfigName || !pendingModelId) {
			setAckOpen(false)
			setPendingModelId(null)
			return
		}
		if (apiConfiguration[modelIdKey] === pendingModelId) {
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
		setAckOpen(false)
		setPendingModelId(null)
	}

	if (isLoading) {
		return null
	}

	if (isError || options.length <= 0) {
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
				contentClassName="max-h-[300px] overflow-y-auto"
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

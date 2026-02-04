import { useState, useCallback, useMemo } from "react"
import { useEvent } from "react-use"
import { LanguageModelChatSelector } from "vscode"

import type { ProviderSettings, ExtensionMessage, ModelInfo } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { ModelPicker } from "../ModelPicker"

type VSCodeLMProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const VSCodeLM = ({ apiConfiguration, setApiConfigurationField }: VSCodeLMProps) => {
	const { t } = useAppTranslation()

	const [vsCodeLmModels, setVsCodeLmModels] = useState<LanguageModelChatSelector[]>([])

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "vsCodeLmModels":
				{
					const newModels = message.vsCodeLmModels ?? []
					setVsCodeLmModels(newModels)
				}
				break
		}
	}, [])

	useEvent("message", onMessage)

	// Convert VSCode LM models array to Record format for ModelPicker
	const modelsRecord = useMemo((): Record<string, ModelInfo> => {
		return vsCodeLmModels.reduce(
			(acc, model) => {
				const modelId = `${model.vendor}/${model.family}`
				acc[modelId] = {
					maxTokens: 0,
					contextWindow: 0,
					supportsPromptCache: false,
					description: `${model.vendor} - ${model.family}`,
				}
				return acc
			},
			{} as Record<string, ModelInfo>,
		)
	}, [vsCodeLmModels])

	// Transform string model ID to { vendor, family } object for storage
	const valueTransform = useCallback((modelId: string) => {
		const [vendor, family] = modelId.split("/")
		return { vendor, family }
	}, [])

	// Transform stored { vendor, family } object back to display string
	const displayTransform = useCallback((value: unknown) => {
		if (!value) return ""
		const selector = value as { vendor?: string; family?: string }
		return selector.vendor && selector.family ? `${selector.vendor}/${selector.family}` : ""
	}, [])

	return (
		<>
			{vsCodeLmModels.length > 0 ? (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId=""
					models={modelsRecord}
					modelIdKey="vsCodeLmModelSelector"
					serviceName="VS Code LM"
					serviceUrl="https://code.visualstudio.com/api/extension-guides/language-model"
					valueTransform={valueTransform}
					displayTransform={displayTransform}
					hidePricing
				/>
			) : (
				<div>
					<label className="block font-medium mb-1">{t("settings:providers.vscodeLmModel")}</label>
					<div className="text-sm text-vscode-descriptionForeground">
						<p>{t("settings:providers.vscodeLmUnavailable")}</p>
						<p className="mt-2">{t("settings:providers.vscodeLmUnavailableInstructions")}</p>
					</div>
				</div>
			)}
			<div className="text-sm text-vscode-errorForeground">{t("settings:providers.vscodeLmWarning")}</div>
		</>
	)
}

import { useCallback, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"
import { openAiNativeModels, openAiNativeDefaultModelId, type OpenAiNativeModelId } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

type OpenAIProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

function isOpenAiNativeModelId(id: string): id is OpenAiNativeModelId {
	return id in openAiNativeModels
}

export const OpenAI = ({ apiConfiguration, setApiConfigurationField }: OpenAIProps) => {
	const { t } = useAppTranslation()

	const [openAiNativeBaseUrlSelected, setOpenAiNativeBaseUrlSelected] = useState(
		!!apiConfiguration?.openAiNativeBaseUrl,
	)

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	// Validate current modelId or fall back
	const maybeId = String(apiConfiguration.openAiNativeModelId ?? "")
	const modelId: OpenAiNativeModelId = isOpenAiNativeModelId(maybeId) ? maybeId : openAiNativeDefaultModelId

	const modelInfo = openAiNativeModels[modelId]
	const supportsServiceTier = !!modelInfo.supportsServiceTier

	const modelOptions = Object.keys(openAiNativeModels) as OpenAiNativeModelId[]

	// For OpenAI: only show Standard/Flex/Priority
	const serviceTierOptions = [
		{ value: "", label: t("settings:providers.serviceTierDefault") }, // maps to Default/Auto
		{ value: "standard", label: t("settings:providers.serviceTierStandard") },
		{ value: "flex", label: t("settings:providers.serviceTierFlex") },
		{ value: "priority", label: t("settings:providers.serviceTierPriority") },
	]

	return (
		<>
			{/* Model picker */}
			<VSCodeDropdown
				value={modelId}
				onChange={(e) =>
					setApiConfigurationField(
						"openAiNativeModelId",
						(e.target as HTMLSelectElement).value as OpenAiNativeModelId,
					)
				}
				className="w-full">
				{modelOptions.map((id) => (
					<VSCodeOption key={id} value={id}>
						{id}
					</VSCodeOption>
				))}
			</VSCodeDropdown>

			{/* Show service tier dropdown if model supports it */}
			{supportsServiceTier && (
				<VSCodeDropdown
					value={apiConfiguration.openAiNativeServiceTier ?? ""}
					onInput={handleInputChange("openAiNativeServiceTier") as any}
					className="w-full mt-2">
					<span slot="label" className="block font-medium mb-1">
						{t("settings:providers.serviceTier")}
					</span>
					{serviceTierOptions.map((opt) => (
						<VSCodeOption key={opt.value} value={opt.value}>
							{opt.label}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
			)}

			<Checkbox
				checked={openAiNativeBaseUrlSelected}
				onChange={(checked: boolean) => {
					setOpenAiNativeBaseUrlSelected(checked)

					if (!checked) {
						setApiConfigurationField("openAiNativeBaseUrl", "")
					}
				}}>
				{t("settings:providers.useCustomBaseUrl")}
			</Checkbox>
			{openAiNativeBaseUrlSelected && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.openAiNativeBaseUrl || ""}
						type="url"
						onInput={handleInputChange("openAiNativeBaseUrl")}
						placeholder="https://api.openai.com/v1"
						className="w-full mt-1"
					/>
				</>
			)}
			<VSCodeTextField
				value={apiConfiguration?.openAiNativeApiKey || ""}
				type="password"
				onInput={handleInputChange("openAiNativeApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.openAiApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.openAiNativeApiKey && (
				<VSCodeButtonLink href="https://platform.openai.com/api-keys" appearance="secondary">
					{t("settings:providers.getOpenAiApiKey")}
				</VSCodeButtonLink>
			)}
		</>
	)
}

import { mergeSiliconCloudModels } from "@/utils/model-utils"
import { useCallback, useMemo } from "react"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	siliconCloudApiLineSchema,
	siliconCloudApiLineConfigs,
	siliconCloudDefaultApiLine,
	siliconCloudDefaultModelId,
	siliconCloudModels,
	openAiModelInfoSaneDefaults,
} from "@roo-code/types"
import type { RouterModels } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"
import { SILICON_CLOUD_MODELS_BY_API_LINE } from "../constants"

type SiliconCloudProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const SiliconCloud = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
}: SiliconCloudProps) => {
	const { t } = useAppTranslation()

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

	// Get models based on API line - merge dynamic and static models like backend does
	const availableModels = useMemo(() => {
		const dynamicModels = routerModels?.siliconcloud ?? {}
		const apiLine = apiConfiguration.siliconCloudApiLine || siliconCloudDefaultApiLine
		const staticModels = SILICON_CLOUD_MODELS_BY_API_LINE[apiLine]
		return mergeSiliconCloudModels(dynamicModels, staticModels)
	}, [routerModels?.siliconcloud, apiConfiguration.siliconCloudApiLine])

	const isPresetModel = useMemo(() => {
		return apiConfiguration.apiModelId ? apiConfiguration.apiModelId in siliconCloudModels : false
	}, [apiConfiguration.apiModelId])

	return (
		<>
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.siliconcloud.entrypoint")}</label>
				<VSCodeDropdown
					value={apiConfiguration.siliconCloudApiLine || siliconCloudDefaultApiLine}
					onChange={handleInputChange("siliconCloudApiLine")}
					className="w-full">
					{siliconCloudApiLineSchema.options.map((apiLine) => {
						const config = siliconCloudApiLineConfigs[apiLine]
						return (
							<VSCodeOption key={apiLine} value={apiLine} className="p-2">
								{t(`settings:providers.siliconcloud.apiLineConfigs.${apiLine}`)} ({config.baseUrl})
							</VSCodeOption>
						)
					})}
				</VSCodeDropdown>
				<div className="text-xs text-vscode-descriptionForeground mt-1">
					{t("settings:providers.siliconcloud.entrypointDescription")}
				</div>
			</div>
			<VSCodeTextField
				value={apiConfiguration?.siliconCloudApiKey || ""}
				type="password"
				onInput={handleInputChange("siliconCloudApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.siliconcloud.apiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.siliconCloudApiKey && (
				<VSCodeButtonLink
					href={
						apiConfiguration.siliconCloudApiLine === "international"
							? "https://cloud.siliconflow.com/me/account/ak"
							: "https://cloud.siliconflow.cn/me/account/ak"
					}
					appearance="secondary">
					{t("settings:providers.siliconcloud.getApiKey")}
				</VSCodeButtonLink>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={siliconCloudDefaultModelId}
				models={availableModels}
				modelIdKey="apiModelId"
				serviceName="SiliconCloud"
				serviceUrl={
					apiConfiguration.siliconCloudApiLine === "international"
						? "https://siliconflow.com/"
						: "https://siliconflow.cn/"
				}
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
			{!isPresetModel && (
				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.siliconCloudCustomModelInfo?.contextWindow?.toString() ||
							openAiModelInfoSaneDefaults.contextWindow?.toString() ||
							""
						}
						type="text"
						onInput={handleInputChange("siliconCloudCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseInt(value)

							return {
								...(apiConfiguration?.siliconCloudCustomModelInfo || openAiModelInfoSaneDefaults),
								contextWindow: isNaN(parsed) ? openAiModelInfoSaneDefaults.contextWindow : parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.contextWindow")}
						className="w-full">
						<label className="block font-medium mb-1">
							{t("settings:providers.customModel.contextWindow.label")}
						</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customModel.contextWindow.description")}
					</div>
				</div>
			)}
		</>
	)
}

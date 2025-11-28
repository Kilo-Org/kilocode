// kilocode_change - new file
import { useCallback } from "react"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, nanoGptDefaultModelId, nanoGptModelListSchema } from "@roo-code/types"
import type { RouterModels } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

type NanoGptProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	organizationAllowList: any
	modelValidationError?: string
}

export const NanoGpt = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
}: NanoGptProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(field: K) =>
			(event: E | Event) => {
				setApiConfigurationField(field, inputEventTransform(event as E))
			},
		[setApiConfigurationField],
	)

	const handleDropdownChange = useCallback(
		(field: keyof ProviderSettings) => (event: any) => {
			setApiConfigurationField(field, event.target.value)
		},
		[setApiConfigurationField],
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.nanoGptApiKey || ""}
				type="password"
				onInput={handleInputChange("nanoGptApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.nanoGptApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.nanoGptApiKey && (
				<VSCodeButtonLink href="https://nano-gpt.com/" style={{ width: "100%" }} appearance="primary">
					{t("settings:providers.getNanoGptApiKey")}
				</VSCodeButtonLink>
			)}
			<div>
				<label htmlFor="nanoGptModelList" className="block font-medium mb-1">
					{t("settings:providers.nanoGptModelList")}
				</label>
				<VSCodeDropdown
					id="nanoGptModelList"
					value={apiConfiguration.nanoGptModelList || "all"}
					onChange={handleDropdownChange("nanoGptModelList")}
					className="w-full">
					{nanoGptModelListSchema.options.map((option) => (
						<VSCodeOption key={option} value={option}>
							{t(`settings:providers.nanoGptModelListOptions.${option}`)}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
				<div className="text-sm text-vscode-descriptionForeground mt-1">
					💡 Click &quot;Save&quot; to refresh the model list after changing this selection
				</div>
			</div>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={nanoGptDefaultModelId}
				models={routerModels?.["nano-gpt"] ?? {}}
				modelIdKey="nanoGptModelId"
				serviceName="Nano-GPT"
				serviceUrl="https://nano-gpt.com/docs/api-reference/endpoint/models"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}

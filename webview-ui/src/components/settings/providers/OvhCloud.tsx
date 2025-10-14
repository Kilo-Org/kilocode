import { useCallback, useState } from "react"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { OrganizationAllowList, ovhCloudAiEndpointsDefaultModelId, type ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"
import { RouterModels } from "@roo/api"

type OvhCloudAiEndpointsProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const OvhCloudAiEndpoints = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
}: OvhCloudAiEndpointsProps) => {
	const { t } = useAppTranslation()
	const [customUrlEnabled, setCustomUrlEnabled] = useState(!!apiConfiguration?.ovhCloudAiEndpointsBaseUrl)

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

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.ovhCloudAiEndpointsApiKey || ""}
				type="password"
				onInput={handleInputChange("ovhCloudAiEndpointsApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.ovhCloudAiEndpointsApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.ovhCloudAiEndpointsApiKey && (
				<VSCodeButtonLink href="https://www.ovh.com/manager" appearance="secondary">
					{t("settings:providers.getOvhCloudAiEndpointsApiKey")}
				</VSCodeButtonLink>
			)}

			<VSCodeCheckbox
				checked={customUrlEnabled}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					if (!isChecked) {
						setApiConfigurationField("ovhCloudAiEndpointsBaseUrl", undefined)
					}

					setCustomUrlEnabled(isChecked)
				}}>
				{t("settings:providers.getOvhCloudAiEndpointsBaseUrl")}
			</VSCodeCheckbox>
			{customUrlEnabled && (
				<VSCodeTextField
					value={apiConfiguration?.ovhCloudAiEndpointsBaseUrl || ""}
					type="text"
					onInput={handleInputChange("ovhCloudAiEndpointsBaseUrl")}
					placeholder={t("settings:providers.getOvhCloudAiEndpointsBaseUrl")}
					className="w-full">
					<div className="flex justify-between items-center mb-1">
						<label className="block font-medium">
							{t("settings:providers.ovhCloudAiEndpointsBaseUrl")}
						</label>
					</div>
				</VSCodeTextField>
			)}

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={ovhCloudAiEndpointsDefaultModelId}
				models={routerModels?.ovhcloud ?? {}}
				modelIdKey="ovhCloudAiEndpointsModelId"
				serviceName="OVHcloud AI Endpoints"
				serviceUrl="https://endpoints.ai.cloud.ovh.net/catalog"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}

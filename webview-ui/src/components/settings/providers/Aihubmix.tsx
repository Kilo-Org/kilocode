// kilocode_change - new file
import { useCallback, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, type RouterModels, aihubmixDefaultModelId } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

import { ModelPicker } from "../ModelPicker"
import type { OrganizationAllowList } from "@roo-code/types"

type AihubmixProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	simplifySettings?: boolean
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const Aihubmix = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	simplifySettings,
	organizationAllowList,
	modelValidationError,
}: AihubmixProps) => {
	const { t } = useAppTranslation()

	const [baseUrlSelected, setBaseUrlSelected] = useState(!!apiConfiguration?.aihubmixBaseUrl)

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
				value={apiConfiguration?.aihubmixApiKey || ""}
				type="password"
				onInput={handleInputChange("aihubmixApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.aihubmixApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			{!apiConfiguration?.aihubmixApiKey && (
				<VSCodeButtonLink href="https://console.aihubmix.com/token" appearance="secondary">
					{t("settings:providers.getAihubmixApiKey")}
				</VSCodeButtonLink>
			)}

			{!simplifySettings && (
				<div>
					<Checkbox
						checked={baseUrlSelected}
						onChange={(checked: boolean) => {
							setBaseUrlSelected(checked)

							if (!checked) {
								setApiConfigurationField("aihubmixBaseUrl", "")
							}
						}}>
						{t("settings:providers.useCustomBaseUrl")}
					</Checkbox>
					{baseUrlSelected && (
						<VSCodeTextField
							value={apiConfiguration?.aihubmixBaseUrl || ""}
							type="url"
							onInput={handleInputChange("aihubmixBaseUrl")}
							placeholder="Default: https://aihubmix.com"
							className="w-full mt-1"
						/>
					)}
				</div>
			)}

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={aihubmixDefaultModelId}
				models={routerModels?.aihubmix ?? {}}
				modelIdKey="aihubmixModelId"
				serviceName="AIhubmix"
				serviceUrl="https://aihubmix.com/models"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>
		</>
	)
}

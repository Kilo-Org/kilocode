// kilocode_change - new file
import { useCallback, useState } from "react"
import { Trans } from "react-i18next"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, type OrganizationAllowList, zenmuxDefaultModelId } from "@roo-code/types"

import type { RouterModels } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform, noTransform } from "../transforms"

import { ModelPicker } from "../ModelPicker"

type ZenMuxProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	selectedModelId: string
	uriScheme: string | undefined
	simplifySettings?: boolean
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const ZenMux = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	uriScheme: _uriScheme,
	simplifySettings,
	organizationAllowList,
	modelValidationError,
}: ZenMuxProps) => {
	const { t } = useAppTranslation()

	const [zenmuxBaseUrlSelected, setZenmuxBaseUrlSelected] = useState(!!apiConfiguration?.zenmuxBaseUrl)

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
				value={apiConfiguration?.zenmuxApiKey || ""}
				type="password"
				onInput={handleInputChange("zenmuxApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<div className="flex justify-between items-center mb-1">
					<label className="block font-medium">{t("settings:providers.zenmuxApiKey")}</label>
				</div>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.zenmuxApiKey && (
				<VSCodeButtonLink href="https://zenmux.ai/settings/keys" style={{ width: "100%" }} appearance="primary">
					{t("settings:providers.getZenmuxApiKey")}
				</VSCodeButtonLink>
			)}
			{!simplifySettings && (
				<>
					<div>
						<Checkbox
							checked={zenmuxBaseUrlSelected}
							onChange={(checked: boolean) => {
								setZenmuxBaseUrlSelected(checked)

								if (!checked) {
									setApiConfigurationField("zenmuxBaseUrl", "")
								}
							}}>
							{t("settings:providers.useCustomBaseUrl")}
						</Checkbox>
						{zenmuxBaseUrlSelected && (
							<VSCodeTextField
								value={apiConfiguration?.zenmuxBaseUrl || ""}
								type="url"
								onInput={handleInputChange("zenmuxBaseUrl")}
								placeholder="Default: https://zenmux.ai/api/v1"
								className="w-full mt-1"
							/>
						)}
					</div>
					<Checkbox
						checked={apiConfiguration?.zenmuxUseMiddleOutTransform ?? true}
						onChange={handleInputChange("zenmuxUseMiddleOutTransform", noTransform)}>
						<Trans
							i18nKey="settings:providers.zenmuxTransformsText"
							components={{
								a: <a href="https://zenmux.ai/docs/transforms" />,
							}}
						/>
					</Checkbox>
				</>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={zenmuxDefaultModelId}
				modelIdKey="zenmuxModelId"
				models={routerModels?.zenmux ?? {}}
				serviceName="zenmux"
				serviceUrl="https://zenmux.ai/api/v1/models"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>
		</>
	)
}

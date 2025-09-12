import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, submodelDefaultModelId } from "@roo-code/types"

import type { OrganizationAllowList } from "@roo/cloud"
import type { RouterModels } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type SubmodelProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (
		field: keyof ProviderSettings,
		value: ProviderSettings[keyof ProviderSettings],
		isUserAction?: boolean,
	) => void
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const Submodel = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
}: SubmodelProps) => {
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

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.submodelApiKey || ""}
				type="password"
				onInput={handleInputChange("submodelApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.submodelApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.submodelApiKey && (
				<VSCodeButtonLink href="https://submodel.ai/#/account/others?tab=llm_token" appearance="primary">
					{t("settings:providers.getSubmodelApiKey")}
				</VSCodeButtonLink>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={submodelDefaultModelId}
				models={routerModels?.submodel ?? {}}
				modelIdKey="submodelModelId"
				serviceName="Submodel"
				serviceUrl="https://submodel.ai"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}

import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

// kilocode_change start
import { type ProviderSettings, type OrganizationAllowList, chutesDefaultModelId } from "@roo-code/types"
import type { RouterModels } from "@roo/api"
import { ModelPicker } from "../ModelPicker"
// kilocode_change end

type ChutesProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	// kilocode_change start
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	// kilocode_change end
}

export const Chutes = ({
	apiConfiguration,
	setApiConfigurationField,
	// kilocode_change start
	routerModels,
	organizationAllowList,
	modelValidationError,
	// kilocode_change end
}: ChutesProps) => {
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
				value={apiConfiguration?.chutesApiKey || ""}
				type="password"
				onInput={handleInputChange("chutesApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.chutesApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.chutesApiKey && (
				<VSCodeButtonLink href="https://chutes.ai/app/api" appearance="secondary">
					{t("settings:providers.getChutesApiKey")}
				</VSCodeButtonLink>
			)}
			{
				// kilocode_change start
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId={chutesDefaultModelId}
					models={routerModels?.chutes ?? {}}
					modelIdKey="apiModelId"
					serviceName="Chutes.AI"
					serviceUrl="https://chutes.ai"
					organizationAllowList={organizationAllowList}
					errorMessage={modelValidationError}
				/>
				// kilocode_change end
			}
		</>
	)
}

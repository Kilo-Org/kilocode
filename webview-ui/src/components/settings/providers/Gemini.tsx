import { useCallback, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type {
	OrganizationAllowList, // kilocode_change
	ProviderSettings,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

// kilocode_change start
import { geminiDefaultModelId } from "@roo-code/types"
import type { RouterModels } from "@roo/api"
import { ModelPicker } from "../ModelPicker"
// kilocode_change end

type GeminiProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	fromWelcomeView?: boolean
	// kilocode_change start
	routerModels?: RouterModels
	organizationAllowList?: OrganizationAllowList
	modelValidationError?: string
	// kilocode_change end
	simplifySettings?: boolean
}

export const Gemini = ({
	apiConfiguration,
	setApiConfigurationField,
	simplifySettings,
	// kilocode_change start
	routerModels,
	organizationAllowList,
	modelValidationError,
	// kilocode_change end
}: GeminiProps) => {
	const { t } = useAppTranslation()

	const [googleGeminiBaseUrlSelected, setGoogleGeminiBaseUrlSelected] = useState(
		!!apiConfiguration?.googleGeminiBaseUrl,
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

	const allowList = organizationAllowList ?? { allowAll: true, providers: {} } // kilocode_change

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.geminiApiKey || ""}
				type="password"
				onInput={handleInputChange("geminiApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.geminiApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.geminiApiKey && (
				<VSCodeButtonLink href="https://ai.google.dev/" appearance="secondary">
					{t("settings:providers.getGeminiApiKey")}
				</VSCodeButtonLink>
			)}

			<div>
				<Checkbox
					data-testid="checkbox-custom-base-url"
					checked={googleGeminiBaseUrlSelected}
					onChange={(checked: boolean) => {
						setGoogleGeminiBaseUrlSelected(checked)
						if (!checked) {
							setApiConfigurationField("googleGeminiBaseUrl", "")
						}
					}}>
					{t("settings:providers.useCustomBaseUrl")}
				</Checkbox>
				{googleGeminiBaseUrlSelected && (
					<VSCodeTextField
						value={apiConfiguration?.googleGeminiBaseUrl || ""}
						type="url"
						onInput={handleInputChange("googleGeminiBaseUrl")}
						placeholder={t("settings:defaults.geminiUrl")}
						className="w-full mt-1"
					/>
				)}

				{!simplifySettings && (
					<>
						<Checkbox
							className="mt-6"
							data-testid="checkbox-url-context"
							checked={!!apiConfiguration.enableUrlContext}
							onChange={(checked: boolean) => setApiConfigurationField("enableUrlContext", checked)}>
							{t("settings:providers.geminiParameters.urlContext.title")}
						</Checkbox>
						<div className="text-sm text-vscode-descriptionForeground mb-3 mt-1.5">
							{t("settings:providers.geminiParameters.urlContext.description")}
						</div>

						<Checkbox
							data-testid="checkbox-grounding-search"
							checked={!!apiConfiguration.enableGrounding}
							onChange={(checked: boolean) => setApiConfigurationField("enableGrounding", checked)}>
							{t("settings:providers.geminiParameters.groundingSearch.title")}
						</Checkbox>
						<div className="text-sm text-vscode-descriptionForeground mb-3 mt-1.5">
							{t("settings:providers.geminiParameters.groundingSearch.description")}
						</div>
					</>
				)}

				{/* kilocode_change: ModelPicker added */}
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId={geminiDefaultModelId}
					models={routerModels?.gemini ?? {}}
					modelIdKey="apiModelId"
					serviceName="Google Gemini"
					serviceUrl="https://ai.google.dev/gemini-api/docs/models/gemini"
					organizationAllowList={allowList}
					errorMessage={modelValidationError}
				/>
			</div>
		</>
	)
}

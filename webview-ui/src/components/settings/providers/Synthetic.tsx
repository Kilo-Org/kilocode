// kilocode_change - provider added

import { useCallback, useState } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Checkbox } from "vscrui"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

import { type ProviderSettings, type OrganizationAllowList, syntheticDefaultModelId } from "@roo-code/types"
import type { RouterModels } from "@roo/api"
import { ModelPicker } from "../ModelPicker"

// Default max output tokens for Synthetic provider
const SYNTHETIC_DEFAULT_MAX_TOKENS = 8192

type SyntheticProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const Synthetic = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
}: SyntheticProps) => {
	const { t } = useAppTranslation()

	// Limit max tokens is enabled by default (true) with default value of 8192
	const limitMaxTokensEnabled = apiConfiguration?.includeMaxTokens ?? true

	const [syntheticBaseUrlSelected, setSyntheticBaseUrlSelected] = useState(!!apiConfiguration?.syntheticBaseUrl)

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
				value={apiConfiguration?.syntheticApiKey || ""}
				type="password"
				onInput={handleInputChange("syntheticApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.syntheticApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.syntheticApiKey && (
				<VSCodeButtonLink href="https://synthetic.new/" appearance="secondary">
					{t("settings:providers.getSyntheticApiKey")}
				</VSCodeButtonLink>
			)}
			<div>
				<Checkbox
					checked={syntheticBaseUrlSelected}
					onChange={(checked: boolean) => {
						setSyntheticBaseUrlSelected(checked)

						if (!checked) {
							setApiConfigurationField("syntheticBaseUrl", "")
						}
					}}>
					{t("settings:providers.useCustomBaseUrl")}
				</Checkbox>
				{syntheticBaseUrlSelected && (
					<VSCodeTextField
						value={apiConfiguration?.syntheticBaseUrl || ""}
						type="url"
						onInput={handleInputChange("syntheticBaseUrl")}
						placeholder="Default: https://api.synthetic.new/openai/v1"
						className="w-full mt-1"
					/>
				)}
			</div>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={syntheticDefaultModelId}
				models={routerModels?.synthetic ?? {}}
				modelIdKey="apiModelId"
				serviceName="Synthetic"
				serviceUrl="https://synthetic.new/"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>

			{/* Max Output Tokens Settings */}
			<div>
				<Checkbox
					checked={limitMaxTokensEnabled}
					onChange={(checked: boolean) => {
						setApiConfigurationField("includeMaxTokens", checked)
						if (checked && !apiConfiguration?.modelMaxTokens) {
							// Set default value when enabling
							setApiConfigurationField("modelMaxTokens", SYNTHETIC_DEFAULT_MAX_TOKENS)
						}
					}}>
					{t("settings:limitMaxTokensDescription")}
				</Checkbox>
				{limitMaxTokensEnabled && (
					<div className="mt-2 ml-6">
						<VSCodeTextField
							value={(apiConfiguration?.modelMaxTokens ?? SYNTHETIC_DEFAULT_MAX_TOKENS).toString()}
							type="text"
							style={{
								borderColor: (() => {
									const value = apiConfiguration?.modelMaxTokens ?? SYNTHETIC_DEFAULT_MAX_TOKENS
									return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
								})(),
							}}
							onInput={(e: any) => {
								const value = parseInt(e.target.value)
								setApiConfigurationField(
									"modelMaxTokens",
									isNaN(value) ? SYNTHETIC_DEFAULT_MAX_TOKENS : value,
								)
							}}
							placeholder={t("settings:placeholders.numbers.maxTokens")}
							className="w-full">
							<label className="block font-medium mb-1">{t("settings:maxOutputTokensLabel")}</label>
						</VSCodeTextField>
						<div className="text-sm text-vscode-descriptionForeground">
							{t("settings:maxTokensGenerateDescription")}
						</div>
					</div>
				)}
			</div>
		</>
	)
}

import { useCallback, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"

import { inputEventTransform } from "../transforms"

type ClaudeCodeNativeProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
}

export const ClaudeCodeNative = ({ apiConfiguration, setApiConfigurationField }: ClaudeCodeNativeProps) => {
	const { t } = useAppTranslation()
	const selectedModel = useSelectedModel(apiConfiguration)

	const [anthropicBaseUrlSelected, setAnthropicBaseUrlSelected] = useState(!!apiConfiguration?.anthropicBaseUrl)

	// Check if the current model supports 1M context beta
	const supports1MContextBeta = selectedModel?.id === "claude-sonnet-4-5"

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
				value={apiConfiguration?.apiKey || ""}
				type="password"
				onInput={handleInputChange("apiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.claudeCode.LongLivedToken")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			<div>
				<Checkbox
					checked={anthropicBaseUrlSelected}
					onChange={(checked: boolean) => {
						setAnthropicBaseUrlSelected(checked)

						if (!checked) {
							setApiConfigurationField("anthropicBaseUrl", "")
						}
					}}>
					{t("settings:providers.useCustomBaseUrl")}
				</Checkbox>
				{anthropicBaseUrlSelected && (
					<VSCodeTextField
						value={apiConfiguration?.anthropicBaseUrl || ""}
						type="url"
						onInput={handleInputChange("anthropicBaseUrl")}
						placeholder="https://api.anthropic.com"
						className="w-full mt-1"
					/>
				)}
			</div>
			{supports1MContextBeta && (
				<div className="mt-2">
					<Checkbox
						checked={apiConfiguration?.anthropicBeta1MContext ?? false}
						onChange={(checked: boolean) => {
							setApiConfigurationField("anthropicBeta1MContext", checked)
						}}>
						{t("settings:providers.anthropic1MContextBetaLabel")}
					</Checkbox>
					<div className="text-sm text-vscode-descriptionForeground mt-1 ml-6">
						{t("settings:providers.anthropic1MContextBetaDescription")}
					</div>
				</div>
			)}
		</>
	)
}

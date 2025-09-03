// kilocode_change -- file added

import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { inputEventTransform } from "../transforms"

type QwenCodeProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const QwenCode = ({ apiConfiguration, setApiConfigurationField }: QwenCodeProps) => {
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
				value={apiConfiguration?.qwenCodeOAuthPath || ""}
				onInput={handleInputChange("qwenCodeOAuthPath")}
				placeholder="~/.qwen/oauth_creds.json"
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.qwenCode.oauthPath")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.qwenCode.oauthPathDescription")}
			</div>

			<div className="text-sm text-vscode-descriptionForeground mt-3">
				{t("settings:providers.qwenCode.description")}
			</div>

			<div className="text-sm text-vscode-descriptionForeground mt-2">
				{t("settings:providers.qwenCode.instructions")}
			</div>

			<VSCodeLink
				href="https://github.com/QwenLM/qwen-code/blob/main/README.md"
				className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground mt-2 inline-block">
				{t("settings:providers.qwenCode.setupLink")}
			</VSCodeLink>
		</>
	)
}

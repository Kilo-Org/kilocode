// kilocode_change start
import React from "react"
import { VSCodeTextField, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { type ProviderSettings } from "@roo-code/types"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { inputEventTransform } from "../transforms"

interface CerebrasProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
}

export const Cerebras = ({ apiConfiguration, setApiConfigurationField }: CerebrasProps) => {
	const { t } = useAppTranslation()

	const handleInputChange =
		<K extends keyof typeof apiConfiguration, E>(field: K, transform: (event: E) => (typeof apiConfiguration)[K]) =>
		(event: E | Event) => {
			setApiConfigurationField(field, transform(event as E))
		}

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.cerebrasApiKey || ""}
				style={{ width: "100%" }}
				type="password"
				onInput={handleInputChange("cerebrasApiKey", inputEventTransform)}
				placeholder={t("settings:providers.apiKeyPlaceholder")}>
				<span style={{ fontWeight: 500 }}>{t("settings:providers.cerebras.apiKey")}</span>
			</VSCodeTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("settings:providers.apiKeyStorageNotice")}
				{!apiConfiguration?.cerebrasApiKey && (
					<>
						<br />
						<br />
						<VSCodeLink
							href="https://cloud.cerebras.ai/"
							style={{
								display: "inline",
								fontSize: "inherit",
							}}>
							{t("settings:providers.cerebras.getApiKey")}
						</VSCodeLink>
					</>
				)}
			</p>
		</div>
	)
}
// kilocode_change end

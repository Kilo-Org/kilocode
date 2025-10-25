import { useCallback } from "react"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { cn } from "@/lib/utils"

type MiniMaxProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const MiniMax = ({ apiConfiguration, setApiConfigurationField }: MiniMaxProps) => {
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
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.minimaxBaseUrl")}</label>
				<VSCodeDropdown
					value={apiConfiguration.minimaxBaseUrl}
					onChange={handleInputChange("minimaxBaseUrl")}
					className={cn("w-full")}>
					<VSCodeOption value="https://api.minimax.io/v1" className="p-2">
						api.minimax.io
					</VSCodeOption>
					<VSCodeOption value="https://api.minimaxi.com/v1" className="p-2">
						api.minimaxi.com
					</VSCodeOption>
				</VSCodeDropdown>
			</div>
			<div>
				<VSCodeTextField
					value={apiConfiguration?.minimaxApiKey || ""}
					type="password"
					onInput={handleInputChange("minimaxApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
					className="w-full">
					<label className="block font-medium mb-1">{t("settings:providers.minimaxApiKey")}</label>
				</VSCodeTextField>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.apiKeyStorageNotice")}
				</div>
				{!apiConfiguration?.minimaxApiKey && (
					<VSCodeButtonLink
						href={
							apiConfiguration.minimaxBaseUrl === "https://api.minimaxi.com/v1"
								? "https://platform.minimaxi.com/user-center/basic-information/interface-key"
								: "https://www.minimax.io/platform/user-center/basic-information/interface-key"
						}
						appearance="secondary">
						{t("settings:providers.getMiniMaxApiKey")}
					</VSCodeButtonLink>
				)}
			</div>
		</>
	)
}

// kilocode_change: Morph fast apply - file added

import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ProviderSettings } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"

export const MorphSettings = ({
	apiConfiguration,
	setApiConfigurationField,
}: {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
}) => {
	const { t } = useAppTranslation()
	return (
		<div>
			<VSCodeTextField
				type="password"
				value={apiConfiguration?.morphApiKey || ""}
				placeholder={t("settings:experimental.MORPH_FAST_APPLY.placeholder")}
				onChange={(e) => setApiConfigurationField("morphApiKey", (e.target as any)?.value || "")}
				className="w-full">
				{t("settings:experimental.MORPH_FAST_APPLY.apiKey")}
			</VSCodeTextField>
			<div className="text-xs px-1 py-1 mt-2 flex gap-2">
				<span className="codicon codicon-warning" />
				<span>{t("settings:experimental.MORPH_FAST_APPLY.warning")}</span>
			</div>
		</div>
	)
}

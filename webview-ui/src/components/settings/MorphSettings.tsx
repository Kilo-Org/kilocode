// kilocode_change: Morph fast apply - global settings version

import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SetCachedStateField } from "./types"

export const MorphSettings = ({
	morphApiKey,
	setCachedStateField,
}: {
	morphApiKey?: string
	setCachedStateField: SetCachedStateField<"morphApiKey">
}) => {
	const { t } = useAppTranslation()
	return (
		<div>
			<VSCodeTextField
				type="password"
				value={morphApiKey || ""}
				placeholder={t("settings:experimental.MORPH_FAST_APPLY.placeholder")}
				onChange={(e) => setCachedStateField("morphApiKey", (e.target as any)?.value || "")}
				className="w-full">
				{t("settings:experimental.MORPH_FAST_APPLY.apiKey")}
			</VSCodeTextField>
		</div>
	)
}

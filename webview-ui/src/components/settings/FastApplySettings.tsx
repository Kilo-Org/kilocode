// kilocode_change: Fast Apply - global settings version
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SetCachedStateField } from "./types"

export const FastApplySettings = ({
	morphApiKey,
	fastApplyModel,
	setCachedStateField,
}: {
	morphApiKey?: string
	fastApplyModel?: string
	setCachedStateField: SetCachedStateField<"morphApiKey" | "fastApplyModel">
}) => {
	const { t } = useAppTranslation()
	return (
		<div className="flex flex-col gap-2">
			<div>
				<label className="text-xs text-vscode-descriptionForeground mb-1 block">
					{t("settings:experimental.MORPH_FAST_APPLY.modelLabel")}
				</label>
				<VSCodeDropdown
					value={fastApplyModel || "auto"}
					onChange={(e) => setCachedStateField("fastApplyModel", (e.target as any)?.value || "auto")}
					className="w-full">
					<VSCodeOption value="auto">{t("settings:experimental.MORPH_FAST_APPLY.models.auto")}</VSCodeOption>
					<VSCodeOption value="morph/morph-v3-fast">
						{t("settings:experimental.MORPH_FAST_APPLY.models.morphFast")}
					</VSCodeOption>
					<VSCodeOption value="morph/morph-v3-large">
						{t("settings:experimental.MORPH_FAST_APPLY.models.morphLarge")}
					</VSCodeOption>
					<VSCodeOption value="relace/relace-apply-3">
						{t("settings:experimental.MORPH_FAST_APPLY.models.relace")}
					</VSCodeOption>
				</VSCodeDropdown>
				<p className="text-xs text-vscode-descriptionForeground mt-1">
					{t("settings:experimental.MORPH_FAST_APPLY.modelDescription")}
				</p>
			</div>

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

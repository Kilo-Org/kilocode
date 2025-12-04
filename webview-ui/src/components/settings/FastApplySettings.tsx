// kilocode_change: Fast Apply - global settings version
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SetCachedStateField } from "./types"

export const FastApplySettings = ({
	morphApiKey,
	fastApplyModel,
	fastApplyApiProvider,
	setCachedStateField,
}: {
	morphApiKey?: string
	fastApplyModel?: string
	fastApplyApiProvider?: string
	setCachedStateField: SetCachedStateField<"morphApiKey" | "fastApplyModel" | "fastApplyApiProvider">
}) => {
	const { t } = useAppTranslation()
	return (
		<div className="flex flex-col gap-2">
			<div>
				<label className="text-xs text-vscode-descriptionForeground mb-1 block">
					{t("settings:experimental.MORPH_FAST_APPLY.apiProvider")}
				</label>
				<VSCodeDropdown
					value={fastApplyApiProvider || "current"}
					onChange={(e: any) =>
						setCachedStateField("fastApplyApiProvider", (e.target as any)?.value || "current")
					}
					className="w-full">
					<VSCodeOption className="py-2 px-3" value="kilocode">
						Kilo Code
					</VSCodeOption>
					<VSCodeOption className="py-2 px-3" value="openrouter">
						OpenRouter
					</VSCodeOption>
					<VSCodeOption className="py-2 px-3" value="morph">
						Morph
					</VSCodeOption>
					<VSCodeOption className="py-2 px-3" value="current">
						{t("settings:experimental.MORPH_FAST_APPLY.apiProviderList.current")}
					</VSCodeOption>
				</VSCodeDropdown>
			</div>
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

			{fastApplyApiProvider !== "current" && (
				<VSCodeTextField
					type="password"
					value={morphApiKey || ""}
					placeholder={t("settings:experimental.MORPH_FAST_APPLY.placeholder")}
					onChange={(e) => setCachedStateField("morphApiKey", (e.target as any)?.value || "")}
					className="w-full">
					{t("settings:experimental.MORPH_FAST_APPLY.apiKey")}
				</VSCodeTextField>
			)}
		</div>
	)
}

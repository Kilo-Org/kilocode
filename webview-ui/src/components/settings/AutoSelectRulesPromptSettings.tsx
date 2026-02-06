// kilocode_change - new file
import React from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"

const AutoSelectRulesPromptSettings = () => {
	const { t } = useAppTranslation()
	const { listApiConfigMeta, autoSelectRulesApiConfigId, setAutoSelectRulesApiConfigId } = useExtensionState()

	return (
		<div className="mt-4 flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
			<div>
				<label className="block font-medium mb-1">{t("prompts:supportPrompts.enhance.apiConfiguration")}</label>
				<Select
					value={autoSelectRulesApiConfigId || "-"}
					onValueChange={(value) => {
						setAutoSelectRulesApiConfigId(value === "-" ? "" : value)
						vscode.postMessage({
							type: "autoSelectRulesApiConfigId",
							text: value,
						})
					}}>
					<SelectTrigger data-testid="auto-select-rules-api-config-select" className="w-full">
						<SelectValue placeholder={t("prompts:supportPrompts.enhance.useCurrentConfig")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="-">{t("prompts:supportPrompts.enhance.useCurrentConfig")}</SelectItem>
						{(listApiConfigMeta || []).map((config) => (
							<SelectItem
								key={config.id}
								value={config.id}
								data-testid={`auto-select-rules-${config.id}-option`}>
								{config.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div className="text-sm text-vscode-descriptionForeground mt-1">
					{t("prompts:supportPrompts.autoSelectRules.apiConfigDescription")}
				</div>
			</div>
		</div>
	)
}

export default AutoSelectRulesPromptSettings

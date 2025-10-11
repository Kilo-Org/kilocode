import React, { useCallback } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

interface ToolCallSettingsControlProps {
	toolCallEnabled?: boolean
	onChange: (field: "toolCallEnabled", value: any) => void
}

export const ToolCallSettingsControl: React.FC<ToolCallSettingsControlProps> = ({
	toolCallEnabled = false,
	onChange,
}) => {
	const { t } = useAppTranslation()

	const handleToolCallEnabledChange = useCallback(
		(e: any) => {
			onChange("toolCallEnabled", e.target.checked)
		},
		[onChange],
	)

	return (
		<div className="flex flex-col gap-1">
			<div>
				<VSCodeCheckbox checked={toolCallEnabled} onChange={handleToolCallEnabledChange}>
					<span className="font-medium">{t("settings:advanced.toolCall.label")}</span>
				</VSCodeCheckbox>
				<div className="text-vscode-descriptionForeground text-sm">
					{t("settings:advanced.toolCall.description")}
				</div>
			</div>
		</div>
	)
}

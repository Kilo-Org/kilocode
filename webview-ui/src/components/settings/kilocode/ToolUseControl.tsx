import React, { useCallback } from "react"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { ToolUseStyle, toolUseStylesSchema } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ToolUseControlProps {
	toolStyle?: ToolUseStyle
	onChange: (field: "toolStyle", value?: ToolUseStyle) => void
}

export const ToolUseControl: React.FC<ToolUseControlProps> = ({ toolStyle, onChange }) => {
	const handleToolStyleChange = useCallback(
		(e: any) => {
			const value = toolUseStylesSchema.safeParse(e.target.value).data
			onChange("toolStyle", value)
		},
		[onChange],
	)
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-1">
			<div>
				<label className="block font-medium mb-1">{t("kilocode:toolCallStyle.title")}</label>
				<VSCodeDropdown value={toolStyle} onChange={handleToolStyleChange} className="w-full">
					<VSCodeOption value="">(default)</VSCodeOption>
					<VSCodeOption value={toolUseStylesSchema.Enum.xml}>XML</VSCodeOption>
					<VSCodeOption value={toolUseStylesSchema.Enum.json}>JSON (experimental)</VSCodeOption>
				</VSCodeDropdown>
				<div className="text-vscode-descriptionForeground text-sm mt-1">
					{t("kilocode:toolCallStyle.description")}
				</div>
			</div>
		</div>
	)
}

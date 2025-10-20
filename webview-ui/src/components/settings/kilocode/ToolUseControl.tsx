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

	const codeOptionClassName = "py-2 px-3"

	return (
		<div className="flex flex-col gap-1">
			<div>
				<label className="block font-medium mb-1">{t("kilocode:toolCallStyle.title")}</label>
				<VSCodeDropdown value={toolStyle} onChange={handleToolStyleChange} className="w-full">
					<VSCodeOption className={codeOptionClassName} value="">
						{t("kilocode:toolCallStyle.automatic")}
					</VSCodeOption>
					<VSCodeOption className={codeOptionClassName} value={toolUseStylesSchema.Enum.xml}>
						{t("kilocode:toolCallStyle.xml")}
					</VSCodeOption>
					<VSCodeOption className={codeOptionClassName} value={toolUseStylesSchema.Enum.json}>
						{t("kilocode:toolCallStyle.json")}
					</VSCodeOption>
				</VSCodeDropdown>
				<div className="text-vscode-descriptionForeground text-sm mt-1">
					{t("kilocode:toolCallStyle.description")}
				</div>
			</div>
		</div>
	)
}

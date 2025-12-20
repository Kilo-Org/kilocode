import React from "react"
import { VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { CODEBASE_INDEX_DEFAULTS } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { StandardTooltip } from "@src/components/ui"
import { cn } from "@src/lib/utils"

interface ParserMinChunkSizeInputProps {
	value: number | undefined
	onChange: (value: number) => void
	error?: string
}

export const ParserMinChunkSizeInput: React.FC<ParserMinChunkSizeInputProps> = ({ value, onChange, error }) => {
	const { t } = useAppTranslation()

	const currentValue = value ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_PARSER_MIN_CHUNK_SIZE

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<label className="text-sm font-medium">
					{t("kilocode:settings.codeIndex.parserMinChunkSizeLabel")}
				</label>
				<StandardTooltip content={t("kilocode:settings.codeIndex.parserMinChunkSizeDescription")}>
					<span className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help" />
				</StandardTooltip>
			</div>
			<div className="flex items-center gap-2">
				<VSCodeTextField
					value={currentValue.toString()}
					onInput={(e: any) => {
						const val = parseInt(e.target.value, 10)
						if (!isNaN(val)) {
							onChange(val)
						}
					}}
					className={cn("flex-1", {
						"border-red-500": error,
					})}
				/>
				<VSCodeButton
					appearance="icon"
					title={t("settings:codeIndex.resetToDefault")}
					onClick={() => onChange(CODEBASE_INDEX_DEFAULTS.DEFAULT_PARSER_MIN_CHUNK_SIZE)}>
					<span className="codicon codicon-discard" />
				</VSCodeButton>
			</div>
			{error && <p className="text-xs text-vscode-errorForeground mt-1 mb-0">{error}</p>}
		</div>
	)
}

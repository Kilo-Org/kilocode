import React from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { CODEBASE_INDEX_DEFAULTS } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Slider, StandardTooltip } from "@src/components/ui"

interface EmbeddingBatchSizeSliderProps {
	value: number | undefined
	onChange: (value: number) => void
}

export const EmbeddingBatchSizeSlider: React.FC<EmbeddingBatchSizeSliderProps> = ({ value, onChange }) => {
	const { t } = useAppTranslation()

	const currentValue = value ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_EMBEDDING_BATCH_SIZE

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<label className="text-sm font-medium">
					{t("kilocode:settings.codeIndex.embeddingBatchSizeLabel")}
				</label>
				<StandardTooltip content={t("kilocode:settings.codeIndex.embeddingBatchSizeDescription")}>
					<span className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help" />
				</StandardTooltip>
			</div>
			<div className="flex items-center gap-2">
				<Slider
					min={CODEBASE_INDEX_DEFAULTS.MIN_EMBEDDING_BATCH_SIZE}
					max={CODEBASE_INDEX_DEFAULTS.MAX_EMBEDDING_BATCH_SIZE}
					step={CODEBASE_INDEX_DEFAULTS.EMBEDDING_BATCH_SIZE_STEP}
					value={[currentValue]}
					onValueChange={(values) => onChange(values[0])}
					className="flex-1"
					data-testid="embedding-batch-size-slider"
				/>
				<span className="w-12 text-center">{currentValue}</span>
				<VSCodeButton
					appearance="icon"
					title={t("settings:codeIndex.resetToDefault")}
					onClick={() => onChange(CODEBASE_INDEX_DEFAULTS.DEFAULT_EMBEDDING_BATCH_SIZE)}>
					<span className="codicon codicon-discard" />
				</VSCodeButton>
			</div>
		</div>
	)
}

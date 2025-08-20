import React, { useCallback } from "react"
import { Slider } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface RequestsPerMinuteControlProps {
	value: number
	onChange: (value: number) => void
}

export const RequestsPerMinuteControl: React.FC<RequestsPerMinuteControlProps> = ({ value, onChange }) => {
	const { t } = useAppTranslation()

	const handleValueChange = useCallback(
		(newValue: number) => {
			onChange(newValue)
		},
		[onChange],
	)

	return (
		<div className="flex flex-col gap-1">
			<label className="block font-medium mb-1">{t("settings:providers.requestsPerMinute.label")}</label>
			<div className="flex items-center gap-2">
				<Slider
					value={[value]}
					min={1}
					max={100}
					step={1}
					onValueChange={(newValue) => handleValueChange(newValue[0])}
				/>
				<span className="w-16">{value}/min</span>
			</div>
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings:providers.requestsPerMinute.description", { value })}
			</div>
		</div>
	)
}

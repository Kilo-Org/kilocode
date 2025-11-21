import { DEFAULT_CONSECUTIVE_MISTAKE_LIMIT } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"

import { Slider } from "@/components/ui"

interface ConsecutiveMistakeLimitControlProps {
	value: number
	onChange: (value: number) => void
}

export const ConsecutiveMistakeLimitControl = ({ value, onChange }: ConsecutiveMistakeLimitControlProps) => {
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-1">
			<label className="block font-medium mb-1">{t("settings:providers.consecutiveMistakeLimit.label")}</label>
			<div className="flex items-center gap-2">
				<Slider
					value={[value ?? DEFAULT_CONSECUTIVE_MISTAKE_LIMIT]}
					min={0}
					max={10}
					step={1}
					onValueChange={(newValue) => onChange(Math.max(0, newValue[0]))}
				/>
				<span className="w-10">{Math.max(0, value ?? DEFAULT_CONSECUTIVE_MISTAKE_LIMIT)}</span>
			</div>
			<div className="text-sm text-vscode-descriptionForeground">
				{value === 0
					? t("settings:providers.consecutiveMistakeLimit.unlimitedDescription")
					: t("settings:providers.consecutiveMistakeLimit.description", {
							value: value ?? DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
						})}
			</div>
			{value === 0 && (
				<div className="text-sm text-vscode-errorForeground mt-1">
					{t("settings:providers.consecutiveMistakeLimit.warning")}
				</div>
			)}
		</div>
	)
}

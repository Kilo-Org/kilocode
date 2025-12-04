import { useAppTranslation } from "@/i18n/TranslationContext"

import { Slider } from "@/components/ui"

interface RateLimitSecondsControlProps {
	value: number
	onChange: (value: number) => void
}

export const RateLimitSecondsControl = ({ value, onChange }: RateLimitSecondsControlProps) => {
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-1">
			<label className="block font-medium mb-1">{t("settings:providers.rateLimitSeconds.label")}</label>
			<div className="flex items-center gap-2">
				<Slider value={[value]} min={0} max={60} step={1} onValueChange={(newValue) => onChange(newValue[0])} />
				<span className="w-10">{value}s</span>
			</div>
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings:providers.rateLimitSeconds.description", { value })}
			</div>
		</div>
	)
}

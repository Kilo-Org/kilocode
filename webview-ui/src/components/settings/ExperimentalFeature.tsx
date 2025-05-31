import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ExperimentalFeatureProps {
	enabled: boolean
	onChange: (value: boolean) => void
	// Additional property to identify the experiment
	experimentKey?: string
	isAvailable: boolean // kilocode_change
}

export const ExperimentalFeature = ({
	// kilocode_change start
	enabled,
	onChange,
	experimentKey,
	isAvailable,
	// kilocode_change end
}: ExperimentalFeatureProps) => {
	const { t } = useAppTranslation()

	// Generate translation keys based on experiment key
	const nameKey = experimentKey ? `settings:experimental.${experimentKey}.name` : ""
	const descriptionKey = experimentKey ? `settings:experimental.${experimentKey}.description` : ""

	return (
		<div>
			<div className="flex items-center gap-2">
				<span className="text-vscode-errorForeground">{t("settings:experimental.warning")}</span>
				{/* kilocode_change start */}
				<VSCodeCheckbox
					checked={enabled}
					disabled={!isAvailable}
					onChange={(e: any) => onChange(e.target.checked)}>
					<span className="font-medium">{t(nameKey)}</span>
				</VSCodeCheckbox>
				{/* kilocode_change end */}
			</div>
			<p className="text-vscode-descriptionForeground text-sm mt-0">{t(descriptionKey)}</p>
		</div>
	)
}

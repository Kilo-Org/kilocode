// kilocode_change - file added
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback } from "react"

interface RateLimitAfterControlProps {
	rateLimitAfterEnabled?: boolean
	onChange: (field: "rateLimitAfter", value: any) => void
}

export const RateLimitAfterControl: React.FC<RateLimitAfterControlProps> = ({
	rateLimitAfterEnabled = false,
	onChange,
}) => {
	const { t } = useAppTranslation()

	const handleTodoListEnabledChange = useCallback(
		(e: any) => {
			onChange("rateLimitAfter", e.target.checked)
		},
		[onChange],
	)
	return (
		<div className="flex flex-col gap-1">
			<div>
				<VSCodeCheckbox checked={rateLimitAfterEnabled} onChange={handleTodoListEnabledChange}>
					<span className="font-medium">{t("settings:providers.rateLimitAfter.label")}</span>
				</VSCodeCheckbox>
				<div className="text-vscode-descriptionForeground text-sm">
					{t("settings:providers.rateLimitAfter.description")}
				</div>
			</div>
		</div>
	)
}

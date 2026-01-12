import { useTranslation } from "react-i18next"

interface CondensationErrorRowProps {
	errorText?: string
}

/**
 * Displays an error message when context condensation fails.
 * Shows a warning icon with the error header and optional error details.
 */
export function CondensationErrorRow({ errorText }: CondensationErrorRowProps) {
	const { t } = useTranslation()

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-2">
				<span className="codicon codicon-warning text-vscode-editorWarning-foreground opacity-80 text-base -mb-0.5"></span>
				<span className="font-bold text-vscode-foreground">
					{t("chat:contextManagement.condensation.errorHeader")}
				</span>
			</div>
			{errorText && <span className="text-vscode-descriptionForeground text-sm">{errorText}</span>}
		</div>
	)
}

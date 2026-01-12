import { useTranslation } from "react-i18next"

import { ProgressIndicator } from "../ProgressIndicator"

interface InProgressRowProps {
	eventType: "condense_context" | "sliding_window_truncation"
}

/**
 * Displays an in-progress indicator for context management operations.
 * Shows a spinner with operation-specific text based on the event type.
 */
export function InProgressRow({ eventType }: InProgressRowProps) {
	const { t } = useTranslation()

	const progressText =
		eventType === "condense_context"
			? t("chat:contextManagement.condensation.inProgress")
			: t("chat:contextManagement.truncation.inProgress")

	return (
		<div className="flex items-center gap-2">
			<ProgressIndicator />
			<span className="font-bold text-vscode-foreground">{progressText}</span>
		</div>
	)
}

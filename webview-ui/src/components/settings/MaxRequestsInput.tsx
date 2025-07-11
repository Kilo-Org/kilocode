import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"
import { useCallback } from "react"
import { FormattedInput, unlimitedIntegerFormatter } from "../common/FormattedInput"

interface MaxRequestsInputProps {
	allowedMaxRequests?: number
	onValueChange: (value: number | undefined) => void
	className?: string
}

export function MaxRequestsInput({ allowedMaxRequests, onValueChange, className }: MaxRequestsInputProps) {
	const { t } = useTranslation()

	const handleValueChange = useCallback(
		(value: number | undefined) => {
			onValueChange(value)
			vscode.postMessage({ type: "allowedMaxRequests", value })
		},
		[onValueChange],
	)

	return (
		<div className={`flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background ${className || ""}`}>
			<div className="flex items-center gap-4 font-bold">
				<span className="codicon codicon-pulse" />
				<div>{t("settings:autoApprove.apiRequestLimit.title")}</div>
			</div>
			<div className="flex items-center gap-2">
				<FormattedInput
					value={allowedMaxRequests}
					onValueChange={handleValueChange}
					formatter={unlimitedIntegerFormatter}
					placeholder={t("settings:autoApprove.apiRequestLimit.unlimited")}
					style={{ flex: 1, maxWidth: "200px" }}
					data-testid="max-requests-input"
				/>
			</div>
			<div className="text-vscode-descriptionForeground text-sm">
				{t("settings:autoApprove.apiRequestLimit.description")}
			</div>
		</div>
	)
}

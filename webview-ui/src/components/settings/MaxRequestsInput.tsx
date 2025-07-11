// kilocode_change - new file
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"
import { useCallback } from "react"

interface MaxRequestsInputProps {
	allowedMaxRequests?: number | undefined
	onValueChange: (value: number | undefined) => void
	className?: string
}

export function MaxRequestsInput({ allowedMaxRequests, onValueChange, className }: MaxRequestsInputProps) {
	const { t } = useTranslation()

	const handleInput = useCallback(
		(e: any) => {
			const input = e.target as HTMLInputElement
			input.value = input.value.replace(/[^0-9]/g, "")
			const value = parseInt(input.value)
			const parsedValue = !isNaN(value) && value > 0 ? value : undefined
			onValueChange(parsedValue)
			vscode.postMessage({ type: "allowedMaxRequests", value: parsedValue })
		},
		[onValueChange],
	)

	const inputValue = (allowedMaxRequests ?? Infinity) === Infinity ? "" : allowedMaxRequests?.toString()

	return (
		<div className={`flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background ${className || ""}`}>
			<div className="flex items-center gap-4 font-bold">
				<span className="codicon codicon-pulse" />
				<div>{t("settings:autoApprove.apiRequestLimit.title")}</div>
			</div>
			<div className="flex items-center gap-2">
				<VSCodeTextField
					placeholder={t("settings:autoApprove.apiRequestLimit.unlimited")}
					value={inputValue}
					onInput={handleInput}
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

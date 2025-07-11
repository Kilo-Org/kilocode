import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"
import { useCallback } from "react"

interface MaxCostInputProps {
	allowedMaxCost?: number
	onValueChange: (value: number | undefined) => void
	className?: string
}

export function MaxCostInput({ allowedMaxCost, onValueChange, className }: MaxCostInputProps) {
	const { t } = useTranslation()

	const handleInput = useCallback(
		(e: any) => {
			const input = e.target as HTMLInputElement
			input.value = input.value.replace(/[^0-9.]/g, "")
			const parts = input.value.split(".")
			if (parts.length > 2) {
				input.value = parts[0] + "." + parts.slice(1).join("")
			}
			const value = parseFloat(input.value)
			const parsedValue = !isNaN(value) && value > 0 ? value : undefined
			onValueChange(parsedValue)
			vscode.postMessage({ type: "allowedMaxCost", value: parsedValue })
		},
		[onValueChange],
	)

	const inputValue = (allowedMaxCost ?? Infinity) === Infinity ? "" : allowedMaxCost?.toString()

	return (
		<div className={`flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background ${className || ""}`}>
			<div className="flex items-center gap-4 font-bold">
				<span className="codicon codicon-credit-card" />
				<div>{t("settings:autoApprove.apiCostLimit.title")}</div>
			</div>
			<div className="flex items-center gap-2">
				<VSCodeTextField
					placeholder={t("settings:autoApprove.apiCostLimit.unlimited")}
					value={inputValue}
					onInput={handleInput}
					style={{ flex: 1, maxWidth: "200px" }}
					data-testid="max-cost-input"
				/>
				<span className="text-vscode-descriptionForeground">$</span>
			</div>
			<div className="text-vscode-descriptionForeground text-sm">
				{t("settings:autoApprove.apiCostLimit.description")}
			</div>
		</div>
	)
}

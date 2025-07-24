import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"
import { useCallback } from "react"
import { FormattedTextField, InputFormatter } from "../common/FormattedTextField"

const unlimitedDecimalFormatter: InputFormatter<number> = {
	parse: (input: string) => {
		if (input.trim() === "") return undefined
		const value = parseFloat(input)
		return !isNaN(value) && value >= 0 ? value : undefined
	},
	format: (value: number | undefined) => {
		return value === undefined || value === Infinity ? "" : value.toString()
	},
	filter: (input: string) => {
		let cleanValue = input.replace(/[^0-9.]/g, "")
		const parts = cleanValue.split(".")
		if (parts.length > 2) {
			cleanValue = parts[0] + "." + parts.slice(1).join("")
		}
		return cleanValue
	},
}

interface MaxCostInputProps {
	allowedMaxCost?: number
	onValueChange: (value: number | undefined) => void
	className?: string
}

export function MaxCostInput({ allowedMaxCost, onValueChange, className }: MaxCostInputProps) {
	const { t } = useTranslation()

	const handleValueChange = useCallback(
		(value: number | undefined) => {
			onValueChange(value)
			vscode.postMessage({ type: "allowedMaxCost", value })
		},
		[onValueChange],
	)

	return (
		<div className={`flex flex-col gap-3 pl-3 flex-auto ${className || ""}`}>
			<div className="flex items-center gap-4 font-bold">
				<span className="codicon codicon-credit-card" />
				<div>{t("settings:autoApprove.apiCostLimit.title")}</div>
			</div>
			<div className="flex items-center">
				<FormattedTextField
					value={allowedMaxCost}
					onValueChange={handleValueChange}
					formatter={unlimitedDecimalFormatter}
					placeholder={t("settings:autoApprove.apiCostLimit.unlimited")}
					style={{ flex: 1, maxWidth: "200px" }}
					data-testid="max-cost-input"
					leftNodes={[<span key="dollar">$</span>]}
				/>
			</div>
		</div>
	)
}

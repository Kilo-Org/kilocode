// kilocode_change - new file
import { useCallback } from "react"
import { FormattedInput, currencyFormatter } from "./FormattedInput"

interface CostInputProps {
	value?: number | undefined
	onValueChange: (value: number | undefined) => void
	placeholder?: string
	className?: string
	style?: React.CSSProperties
	"data-testid"?: string
	label?: string
	description?: string
	icon?: string
}

export function CostInput({
	value,
	onValueChange,
	placeholder,
	className,
	style,
	"data-testid": dataTestId,
	label,
	description,
	icon = "codicon-credit-card",
}: CostInputProps) {
	const handleValueChange = useCallback(
		(newValue: number | undefined) => {
			onValueChange(newValue)
		},
		[onValueChange],
	)

	if (label || description) {
		return (
			<div className={`flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background ${className || ""}`}>
				{label && (
					<div className="flex items-center gap-4 font-bold">
						<span className={`codicon ${icon}`} />
						<div>{label}</div>
					</div>
				)}
				<div className="flex items-center gap-2">
					<span className="text-vscode-descriptionForeground">$</span>
					<FormattedInput
						value={value}
						onValueChange={handleValueChange}
						formatter={currencyFormatter}
						placeholder={placeholder || "0.00"}
						style={style || { flex: 1, maxWidth: "200px" }}
						data-testid={dataTestId}
					/>
				</div>
				{description && <div className="text-vscode-descriptionForeground text-sm">{description}</div>}
			</div>
		)
	}

	return (
		<div className="flex items-center gap-2">
			<span className="text-vscode-descriptionForeground">$</span>
			<FormattedInput
				value={value}
				onValueChange={handleValueChange}
				formatter={currencyFormatter}
				placeholder={placeholder || "0.00"}
				className={className}
				style={style}
				data-testid={dataTestId}
			/>
		</div>
	)
}

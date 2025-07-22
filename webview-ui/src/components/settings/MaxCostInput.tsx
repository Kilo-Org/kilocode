import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"
import { useCallback, useState, useEffect } from "react"
import { DecoratedVSCodeTextField } from "@/components/common/DecoratedVSCodeTextField"

interface MaxCostInputProps {
	allowedMaxCost?: number
	onValueChange: (value: number | undefined) => void
	className?: string
	hideDescription?: boolean
}

export function MaxCostInput({ allowedMaxCost, onValueChange, className, hideDescription }: MaxCostInputProps) {
	const { t } = useTranslation()
	const [inputValue, setInputValue] = useState("")

	// Update input value when allowedMaxCost prop changes
	useEffect(() => {
		const displayValue = (allowedMaxCost ?? Infinity) === Infinity ? "" : (allowedMaxCost?.toString() ?? "")
		setInputValue(displayValue)
	}, [allowedMaxCost])

	const parseAndValidateInput = useCallback((value: string) => {
		if (value.trim() === "") {
			return undefined
		}
		const numericValue = parseFloat(value)
		return !isNaN(numericValue) && numericValue >= 0 ? numericValue : undefined
	}, [])

	const handleInput = useCallback((e: any) => {
		const input = e.target as HTMLInputElement
		// Only allow numbers and decimal points
		let cleanValue = input.value.replace(/[^0-9.]/g, "")

		// Prevent multiple decimal points
		const parts = cleanValue.split(".")
		if (parts.length > 2) {
			cleanValue = parts[0] + "." + parts.slice(1).join("")
		}

		// Update the input value immediately for user feedback
		input.value = cleanValue
		setInputValue(cleanValue)
	}, [])

	const handleBlurOrEnter = useCallback(
		(value: string) => {
			const parsedValue = parseAndValidateInput(value)
			onValueChange(parsedValue)
			vscode.postMessage({ type: "allowedMaxCost", value: parsedValue })
		},
		[parseAndValidateInput, onValueChange],
	)

	const handleBlur = useCallback(
		(e: any) => {
			const value = e.target.value
			handleBlurOrEnter(value)
		},
		[handleBlurOrEnter],
	)

	const handleKeyDown = useCallback(
		(e: any) => {
			if (e.key === "Enter") {
				const value = e.target.value
				handleBlurOrEnter(value)
			}
		},
		[handleBlurOrEnter],
	)

	return (
		<div className={`flex flex-col gap-3 pl-3 ${className || ""}`}>
			<div className="flex items-center gap-4 font-bold">
				<span className="codicon codicon-credit-card" />
				<div>{t("settings:autoApprove.apiCostLimit.title")}</div>
			</div>
			<div className="flex items-center">
				<DecoratedVSCodeTextField
					placeholder={t("settings:autoApprove.apiCostLimit.unlimited")}
					value={inputValue}
					onInput={handleInput}
					onBlur={handleBlur}
					onKeyDown={handleKeyDown}
					style={{ flex: 1, maxWidth: "200px" }}
					data-testid="max-cost-input"
					leftNodes={[<span key="dollar">$</span>]}
				/>
			</div>
			{!hideDescription && (
				<div className="text-vscode-descriptionForeground text-sm">
					{t("settings:autoApprove.apiCostLimit.description")}
				</div>
			)}
		</div>
	)
}

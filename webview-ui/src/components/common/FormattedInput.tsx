// kilocode_change - new file
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback } from "react"

export interface InputFormatter<T> {
	/**
	 * Parse the raw input string into the typed value
	 */
	parse: (input: string) => T | undefined

	/**
	 * Format the typed value for display in the input field
	 */
	format: (value: T | undefined) => string

	/**
	 * Filter/transform the input as the user types (optional)
	 */
	filter?: (input: string) => string
}

interface FormattedInputProps<T> {
	value: T | undefined
	onValueChange: (value: T | undefined) => void
	formatter: InputFormatter<T>
	placeholder?: string
	className?: string
	style?: React.CSSProperties
	"data-testid"?: string
}

export function FormattedInput<T>({
	value,
	onValueChange,
	formatter,
	placeholder,
	className,
	style,
	"data-testid": dataTestId,
}: FormattedInputProps<T>) {
	const handleInput = useCallback(
		(e: any) => {
			const input = e.target as HTMLInputElement

			if (formatter.filter) {
				input.value = formatter.filter(input.value)
			}

			const parsedValue = formatter.parse(input.value)
			onValueChange(parsedValue)
		},
		[formatter, onValueChange],
	)

	const displayValue = formatter.format(value)

	return (
		<VSCodeTextField
			placeholder={placeholder}
			value={displayValue}
			onInput={handleInput}
			className={className}
			style={style}
			data-testid={dataTestId}
		/>
	)
}

// Common formatters for reuse
export const integerFormatter: InputFormatter<number> = {
	parse: (input: string) => {
		const value = parseInt(input)
		return !isNaN(value) && value > 0 ? value : undefined
	},
	format: (value: number | undefined) => {
		return value?.toString() || ""
	},
	filter: (input: string) => input.replace(/[^0-9]/g, ""),
}

export const currencyFormatter: InputFormatter<number> = {
	parse: (input: string) => {
		const cleanInput = input.replace(/[$,]/g, "")
		const value = parseFloat(cleanInput)
		return !isNaN(value) && value >= 0 ? value : undefined
	},
	format: (value: number | undefined) => {
		if (value === undefined) return ""
		return value.toFixed(2)
	},
	filter: (input: string) => {
		return input.replace(/[^0-9.$,]/g, "")
	},
}

export const unlimitedIntegerFormatter: InputFormatter<number> = {
	parse: (input: string) => {
		if (input.trim() === "") return undefined
		const value = parseInt(input)
		return !isNaN(value) && value > 0 ? value : undefined
	},
	format: (value: number | undefined) => {
		return value === undefined || value === Infinity ? "" : value.toString()
	},
	filter: (input: string) => input.replace(/[^0-9]/g, ""),
}

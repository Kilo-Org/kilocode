// kilocode_change - new file
import { useCallback, forwardRef } from "react"
import { DecoratedVSCodeTextField, VSCodeTextFieldWithNodesProps } from "./DecoratedVSCodeTextField"

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

interface FormattedTextFieldProps<T> extends Omit<VSCodeTextFieldWithNodesProps, "value" | "onInput"> {
	value: T | undefined
	onValueChange: (value: T | undefined) => void
	formatter: InputFormatter<T>
}

function FormattedTextFieldInner<T>(
	{ value, onValueChange, formatter, ...restProps }: FormattedTextFieldProps<T>,
	forwardedRef: React.Ref<HTMLInputElement>,
) {
	const handleInput = useCallback(
		(e: React.FormEvent<HTMLInputElement>) => {
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

	return <DecoratedVSCodeTextField {...restProps} value={displayValue} onInput={handleInput} ref={forwardedRef} />
}

export const FormattedTextField = forwardRef(FormattedTextFieldInner as any) as <T>(
	props: FormattedTextFieldProps<T> & { ref?: React.Ref<HTMLInputElement> },
) => React.ReactElement

// Common formatters for reuse
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

export const unlimitedDecimalFormatter: InputFormatter<number> = {
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

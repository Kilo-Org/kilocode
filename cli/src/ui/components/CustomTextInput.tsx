/**
 * Custom TextInput component that properly handles modifier keys
 */

import React, { useState, useEffect } from "react"
import { Text, useInput } from "ink"

interface CustomTextInputProps {
	value: string
	onChange: (value: string) => void
	onSubmit?: () => void
	placeholder?: string
	showCursor?: boolean
}

export const CustomTextInput: React.FC<CustomTextInputProps> = ({
	value,
	onChange,
	onSubmit,
	placeholder = "",
	showCursor = true,
}) => {
	const [cursorOffset, setCursorOffset] = useState(value.length)

	useEffect(() => {
		setCursorOffset(value.length)
	}, [value])

	useInput(
		(input, key) => {
			// Ignore all input when modifier keys are pressed
			if (key.ctrl || key.meta) {
				return
			}

			if (key.return) {
				onSubmit?.()
				return
			}

			if (key.backspace || key.delete) {
				if (cursorOffset > 0) {
					const newValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset)
					onChange(newValue)
					setCursorOffset(cursorOffset - 1)
				}
				return
			}

			if (key.leftArrow) {
				setCursorOffset(Math.max(0, cursorOffset - 1))
				return
			}

			if (key.rightArrow) {
				setCursorOffset(Math.min(value.length, cursorOffset + 1))
				return
			}

			// Handle regular character input
			if (input && !key.escape && !key.tab && !key.upArrow && !key.downArrow) {
				const newValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset)
				onChange(newValue)
				setCursorOffset(cursorOffset + input.length)
			}
		},
		{ isActive: true },
	)

	const displayValue = value || placeholder
	const isPlaceholder = !value

	// Build the display with cursor
	let displayText = displayValue
	if (showCursor && cursorOffset <= displayValue.length) {
		const before = displayValue.slice(0, cursorOffset)
		const cursor = displayValue[cursorOffset] || " "
		const after = displayValue.slice(cursorOffset + 1)
		displayText = before + cursor + after
	}

	return isPlaceholder ? <Text color="gray">{displayText}</Text> : <Text>{displayText}</Text>
}

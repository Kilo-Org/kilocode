import { memo } from "react"
import { Text, Box } from "ink"

import * as theme from "../theme.js"
import type { Toast, ToastType } from "../hooks/useToast.js"

interface ToastDisplayProps {
	toast: Toast | null
}

function getToastColor(type: ToastType): string {
	switch (type) {
		case "success":
			return theme.successColor
		case "warning":
			return theme.warningColor
		case "error":
			return theme.errorColor
		case "info":
		default:
			return theme.focusColor // cyan for info
	}
}

function getToastIcon(type: ToastType): string {
	switch (type) {
		case "success":
			return "✓"
		case "warning":
			return "⚠"
		case "error":
			return "✗"
		case "info":
		default:
			return "ℹ"
	}
}

function ToastDisplay({ toast }: ToastDisplayProps) {
	if (!toast) {
		return null
	}

	const color = getToastColor(toast.type)
	const icon = getToastIcon(toast.type)

	return (
		<Box>
			<Text color={color}>
				{icon} {toast.message}
			</Text>
		</Box>
	)
}

export default memo(ToastDisplay)

import { memo } from "react"
import { Text } from "ink"

import * as theme from "../theme.js"

interface ProgressBarProps {
	/** Current value (e.g., contextTokens) */
	value: number
	/** Maximum value (e.g., contextWindow) */
	max: number
	/** Width of the bar in characters (default: 16) */
	width?: number
}

/**
 * A progress bar component with color gradient based on fill percentage.
 *
 * Colors:
 * - 0-50%: Green (safe zone)
 * - 50-75%: Yellow (warning zone)
 * - 75-100%: Red (danger zone)
 *
 * Visual example: [████████░░░░░░░░] 50%
 */
function ProgressBar({ value, max, width = 16 }: ProgressBarProps) {
	// Calculate percentage, clamped to 0-100
	const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0

	// Calculate how many blocks to fill
	const filledBlocks = Math.round((percentage / 100) * width)
	const emptyBlocks = width - filledBlocks

	// Determine color based on percentage
	let barColor: string
	if (percentage <= 50) {
		barColor = theme.successColor // Green
	} else if (percentage <= 75) {
		barColor = theme.warningColor // Yellow
	} else {
		barColor = theme.errorColor // Red
	}

	// Unicode block characters for smooth appearance
	const filledChar = "█"
	const emptyChar = "░"

	const filledPart = filledChar.repeat(filledBlocks)
	const emptyPart = emptyChar.repeat(emptyBlocks)

	return (
		<Text>
			<Text color={theme.dimText}>[</Text>
			<Text color={barColor}>{filledPart}</Text>
			<Text color={theme.dimText}>
				{emptyPart}] {Math.round(percentage)}%
			</Text>
		</Text>
	)
}

export default memo(ProgressBar)

import { memo } from "react"
import { Text, Box } from "ink"

import type { TokenUsage } from "@roo-code/types"

import * as theme from "../theme.js"
import ProgressBar from "./ProgressBar.js"

interface MetricsDisplayProps {
	tokenUsage: TokenUsage
	contextWindow: number
}

/**
 * Formats a large number with K (thousands) or M (millions) suffix.
 *
 * Examples:
 * - 1234 -> "1.2K"
 * - 1234567 -> "1.2M"
 * - 500 -> "500"
 */
function formatNumber(num: number): string {
	if (num >= 1_000_000) {
		return `${(num / 1_000_000).toFixed(1)}M`
	}
	if (num >= 1_000) {
		return `${(num / 1_000).toFixed(1)}K`
	}
	return num.toString()
}

/**
 * Formats cost as currency with $ prefix.
 *
 * Examples:
 * - 0.12345 -> "$0.12"
 * - 1.5 -> "$1.50"
 */
function formatCost(cost: number): string {
	return `$${cost.toFixed(2)}`
}

/**
 * Displays task metrics in a compact format:
 * $0.12 │ ↓45.2K │ ↑8.7K │ [████████░░░░] 62%
 */
function MetricsDisplay({ tokenUsage, contextWindow }: MetricsDisplayProps) {
	const { totalCost, totalTokensIn, totalTokensOut, contextTokens } = tokenUsage

	return (
		<Box>
			<Text color={theme.text}>{formatCost(totalCost)}</Text>
			<Text color={theme.dimText}> • </Text>
			<Text color={theme.dimText}>
				↓ <Text color={theme.text}>{formatNumber(totalTokensIn)}</Text>
			</Text>
			<Text color={theme.dimText}> • </Text>
			<Text color={theme.dimText}>
				↑ <Text color={theme.text}>{formatNumber(totalTokensOut)}</Text>
			</Text>
			<Text color={theme.dimText}> • </Text>
			<ProgressBar value={contextTokens} max={contextWindow} width={12} />
		</Box>
	)
}

export default memo(MetricsDisplay)
export { formatNumber, formatCost }

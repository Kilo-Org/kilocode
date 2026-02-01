/**
 * BudgetIndicator Component
 * Displays budget status in the UI
 */

import React, { useEffect, useState } from "react"
import { Box, Text } from "ink"
import { useAtomValue } from "jotai"
import {
	budgetStatusAtom,
	budgetEnabledAtom,
	budgetWarningLevelAtom,
	isBudgetExceededAtom,
} from "../../state/atoms/budget.js"
import { useTheme } from "../../state/hooks/useTheme.js"
import { formatSessionCost } from "../../state/hooks/useSessionCost.js"
import type { BudgetStatus, WarningLevel } from "../../services/budget/types.js"

interface BudgetIndicatorProps {
	/** Whether to show compact view */
	compact?: boolean
}

/**
 * Get color based on warning level
 */
function getWarningColor(level: WarningLevel, theme: ReturnType<typeof useTheme>): string {
	switch (level) {
		case "critical":
			return theme.semantic.error
		case "high":
			return "#ff8800" // Orange
		case "medium":
			return theme.semantic.warning
		case "low":
			return theme.semantic.info
		default:
			return theme.semantic.success
	}
}

/**
 * Get status emoji based on warning level
 */
function getStatusEmoji(level: WarningLevel): string {
	switch (level) {
		case "critical":
			return "🚨"
		case "high":
			return "⚠️"
		case "medium":
			return "📊"
		case "low":
			return "💰"
		default:
			return "✅"
	}
}

/**
 * BudgetIndicator component
 */
export const BudgetIndicator: React.FC<BudgetIndicatorProps> = ({ compact = false }) => {
	const theme = useTheme()
	const status = useAtomValue(budgetStatusAtom)
	const enabled = useAtomValue(budgetEnabledAtom)
	const warningLevel = useAtomValue(budgetWarningLevelAtom)
	const isExceeded = useAtomValue(isBudgetExceededAtom)

	if (!enabled) {
		return null
	}

	const color = getWarningColor(warningLevel, theme)
	const emoji = getStatusEmoji(warningLevel)

	if (compact) {
		// Compact view - just show emoji and daily percentage
		const dailyPercentage = Math.round(status.daily.percentage * 100)
		return (
			<Box>
				<Text color={color}>
					{emoji} {dailyPercentage}%
				</Text>
			</Box>
		)
	}

	// Full view - show all periods
	return (
		<Box flexDirection="column">
			<Box>
				<Text color={color} bold>
					{emoji} Budget
				</Text>
			</Box>
			<PeriodIndicator name="Daily" period={status.daily} theme={theme} />
			<PeriodIndicator name="Weekly" period={status.weekly} theme={theme} />
			<PeriodIndicator name="Monthly" period={status.monthly} theme={theme} />
		</Box>
	)
}

interface PeriodIndicatorProps {
	name: string
	period: BudgetStatus["daily"]
	theme: ReturnType<typeof useTheme>
}

/**
 * PeriodIndicator sub-component
 */
const PeriodIndicator: React.FC<PeriodIndicatorProps> = ({ name, period, theme }) => {
	if (!period.enabled) {
		return (
			<Box>
				<Text color={theme.ui.text.dimmed} dimColor>
					{name}: Off
				</Text>
			</Box>
		)
	}

	const percentage = Math.round(period.percentage * 100)
	const color =
		period.isExceeded
			? theme.semantic.error
			: percentage >= 90
				? "#ff8800"
				: percentage >= 75
					? theme.semantic.warning
					: theme.ui.text.default

	return (
		<Box>
			<Text color={theme.ui.text.dimmed}>{name}:</Text>
			<Text color={color}>
				{" "}
				{formatSessionCost(period.spend)}/{formatSessionCost(period.limit)} ({percentage}%)
			</Text>
		</Box>
	)
}

/**
 * BudgetAlert component - shows when budget is exceeded or near limit
 */
export const BudgetAlert: React.FC = () => {
	const theme = useTheme()
	const status = useAtomValue(budgetStatusAtom)
	const warningLevel = useAtomValue(budgetWarningLevelAtom)
	const isExceeded = useAtomValue(isBudgetExceededAtom)
	const enabled = useAtomValue(budgetEnabledAtom)
	const [showAlert, setShowAlert] = useState(false)

	useEffect(() => {
		if (!enabled) {
			setShowAlert(false)
			return
		}

		// Show alert if budget exceeded or at high warning level
		setShowAlert(isExceeded || warningLevel === "high" || warningLevel === "critical")
	}, [enabled, isExceeded, warningLevel])

	if (!showAlert) {
		return null
	}

	const color = isExceeded ? theme.semantic.error : "#ff8800"
	const emoji = isExceeded ? "🚨" : "⚠️"
	const message = isExceeded
		? "Budget exceeded!"
		: `Budget at ${Math.round(Math.max(status.daily.percentage, status.weekly.percentage, status.monthly.percentage) * 100)}%`

	return (
		<Box borderStyle="round" borderColor={color} paddingX={1}>
			<Text color={color} bold>
				{emoji} {message}
			</Text>
		</Box>
	)
}

export default BudgetIndicator

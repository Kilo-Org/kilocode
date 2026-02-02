import { Box, Text } from "ink"
import { memo } from "react"

import * as theme from "../theme.js"

interface ScrollIndicatorProps {
	scrollTop: number
	maxScroll: number
	isScrollFocused?: boolean
}

function ScrollIndicator({ scrollTop, maxScroll, isScrollFocused = false }: ScrollIndicatorProps) {
	// Calculate percentage - show 100% when at bottom or no scrolling needed.
	const percentage = maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 100

	// Color changes based on focus state.
	const color = isScrollFocused ? theme.scrollActiveColor : theme.dimText

	return (
		<Box>
			<Text color={color}>{percentage}% • ↑↓ scroll • Ctrl+E end</Text>
		</Box>
	)
}

export default memo(ScrollIndicator)

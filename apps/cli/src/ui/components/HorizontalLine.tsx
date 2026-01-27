import { Text } from "ink"

import * as theme from "../theme.js"
import { useTerminalSize } from "../hooks/TerminalSizeContext.js"

interface HorizontalLineProps {
	active?: boolean
}

export function HorizontalLine({ active = false }: HorizontalLineProps) {
	const { columns } = useTerminalSize()
	const color = active ? theme.borderColorActive : theme.borderColor
	return <Text color={color}>{"─".repeat(columns)}</Text>
}

import React from "react"
import { Box } from "ink"
import { stdout } from "process"

export const EmptyMessage: React.FC = () => {
	const marginTop = Math.max(0, stdout?.rows || 0)
	return <Box flexDirection="column" gap={2} marginTop={marginTop} />
}

import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display task completion
 */
export const ToolFinishTaskMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("finishTask")

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.success} bold>
					{icon} Finish Task
				</Text>
			</Box>

			{toolData.content && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed}>{toolData.content}</Text>
				</Box>
			)}
		</Box>
	)
}

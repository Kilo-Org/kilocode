import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display fetched instructions
 */
export const ToolFetchInstructionsMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("fetchInstructions")
	const lines = toolData.content ? toolData.content.split("\n") : []

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.messages.user} bold>
					{icon} Fetch Instructions
				</Text>
			</Box>

			{toolData.content && (
				<Box
					width={getBoxWidth(3)}
					flexDirection="column"
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}
					marginTop={1}
					marginLeft={2}>
					{lines.slice(0, 10).map((line, index) => (
						<Text key={index} color={theme.ui.text.dimmed}>
							{truncateText(line, 80)}
						</Text>
					))}
					{lines.length > 10 && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... ({lines.length - 10} more lines)
						</Text>
					)}
				</Box>
			)}

			<Box marginLeft={2} marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					Lines: {lines.length}
				</Text>
			</Box>
		</Box>
	)
}

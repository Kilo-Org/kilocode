import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, truncateText } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display new subtask creation
 */
export const ToolNewTaskMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("newTask")

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.messages.user} bold>
					{icon} New Subtask
				</Text>
			</Box>

			<Box marginLeft={2} flexDirection="column">
				{toolData.mode && (
					<Box>
						<Text color={theme.ui.text.dimmed} dimColor>
							Mode:{" "}
						</Text>
						<Text color={theme.semantic.info}>{toolData.mode}</Text>
					</Box>
				)}
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
					{toolData.content
						.split("\n")
						.slice(0, 5)
						.map((line, index) => (
							<Text key={index} color={theme.ui.text.primary}>
								{truncateText(line, 80)}
							</Text>
						))}
					{toolData.content.split("\n").length > 5 && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... ({toolData.content.split("\n").length - 5} more lines)
						</Text>
					)}
				</Box>
			)}
		</Box>
	)
}

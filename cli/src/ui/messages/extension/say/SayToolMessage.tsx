import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { parseToolData, getToolIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display tool execution results
 */
export const SayToolMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const toolData = parseToolData(message)

	if (!toolData) {
		return (
			<Box marginY={1}>
				<Text color={theme.semantic.success}>⚙ Tool Result (invalid data)</Text>
			</Box>
		)
	}

	const icon = getToolIcon(toolData.tool)

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.success} bold>
					{icon} {toolData.tool}
				</Text>
			</Box>

			{toolData.path && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.semantic.info}>{toolData.path}</Text>
				</Box>
			)}

			{toolData.content && (
				<Box
					width={getBoxWidth(3)}
					marginLeft={2}
					marginTop={1}
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}>
					<Text color={theme.ui.text.primary}>
						{toolData.content.substring(0, 200)}
						{toolData.content.length > 200 ? "..." : ""}
					</Text>
				</Box>
			)}
		</Box>
	)
}

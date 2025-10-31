import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { parseToolData, getToolIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display tool usage requests requiring approval
 * Parses tool data and shows tool information
 * Approval is handled centrally by useApprovalMonitor in UI.tsx
 */
export const AskToolMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()

	const toolData = parseToolData(message)

	if (!toolData) {
		return (
			<Box marginY={1}>
				<Text color={theme.semantic.warning} bold>
					⚙ Tool Request (invalid data)
				</Text>
			</Box>
		)
	}

	const icon = getToolIcon(toolData.tool)

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.warning} bold>
					{icon} Tool Request: {toolData.tool}
				</Text>
			</Box>

			{toolData.path && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.semantic.info}>Path: {toolData.path}</Text>
				</Box>
			)}

			{toolData.reason && (
				<Box marginLeft={2}>
					<Text color={theme.ui.text.dimmed} dimColor>
						Reason: {toolData.reason}
					</Text>
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

			{message.isAnswered && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						✓ Answered
					</Text>
				</Box>
			)}
		</Box>
	)
}

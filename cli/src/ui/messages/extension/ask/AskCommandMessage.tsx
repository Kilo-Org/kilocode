import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon, parseToolData } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display command execution request with terminal icon and command in a bordered box
 * Approval is handled centrally by useApprovalMonitor in UI.tsx
 */
export const AskCommandMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()

	const icon = getMessageIcon("ask", "command")
	const toolData = parseToolData(message)

	// Extract command from toolData or message text
	const command = toolData?.command || message.text || ""
	const cwd = toolData?.path

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.warning} bold>
					{icon} Command Request
				</Text>
			</Box>

			{command && (
				<Box
					width={getBoxWidth(3)}
					marginLeft={2}
					marginTop={1}
					borderStyle="single"
					borderColor={theme.semantic.warning}
					paddingX={1}>
					<Text color={theme.ui.text.primary}>{command}</Text>
				</Box>
			)}

			{cwd && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						Working directory: {cwd}
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

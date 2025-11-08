import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display auto-approval limit reached warning
 */
export const AskAutoApprovalMaxReachedMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("ask", "auto_approval_max_req_reached")

	return (
		<Box
			width={getBoxWidth(1)}
			flexDirection="column"
			borderStyle="single"
			borderColor={theme.semantic.warning}
			paddingX={1}
			marginY={1}>
			<Box>
				<Text color={theme.semantic.warning} bold>
					{icon} Auto-Approval Limit Reached
				</Text>
			</Box>

			{message.text && (
				<Box marginTop={1}>
					<MarkdownText>{message.text}</MarkdownText>
				</Box>
			)}

			<Box marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					The maximum number of auto-approved requests has been reached. Manual approval is now required.
				</Text>
			</Box>

			{message.isAnswered && (
				<Box marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						✓ Answered
					</Text>
				</Box>
			)}
		</Box>
	)
}

import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display low credit warning with payment icon
 */
export const AskPaymentRequiredMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("ask", "payment_required_prompt")

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
					{icon} Low Credit Warning
				</Text>
			</Box>

			{message.text && (
				<Box marginTop={1}>
					<MarkdownText>{message.text}</MarkdownText>
				</Box>
			)}

			<Box marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					Your account is running low on credits. Please add more credits to continue.
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

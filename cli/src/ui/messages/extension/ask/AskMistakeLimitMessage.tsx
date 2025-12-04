import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display mistake limit reached error with red error styling
 */
export const AskMistakeLimitMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("ask", "mistake_limit_reached")

	return (
		<Box
			width={getBoxWidth(1)}
			flexDirection="column"
			borderStyle="single"
			borderColor={theme.semantic.error}
			paddingX={1}
			marginY={1}>
			<Box>
				<Text color={theme.semantic.error} bold>
					{icon} Mistake Limit Reached
				</Text>
			</Box>
			{message.text && (
				<Box marginTop={1}>
					<MarkdownText>{message.text}</MarkdownText>
				</Box>
			)}
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

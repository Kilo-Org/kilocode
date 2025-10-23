import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display invalid model selection warning
 */
export const AskInvalidModelMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("ask", "invalid_model")

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
					{icon} Invalid Model Selection
				</Text>
			</Box>

			{message.text && (
				<Box marginTop={1}>
					<MarkdownText>{message.text}</MarkdownText>
				</Box>
			)}

			<Box marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					The selected model is not available or invalid. Please choose a different model.
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

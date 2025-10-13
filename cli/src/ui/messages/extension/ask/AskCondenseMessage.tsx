import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display context condensation request
 */
export const AskCondenseMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("ask", "condense")

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.warning} bold>
					{icon} Context Condensation Request
				</Text>
			</Box>

			{message.text && (
				<Box marginLeft={2} marginTop={1}>
					<MarkdownText>{message.text}</MarkdownText>
				</Box>
			)}

			<Box marginLeft={2} marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					The conversation context will be condensed to save tokens and improve performance.
				</Text>
			</Box>

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

import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display subtask results in a badge-styled box
 */
export const SaySubtaskResultMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	return (
		<Box
			width={getBoxWidth(1)}
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.semantic.info}
			paddingX={1}
			marginY={1}>
			<Box>
				<Text color={theme.semantic.info} bold>
					📋 Subtask Result
				</Text>
			</Box>
			{message.text && (
				<Box marginTop={1}>
					<MarkdownText>{message.text}</MarkdownText>
				</Box>
			)}
		</Box>
	)
}

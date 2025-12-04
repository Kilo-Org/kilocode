import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { parseToolData, truncateText } from "../utils.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display user feedback with diff content
 */
export const SayUserFeedbackDiffMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const toolData = parseToolData(message)

	return (
		<Box
			width={getBoxWidth(1)}
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.messages.user}
			paddingX={1}
			marginY={1}>
			<Box>
				<Text color={theme.messages.user} bold>
					💬 User Feedback (with changes)
				</Text>
			</Box>

			{toolData?.path && (
				<Box marginTop={1}>
					<Text color={theme.semantic.info}>File: {toolData.path}</Text>
				</Box>
			)}

			{toolData?.diff && (
				<Box
					width={getBoxWidth(1)}
					marginTop={1}
					borderStyle="single"
					borderColor={theme.ui.border.default}
					paddingX={1}>
					<Text color={theme.ui.text.primary}>{truncateText(toolData.diff, 300)}</Text>
				</Box>
			)}

			{message.text && !toolData && (
				<Box marginTop={1}>
					<MarkdownText>{message.text}</MarkdownText>
				</Box>
			)}
		</Box>
	)
}

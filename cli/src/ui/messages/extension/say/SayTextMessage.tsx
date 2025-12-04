import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon, getMessageColor } from "../utils.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display plain text messages with optional markdown formatting and image indicators
 */
export const SayTextMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("say", "text")
	const color = getMessageColor("say", "text")
	const text = message.text || ""
	const hasImages = message.images && message.images.length > 0
	const hasText = text.trim().length > 0

	// Don't render if there's no text and no images
	if (!hasText && !hasImages) {
		return null
	}

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Text color={color} bold>
					{icon}
				</Text>
				<Text> </Text>
				<MarkdownText>{text}</MarkdownText>
				{message.partial && (
					<Text color={theme.ui.text.dimmed} dimColor>
						{" "}
						...
					</Text>
				)}
			</Box>

			{message.images && message.images.length > 0 && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						📎 {message.images.length} image(s) attached
					</Text>
				</Box>
			)}
		</Box>
	)
}

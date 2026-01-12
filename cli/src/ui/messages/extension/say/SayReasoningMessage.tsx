import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { MarkdownText } from "../../../components/MarkdownText.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display AI reasoning/thinking process in a bordered box
 */
export const SayReasoningMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	return (
		<Box
			width={getBoxWidth(1)}
			flexDirection="column"
			borderStyle="single"
			borderColor={theme.ui.text.highlight}
			paddingX={1}
			marginY={1}>
			<Box>
				<Text color={theme.ui.text.highlight} bold>
					💭 Reasoning
				</Text>
			</Box>
			{message.text && (
				<Box marginTop={1}>
					<MarkdownText theme={theme}>{message.text}</MarkdownText>
					{message.partial && (
						<Text color={theme.ui.text.dimmed} dimColor>
							{" "}
							...
						</Text>
					)}
				</Box>
			)}
		</Box>
	)
}

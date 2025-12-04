import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display API request retry delayed
 */
export const SayApiReqRetryDelayedMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	return (
		<Box marginY={1}>
			<Text color={theme.actions.pending}>⏳ API Request retry delayed...</Text>
			{message.text && (
				<Text color={theme.ui.text.dimmed} dimColor>
					{" "}
					{message.text}
				</Text>
			)}
		</Box>
	)
}

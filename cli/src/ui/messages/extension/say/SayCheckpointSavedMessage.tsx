import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display checkpoint saved notifications
 */
export const SayCheckpointSavedMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("say", "checkpoint_saved")

	return (
		<Box marginY={1}>
			<Text color={theme.semantic.info} bold>
				{icon} Checkpoint Saved
			</Text>
			{message.text && (
				<Text color={theme.ui.text.dimmed} dimColor>
					{" "}
					({message.text})
				</Text>
			)}
		</Box>
	)
}

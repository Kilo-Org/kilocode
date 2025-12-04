/**
 * Component for displaying resume_task ask messages
 * Shows when a task can be resumed after being interrupted
 */

import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Displays a resume task message
 * This appears when a task was interrupted and can be resumed
 */
export const AskResumeTaskMessage: React.FC<MessageComponentProps> = () => {
	const theme = useTheme()

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.info}>Task was interrupted and can be resumed.</Text>
			</Box>
		</Box>
	)
}

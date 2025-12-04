import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display context condensing status (in progress or complete)
 */
export const SayCondenseContextMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()

	// In progress state
	if (message.partial) {
		return (
			<Box marginY={1}>
				<Text color={theme.semantic.info}>📦 Condensing context...</Text>
			</Box>
		)
	}

	// Complete state
	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.success} bold>
					✓ Context Condensed
				</Text>
			</Box>

			{message.text && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						{message.text}
					</Text>
				</Box>
			)}
		</Box>
	)
}

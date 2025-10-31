import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display command output messages
 */
export const SayCommandOutputMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const text = message.text || ""

	// Don't render if there's no text
	if (!text.trim()) {
		return null
	}

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box width={getBoxWidth(1)} borderStyle="round" borderColor={theme.ui.border.default} paddingX={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					{text}
				</Text>
			</Box>
		</Box>
	)
}

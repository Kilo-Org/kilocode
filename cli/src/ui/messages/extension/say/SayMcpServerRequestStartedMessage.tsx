import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display MCP server request started
 */
export const SayMcpServerRequestStartedMessage: React.FC<MessageComponentProps> = () => {
	const theme = useTheme()
	return (
		<Box marginY={1}>
			<Text color={theme.semantic.info}>⚙ MCP Server Request in progress...</Text>
		</Box>
	)
}

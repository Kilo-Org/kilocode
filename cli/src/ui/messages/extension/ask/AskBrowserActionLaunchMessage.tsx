import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display browser action launch request
 * Approval is handled centrally by useApprovalMonitor in UI.tsx
 */
export const AskBrowserActionLaunchMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()

	const icon = getMessageIcon("ask", "browser_action_launch")

	// Parse browser action data
	let url = ""
	try {
		const data = JSON.parse(message.text || "{}")
		url = data.url || ""
	} catch {
		// Keep empty url
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.warning} bold>
					{icon} Browser Action Request
				</Text>
			</Box>

			{url && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.semantic.info}>URL: {url}</Text>
				</Box>
			)}

			{message.isAnswered && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						✓ Answered
					</Text>
				</Box>
			)}
		</Box>
	)
}

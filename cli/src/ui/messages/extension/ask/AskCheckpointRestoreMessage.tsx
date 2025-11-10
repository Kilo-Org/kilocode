import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { logs } from "../../../../services/logs.js"

/**
 * Display checkpoint restore approval request
 * Approval is handled centrally by useApprovalMonitor in UI.tsx
 */
export const AskCheckpointRestoreMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const icon = getMessageIcon("ask", "checkpoint_restore")

	// Parse checkpoint data from message text
	let confirmationText = message.text || "Restore checkpoint?"
	try {
		const data = JSON.parse(message.text || "{}")
		if (data.confirmationText) {
			confirmationText = data.confirmationText
		}
	} catch (e) {
		logs.error("Failed to parse checkpoint_restore data", "AskCheckpointRestoreMessage", { error: e })
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.warning} bold>
					{icon} Checkpoint Restore
				</Text>
			</Box>

			<Box marginLeft={2} marginTop={1}>
				<Text color={theme.ui.text.primary}>{confirmationText}</Text>
			</Box>

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

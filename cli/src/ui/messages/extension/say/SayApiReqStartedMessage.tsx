import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { parseApiReqInfo } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display API request status (only for failed/cancelled states)
 *
 * In-progress and completed states are no longer shown individually.
 * The total session cost is displayed in the StatusBar instead.
 * This reduces visual noise and provides a cleaner user experience.
 */
export const SayApiReqStartedMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const apiInfo = parseApiReqInfo(message)

	// In-progress state - don't show anything (thinking spinner is enough)
	if (
		message.partial ||
		(!apiInfo?.streamingFailedMessage && !apiInfo?.cancelReason && apiInfo?.cost === undefined)
	) {
		return null
	}

	// Failed state - show error message
	if (apiInfo?.streamingFailedMessage) {
		return (
			<Box flexDirection="column" marginY={1}>
				<Box>
					<Text color={theme.semantic.error} bold>
						✖ API Request failed
					</Text>
				</Box>
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.semantic.error}>{apiInfo.streamingFailedMessage}</Text>
				</Box>
			</Box>
		)
	}

	// Cancelled state - show cancellation message
	if (apiInfo?.cancelReason) {
		return (
			<Box flexDirection="column" marginY={1}>
				<Box>
					<Text color={theme.semantic.warning} bold>
						⚠ API Request cancelled
					</Text>
				</Box>
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						Reason: {apiInfo.cancelReason === "user_cancelled" ? "User cancelled" : apiInfo.cancelReason}
					</Text>
				</Box>
			</Box>
		)
	}

	// Completed state - don't show anything (total cost shown in StatusBar)
	return null
}

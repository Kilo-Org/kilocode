import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { parseApiReqInfo } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display API request status (streaming/completed/failed/cancelled)
 */
export const SayApiReqStartedMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const apiInfo = parseApiReqInfo(message)

	// In-progress state
	// NOTE: api_req_started is often sent as a non-partial placeholder before cost/usage is known.
	// In the CLI we treat "no completion indicators" as still in progress.
	if (
		message.partial ||
		(!apiInfo?.streamingFailedMessage && !apiInfo?.cancelReason && apiInfo?.cost === undefined)
	) {
		return (
			<Box marginY={1}>
				<Text color={theme.semantic.info}>⟳ API Request in progress...</Text>
			</Box>
		)
	}

	// Failed state
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

	// Cancelled state
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

	// Completed state
	return (
		<Box marginY={1}>
			<Text color={theme.semantic.success} bold>
				✓ API Request
			</Text>
			{apiInfo?.cost !== undefined && (
				<>
					<Text color={theme.semantic.info}> - Cost: ${apiInfo.cost.toFixed(4)}</Text>
					{apiInfo.usageMissing && (
						<Text color={theme.ui.text.dimmed} dimColor>
							{" "}
							(estimated)
						</Text>
					)}
				</>
			)}
		</Box>
	)
}

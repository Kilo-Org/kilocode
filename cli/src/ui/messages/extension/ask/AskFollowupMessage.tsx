import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon, parseFollowUpData } from "../utils.js"
import { useFollowupCIResponse } from "../../../../state/hooks/useFollowupCIResponse.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display follow-up question with numbered suggestions
 *
 * Follow-up questions do NOT require approval - they're just questions from the AI.
 * In CI mode, we automatically respond to tell the AI to proceed autonomously.
 */
export const AskFollowupMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	// Handle CI mode auto-response (not approval)
	useFollowupCIResponse(message)

	const icon = getMessageIcon("ask", "followup")
	const data = parseFollowUpData(message)

	if (!data) {
		return (
			<Box marginY={1}>
				<Text color={theme.semantic.warning} bold>
					{icon} {message.text || "Follow-up question"}
				</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.warning} bold>
					{icon} {data.question}
				</Text>
			</Box>

			{data.suggest && data.suggest.length > 0 && (
				<Box flexDirection="column" marginLeft={2} marginTop={1}>
					<Text color={theme.ui.text.dimmed} dimColor>
						Suggestions:
					</Text>
					{data.suggest.map((suggestion, index) => (
						<Box key={index} marginLeft={1} marginTop={index > 0 ? 0 : 1}>
							<Text color={theme.semantic.info}>
								{index + 1}. {suggestion.answer}
							</Text>
							{suggestion.mode && (
								<Text color={theme.ui.text.dimmed} dimColor>
									{" "}
									(switch to {suggestion.mode})
								</Text>
							)}
						</Box>
					))}
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

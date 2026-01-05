import React from "react"
import { Box, Text } from "ink"
import type { MessageComponentProps } from "./types.js"
import { formatUnknownMessageContent } from "./utils.js"
import { useTheme } from "../../../state/hooks/useTheme.js"
import {
	SayTextMessage,
	SayErrorMessage,
	SayDiffErrorMessage,
	SaySubtaskResultMessage,
	SayReasoningMessage,
	SayApiReqStartedMessage,
	SayUserFeedbackMessage,
	SayUserFeedbackDiffMessage,
	SayCompletionResultMessage,
	SayShellIntegrationWarningMessage,
	SayCheckpointSavedMessage,
	SayCondenseContextMessage,
	SayCondenseContextErrorMessage,
	SayCodebaseSearchResultMessage,
	SayBrowserActionResultMessage,
	SayUserEditTodosMessage,
	SayImageMessage,
	SayMcpServerRequestStartedMessage,
	SayMcpServerResponseMessage,
	SayApiReqFinishedMessage,
	SayApiReqRetryDelayedMessage,
} from "./say/index.js"

/**
 * Default component for unknown say message types
 * Handles graceful fallback for unknown or future say types
 */
export const DefaultSayMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const displayContent = formatUnknownMessageContent(message.text, `Unknown say type: ${message.say}`)

	return (
		<Box marginY={1}>
			<Text color={theme.semantic.success}>{displayContent}</Text>
		</Box>
	)
}

/**
 * Routes say messages to appropriate components based on message.say value
 */
export const SayMessageRouter: React.FC<MessageComponentProps> = ({ message }) => {
	switch (message.say) {
		case "text":
			return <SayTextMessage message={message} />

		case "error":
			return <SayErrorMessage message={message} />

		case "diff_error":
			return <SayDiffErrorMessage message={message} />

		case "subtask_result":
			return <SaySubtaskResultMessage message={message} />

		case "reasoning":
			return <SayReasoningMessage message={message} />

		case "api_req_started":
			return <SayApiReqStartedMessage message={message} />

		case "user_feedback":
			return <SayUserFeedbackMessage message={message} />

		case "user_feedback_diff":
			return <SayUserFeedbackDiffMessage message={message} />

		case "completion_result":
			return <SayCompletionResultMessage message={message} />

		case "shell_integration_warning":
			return <SayShellIntegrationWarningMessage message={message} />

		case "checkpoint_saved":
			return <SayCheckpointSavedMessage message={message} />

		case "condense_context":
			return <SayCondenseContextMessage message={message} />

		case "condense_context_error":
			return <SayCondenseContextErrorMessage message={message} />

		case "codebase_search_result":
			return <SayCodebaseSearchResultMessage message={message} />

		case "browser_action_result":
			return <SayBrowserActionResultMessage message={message} />

		case "user_edit_todos":
			return <SayUserEditTodosMessage message={message} />

		case "image":
			return <SayImageMessage message={message} />

		case "mcp_server_request_started":
			return <SayMcpServerRequestStartedMessage message={message} />

		case "mcp_server_response":
			return <SayMcpServerResponseMessage message={message} />

		case "api_req_finished":
			return <SayApiReqFinishedMessage message={message} />

		case "api_req_retry_delayed":
			return <SayApiReqRetryDelayedMessage message={message} />

		case "command_output":
			return null // Handled in AskMessageRouter

		default:
			return <DefaultSayMessage message={message} />
	}
}

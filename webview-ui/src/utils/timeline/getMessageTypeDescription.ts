import type { ClineMessage } from "@roo-code/types"

/**
 * Get a human-readable description of a message type for the task timeline
 */
export function getMessageTypeDescription(message: ClineMessage | ClineMessage[], t: any): string {
	const singleMessage = Array.isArray(message) ? message[0] : message
	if (!singleMessage) {
		return t("kilocode:taskTimeline.tooltip.messageTypes.unknown")
	}

	let messageTypeKey: string

	if (singleMessage.type === "ask") {
		switch (singleMessage.ask) {
			case "command":
				messageTypeKey = "command"
				break
			case "completion_result":
				messageTypeKey = "completion_result"
				break
			case "followup":
				messageTypeKey = "followup"
				break
			case "tool":
				messageTypeKey = "tool"
				break
			case "browser_action_launch":
				messageTypeKey = "browser_action_launch"
				break
			case "use_mcp_server":
				messageTypeKey = "use_mcp_server"
				break
			case "condense":
				messageTypeKey = "condense"
				break
			default:
				messageTypeKey = "unknown"
		}
	} else if (singleMessage.type === "say") {
		switch (singleMessage.say) {
			case "text":
				messageTypeKey = "text"
				break
			case "reasoning":
				messageTypeKey = "reasoning"
				break
			case "error":
				messageTypeKey = "error"
				break
			case "command_output":
				messageTypeKey = "command_output"
				break
			case "completion_result":
				messageTypeKey = "completion_result"
				break
			case "browser_action":
				messageTypeKey = "browser_action"
				break
			case "browser_action_result":
				messageTypeKey = "browser_action_result"
				break
			case "mcp_server_response":
				messageTypeKey = "mcp_server_response"
				break
			case "checkpoint_saved":
				messageTypeKey = "checkpoint_saved"
				break
			case "condense_context":
				messageTypeKey = "condense_context"
				break
			case "user_feedback":
			case "user_feedback_diff":
				messageTypeKey = "user"
				break
			default:
				messageTypeKey = "unknown"
		}
	} else {
		messageTypeKey = "unknown"
	}

	return t(`kilocode:taskTimeline.tooltip.messageTypes.${messageTypeKey}`)
}

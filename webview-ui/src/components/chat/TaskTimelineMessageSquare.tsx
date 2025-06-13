import { memo } from "react"
import type { ClineMessage } from "@roo-code/types"

export interface MessageSquareData {
	index: number
	color: string
	isActive: boolean
	message: ClineMessage | ClineMessage[]
	isNew: boolean
}

export const getMessageTypeColor = (message: ClineMessage | ClineMessage[]): string => {
	if (Array.isArray(message)) {
		return "bg-cyan-400" // Cyan for grouped messages
	}

	const singleMessage = message as ClineMessage
	if (singleMessage.type === "ask") {
		switch (singleMessage.ask) {
			case "followup":
				return "bg-gray-300" // Light gray for user messages
			case "command":
				return "bg-purple-500" // Purple for command approvals
			case "tool":
				// Parse tool data for more specific coloring
				if (singleMessage.text) {
					try {
						const toolData = JSON.parse(singleMessage.text)
						if (
							toolData.tool === "read_file" ||
							toolData.tool === "list_files" ||
							toolData.tool === "list_code_definition_names" ||
							toolData.tool === "search_files"
						) {
							return "bg-yellow-300" // Yellow for file read operations
						} else if (toolData.tool === "apply_diff" || toolData.tool === "write_to_file") {
							return "bg-blue-500" // Blue for file edit/create operations
						} else if (toolData.tool === "browser_action") {
							return "bg-purple-500" // Purple for browser actions
						}
					} catch (_e) {
						// JSON parse error, use default
					}
				}
				return "bg-yellow-300" // Default yellow for tool approvals
			case "browser_action_launch":
				return "bg-purple-500" // Purple for browser launch approvals
			case "use_mcp_server":
				return "bg-orange-400" // Orange for MCP server
			case "api_req_failed":
				return "bg-red-500" // Red for errors
			case "completion_result":
				return "bg-green-500" // Green for task completion
			default:
				return "bg-gray-400" // Dark gray for unknown
		}
	}

	// Handle say types
	if (singleMessage.type === "say") {
		switch (singleMessage.say) {
			case "text":
				return "bg-gray-300" // Light gray for assistant responses
			case "command_output":
				return "bg-purple-500" // Purple for terminal commands
			case "completion_result":
				return "bg-green-500" // Green for task success
			case "reasoning":
				return "bg-gray-300" // Light gray for AI reasoning
			case "api_req_started":
				return "bg-orange-400" // Orange for API requests
			case "mcp_server_response":
				return "bg-orange-400" // Orange for MCP server responses
			case "error":
				return "bg-red-500" // Red for errors
			default:
				return "bg-gray-400" // Dark gray for unknown
		}
	}

	return "bg-gray-400" // Fallback
}

export const getMessageTypeDescription = (message: ClineMessage | ClineMessage[], t: any): string => {
	if (Array.isArray(message)) {
		return t("kilocode:taskTimeline.tooltip.messageTypes.unknown")
	}

	const singleMessage = message as ClineMessage
	let messageType: string

	if (singleMessage.type === "ask") {
		messageType = singleMessage.ask || "unknown"

		// For tool messages, try to get more specific type from JSON
		if (messageType === "tool" && singleMessage.text) {
			try {
				const toolData = JSON.parse(singleMessage.text)
				if (toolData.tool === "browser_action") {
					messageType = "browser_action"
				}
				// Keep as "tool" for other tool types
			} catch (_e) {
				// JSON parse error, keep as "tool"
			}
		}
	} else if (singleMessage.type === "say") {
		messageType = singleMessage.say || "unknown"
	} else {
		messageType = "unknown"
	}

	// Use direct message type as translation key
	const translationKey = `kilocode:taskTimeline.tooltip.messageTypes.${messageType}`

	// Try the translation, fallback to unknown if it doesn't exist
	try {
		return t(translationKey)
	} catch {
		return t("kilocode:taskTimeline.tooltip.messageTypes.unknown")
	}
}

export const TaskTimelineMessageSquare = memo(
	({ data, t, onClick }: { data: MessageSquareData; t: any; onClick?: () => void }) => {
		const messageDescription = getMessageTypeDescription(data.message, t)
		const tooltip = t("kilocode:taskTimeline.tooltip.clickToScroll", {
			messageType: messageDescription,
			messageNumber: data.index + 1,
		})

		return (
			<div
				className={`
				w-3 h-3 rounded-xs cursor-pointer transition-all duration-200 flex-shrink-0
				${data.color}
				hover:opacity-80
				${data.isActive ? "animate-slow-pulse" : ""}
				${data.isNew ? "animate-fade-in" : ""}
			`}
				onClick={onClick}
				title={tooltip}
			/>
		)
	},
)

TaskTimelineMessageSquare.displayName = "TaskTimelineMessageSquare"

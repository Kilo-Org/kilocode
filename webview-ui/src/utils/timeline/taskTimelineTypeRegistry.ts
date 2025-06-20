import type { ClineMessage } from "@roo-code/types"

export interface TaskTimelineMessageTypeConfig {
	color: string
	translationKey: string
}

const taskTimelineColorsByType = {
	USER_INTERACTION: "bg-[var(--vscode-chat-editedFileForeground)]", // Tan/orange for all 'ask' types
	SYSTEM_READ: "bg-[var(--vscode-textLink-foreground)]", // Light blue for file reads
	SYSTEM_WRITE: "bg-[var(--vscode-focusBorder)]", // Dark blue for file writes
	SYSTEM_GENERAL_TOOL: "bg-[var(--vscode-activityBarBadge-background)]", // Blue for browser/server tools
	SUCCESS: "bg-[var(--vscode-editorGutter-addedBackground)]", // Green for success
	ERROR: "bg-[var(--vscode-errorForeground)]", // Red for errors
	ASSISTANT_MUTTERING: "bg-[var(--vscode-descriptionForeground)]", // Gray for reasoning/text
	GROUPED: "bg-[var(--vscode-textLink-activeForeground)]", // Cyan for grouped messages
	DEFAULT: "bg-[var(--vscode-badge-background)]", // Fallback gray
}

/**
 * Registry of message types that should be shown in the task timeline.
 * If a message type is not in this registry, it will be filtered out.
 * This serves as the single source of truth for task timeline message configuration.
 */
export const TASK_TIMELINE_MESSAGE_TYPES: Record<string, TaskTimelineMessageTypeConfig> = {
	// Ask types that should be shown (everything except the filtered ones)
	"ask:tool": {
		color: taskTimelineColorsByType.SYSTEM_GENERAL_TOOL,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.tool",
	},
	"ask:completion_result": {
		color: taskTimelineColorsByType.SUCCESS,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.completion_result",
	},
	"ask:browser_action_launch": {
		color: taskTimelineColorsByType.SYSTEM_GENERAL_TOOL,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.browser_action_launch",
	},
	"ask:use_mcp_server": {
		color: taskTimelineColorsByType.SYSTEM_GENERAL_TOOL,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.use_mcp_server",
	},
	"ask:followup": {
		color: taskTimelineColorsByType.USER_INTERACTION,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.followup",
	},
	"ask:command": {
		color: taskTimelineColorsByType.USER_INTERACTION,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.command",
	},

	// Say types that should be shown (everything except the filtered ones)
	"say:text": {
		color: taskTimelineColorsByType.ASSISTANT_MUTTERING,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.text",
	},
	"say:reasoning": {
		color: taskTimelineColorsByType.ASSISTANT_MUTTERING,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.reasoning",
	},
	"say:mcp_server_response": {
		color: taskTimelineColorsByType.SYSTEM_GENERAL_TOOL,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.mcp_server_response",
	},
	"say:command_output": {
		color: taskTimelineColorsByType.SYSTEM_GENERAL_TOOL,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.command_output",
	},
	"say:browser_action": {
		color: taskTimelineColorsByType.SYSTEM_GENERAL_TOOL,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.browser_action",
	},
	"say:browser_action_result": {
		color: taskTimelineColorsByType.SYSTEM_GENERAL_TOOL,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.browser_action_result",
	},
	"say:completion_result": {
		color: taskTimelineColorsByType.SUCCESS,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.completion_result",
	},
	"say:error": {
		color: taskTimelineColorsByType.ERROR,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.error",
	},
	"say:checkpoint_saved": {
		color: taskTimelineColorsByType.SUCCESS,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.checkpoint_saved",
	},
	"say:condense_context": {
		color: taskTimelineColorsByType.ASSISTANT_MUTTERING,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.condense_context",
	},
	"say:user_feedback": {
		color: taskTimelineColorsByType.USER_INTERACTION,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.user",
	},
	"say:user_feedback_diff": {
		color: taskTimelineColorsByType.USER_INTERACTION,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.user",
	},
	"ask:condense": {
		color: taskTimelineColorsByType.ASSISTANT_MUTTERING,
		translationKey: "kilocode:taskTimeline.tooltip.messageTypes.condense",
	},
}

/**
 * Gets the message type key for registry lookup
 */
export function getTaskTimelineMessageTypeKey(message: ClineMessage): string {
	if (message.type === "ask") {
		return `ask:${message.ask || "unknown"}`
	} else if (message.type === "say") {
		return `say:${message.say || "unknown"}`
	}
	return "unknown"
}

/**
 * Get a human-readable description of a message type for the task timeline
 */
export function getMessageTypeDescription(message: ClineMessage | ClineMessage[], t: any): string {
	const singleMessage = Array.isArray(message) ? message[0] : message
	if (!singleMessage) {
		return t("kilocode:taskTimeline.tooltip.messageTypes.unknown")
	}

	const messageKey = getTaskTimelineMessageTypeKey(singleMessage)
	const config = TASK_TIMELINE_MESSAGE_TYPES[messageKey]
	const translationKey = config ? config.translationKey : "kilocode:taskTimeline.tooltip.messageTypes.unknown"

	return t(translationKey)
}

/**
 * Detects if a tool operation is a file read/write operation
 */
export function isFileOperation(message: ClineMessage): { isFile: boolean; isWrite: boolean } {
	if (message.ask === "tool" && message.text) {
		try {
			const toolData = JSON.parse(message.text)
			const toolName = toolData.tool?.toLowerCase() || ""

			if (
				toolName.includes("read_file") ||
				toolName.includes("write_to_file") ||
				toolName.includes("apply_diff") ||
				toolName.includes("insert_content")
			) {
				const isWrite = toolName.includes("write") || toolName.includes("apply") || toolName.includes("insert")
				return { isFile: true, isWrite }
			}
		} catch (_e) {
			console.error("Failed to parse message text JSON - cannot determine if message contained toolData", message)
		}
	}
	return { isFile: false, isWrite: false }
}

/**
 * Gets the color for a task timeline message, with special handling for file operations and grouped messages
 */
export function getTaskTimelineMessageColor(message: ClineMessage | ClineMessage[]): string {
	if (Array.isArray(message)) {
		return taskTimelineColorsByType.GROUPED
	}

	const singleMessage = message as ClineMessage
	const messageKey = getTaskTimelineMessageTypeKey(singleMessage)

	// Special handling for file operations
	if (singleMessage.type === "ask") {
		const fileOp = isFileOperation(singleMessage)
		if (fileOp.isFile) {
			return fileOp.isWrite ? taskTimelineColorsByType.SYSTEM_WRITE : taskTimelineColorsByType.SYSTEM_READ
		}
	}

	// Use registry color or fallback to default
	const config = TASK_TIMELINE_MESSAGE_TYPES[messageKey]
	return config ? config.color : taskTimelineColorsByType.DEFAULT
}

export { taskTimelineColorsByType as taskTimelineColorPalette }

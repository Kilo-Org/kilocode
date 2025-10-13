import type { ExtensionChatMessage } from "../../../types/messages.js"
import type { ToolData, McpServerData, FollowUpData, ApiReqInfo, ImageData } from "./types.js"

/**
 * Parse JSON from message text safely
 */
export function parseMessageJson<T = any>(text?: string): T | null {
	if (!text) return null
	try {
		return JSON.parse(text) as T
	} catch {
		return null
	}
}

/**
 * Parse tool data from message
 */
export function parseToolData(message: ExtensionChatMessage): ToolData | null {
	return parseMessageJson<ToolData>(message.text)
}

/**
 * Parse MCP server data from message
 */
export function parseMcpServerData(message: ExtensionChatMessage): McpServerData | null {
	return parseMessageJson<McpServerData>(message.text)
}

/**
 * Parse follow-up data from message
 * Checks both text and metadata fields
 */
export function parseFollowUpData(message: ExtensionChatMessage): FollowUpData | null {
	// Try parsing from text first
	const fromText = parseMessageJson<FollowUpData>(message.text)
	if (fromText) return fromText

	// Try parsing from metadata
	if (message.metadata) {
		// If metadata is already an object, return it
		if (typeof message.metadata === "object" && message.metadata !== null) {
			return message.metadata as FollowUpData
		}
		// If metadata is a string, try parsing it
		if (typeof message.metadata === "string") {
			return parseMessageJson<FollowUpData>(message.metadata)
		}
	}

	return null
}

/**
 * Parse API request info from message
 */
export function parseApiReqInfo(message: ExtensionChatMessage): ApiReqInfo | null {
	return parseMessageJson<ApiReqInfo>(message.text)
}

/**
 * Parse image data from message
 */
export function parseImageData(message: ExtensionChatMessage): ImageData | null {
	return parseMessageJson<ImageData>(message.text)
}

/**
 * Get icon for message type
 */
export function getMessageIcon(type: "ask" | "say", subtype?: string): string {
	if (type === "ask") {
		switch (subtype) {
			case "tool":
				return "⚙"
			case "mistake_limit_reached":
				return "✖"
			case "command":
				return "$"
			case "use_mcp_server":
				return "⚙"
			case "completion_result":
				return "✓"
			case "followup":
				return "?"
			case "condense":
				return "📦"
			case "payment_required_prompt":
				return "💳"
			case "invalid_model":
				return "⚠"
			case "report_bug":
				return "🐛"
			case "auto_approval_max_req_reached":
				return "⚠"
			default:
				return "?"
		}
	} else {
		switch (subtype) {
			case "error":
				return "✖"
			case "diff_error":
				return "⚠"
			case "completion_result":
				return "✓"
			case "api_req_started":
				return "⟳"
			case "checkpoint_saved":
				return "💾"
			case "codebase_search_result":
				return "🔍"
			case "image":
				return "🖼"
			default:
				return ">"
		}
	}
}

/**
 * Get color for message type
 */
export function getMessageColor(type: "ask" | "say", subtype?: string): string {
	if (type === "ask") {
		return "yellow"
	}

	switch (subtype) {
		case "error":
		case "diff_error":
			return "red"
		case "completion_result":
			return "green"
		case "api_req_started":
			return "cyan"
		default:
			return "green"
	}
}

/**
 * Get tool icon
 */
export function getToolIcon(tool: string): string {
	switch (tool) {
		case "editedExistingFile":
		case "appliedDiff":
			return "±"
		case "insertContent":
			return "+"
		case "searchAndReplace":
			return "⇄"
		case "newFileCreated":
			return "📄"
		case "readFile":
			return "📝"
		case "generateImage":
			return "🖼"
		case "listFilesTopLevel":
		case "listFilesRecursive":
			return "📁"
		case "listCodeDefinitionNames":
			return "📝"
		case "searchFiles":
		case "codebaseSearch":
			return "🔍"
		case "updateTodoList":
			return "☐"
		case "switchMode":
			return "⚡"
		case "newTask":
			return "📋"
		case "finishTask":
			return "✓✓"
		case "fetchInstructions":
			return "📖"
		case "runSlashCommand":
			return "▶"
		default:
			return "⚙"
	}
}

/**
 * Truncate text to max length
 */
export function truncateText(text: string, maxLength: number = 100): string {
	if (text.length <= maxLength) return text
	return text.substring(0, maxLength - 3) + "..."
}

/**
 * Format file path for display
 */
export function formatFilePath(path: string): string {
	// Remove leading ./ if present
	return path.replace(/^\.\//, "")
}

/**
 * Check if message has JSON content
 */
export function hasJsonContent(message: ExtensionChatMessage): boolean {
	if (!message.text) return false
	try {
		JSON.parse(message.text)
		return true
	} catch {
		return false
	}
}

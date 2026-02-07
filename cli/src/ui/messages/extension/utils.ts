import { z } from "zod"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import type { ToolData, McpServerData, FollowUpData, ApiReqInfo, ImageData } from "./types.js"

/**
 * Parse JSON from message text safely
 */
export function parseMessageJson<T = unknown>(text?: string): T | null {
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
 * Zod schema for MCP server data validation
 */
const McpServerDataSchema = z.object({
	type: z.enum(["use_mcp_tool", "access_mcp_resource"]),
	serverName: z.string(),
	toolName: z.string().optional(),
	arguments: z.string().optional(),
	uri: z.string().optional(),
	response: z.any().optional(),
})

/**
 * Type guard to check if an object is valid McpServerData
 * Uses Zod for validation
 */
export function isMcpServerData(obj: unknown): obj is McpServerData {
	return McpServerDataSchema.safeParse(obj).success
}

/**
 * Parse MCP server data from message with Zod validation
 */
export function parseMcpServerData(message: ExtensionChatMessage): McpServerData | null {
	const parsed = parseMessageJson(message.text)
	const result = McpServerDataSchema.safeParse(parsed)
	return result.success ? (result.data as McpServerData) : null
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
		case "deleteFile":
			return "🗑️"
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
	// Trim whitespace and remove leading ./ if present
	return path.trim().replace(/^\.\//, "")
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

/**
 * Format JSON string with indentation
 */
export function formatJson(jsonString: string, indent: number = 2): string | null {
	try {
		const parsed = JSON.parse(jsonString)
		return JSON.stringify(parsed, null, indent)
	} catch {
		return null
	}
}

/**
 * Format content for unknown message types
 * If the text looks like JSON (starts with { or [), try to parse and pretty-print it.
 * Otherwise, return the text as-is.
 *
 * @param text - The message text to format
 * @param fallback - Fallback text if text is empty/undefined
 * @returns Formatted display content
 */
export function formatUnknownMessageContent(text: string | undefined, fallback: string): string {
	if (!text) {
		return fallback
	}

	const trimmed = text.trim()
	// Only attempt JSON parsing if it looks like JSON
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(text)
			return JSON.stringify(parsed, null, 2)
		} catch {
			// Not valid JSON, return as-is
			return text
		}
	}

	return text
}

/**
 * Approximate byte size of string for display purposes
 * Uses 3x multiplier as conservative estimate (handles ASCII, UTF-8, emoji)
 *
 * @param str - The string to measure
 * @returns Approximate byte size
 */
function approximateByteSize(str: string): number {
	return str.length * 3
}

/**
 * Format content with JSON detection and optional preview
 */
export interface FormattedContent {
	isJson: boolean
	content: string
	lineCount: number
	charCount: number
	byteSize: number
	isPreview: boolean
	hiddenLines: number
}

export function formatContentWithMetadata(
	text: string,
	maxLines: number = 20,
	previewLines: number = 5,
): FormattedContent {
	if (!text) {
		return {
			isJson: false,
			content: "",
			lineCount: 0,
			charCount: 0,
			byteSize: 0,
			isPreview: false,
			hiddenLines: 0,
		}
	}

	// Try to format as JSON
	let content = text
	let isJson = false
	const formatted = formatJson(text)
	if (formatted) {
		content = formatted
		isJson = true
	}

	// Count lines
	const lines = content.split("\n")
	const lineCount = lines.length
	const charCount = content.length
	const byteSize = approximateByteSize(content)

	// Determine if preview is needed
	const isPreview = lineCount > maxLines
	const hiddenLines = isPreview ? lineCount - previewLines : 0

	// Create preview if needed
	if (isPreview) {
		const previewContent = lines.slice(0, previewLines).join("\n")
		content = previewContent
	}

	return {
		isJson,
		content,
		lineCount,
		charCount,
		byteSize,
		isPreview,
		hiddenLines,
	}
}

/**
 * Format byte size for display
 * Adds ~ prefix for approximations (KB/MB)
 */
export function formatByteSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `~${(bytes / 1024).toFixed(1)} KB`
	return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Build metadata string for content
 */
export function buildMetadataString(metadata: FormattedContent): string {
	const parts: string[] = []

	// Content type
	parts.push(metadata.isJson ? "JSON" : "Text")

	// Line count
	parts.push(`${metadata.lineCount} line${metadata.lineCount !== 1 ? "s" : ""}`)

	// Size if > 1KB
	if (metadata.byteSize >= 1024) {
		parts.push(formatByteSize(metadata.byteSize))
	}

	return parts.join(", ")
}

import { ToolName } from "@roo-code/types"
import { ToolUse } from "../../../shared/tools"

/**
 * Represents a native tool call from OpenAI-compatible APIs
 */
export interface NativeToolCall {
	index?: number // OpenAI uses index to track across streaming deltas
	id?: string // Only present in first delta
	type?: string
	function?: {
		name: string
		arguments: string // JSON string (may be partial during streaming)
	}
}

/**
 * Recursively parse any string values that appear to be JSON-encoded.
 * This handles cases where the model double-encodes parameters.
 *
 * @param obj - The object to process
 * @returns The object with any double-encoded strings parsed
 */
export function parseDoubleEncodedParams(obj: any): any {
	if (obj === null || obj === undefined) {
		return obj
	}

	// If it's a string that looks like JSON, try to parse it
	if (typeof obj === "string") {
		const trimmed = obj.trim()
		if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
			try {
				const parsed = JSON.parse(obj)
				// Recursively process the parsed value in case it has more double-encoding
				// console.debug("[AssistantMessageParser] Parsed double-encoded JSON:", JSON.stringify(parsed))
				return parseDoubleEncodedParams(parsed)
			} catch {
				// Not valid JSON, return as-is
				return obj
			}
		}
		return obj
	}

	// If it's an array, recursively process each element
	if (Array.isArray(obj)) {
		return obj.map((item) => parseDoubleEncodedParams(item))
	}

	// If it's an object, recursively process each property
	if (typeof obj === "object") {
		const result: Record<string, any> = {}
		for (const [key, value] of Object.entries(obj)) {
			result[key] = parseDoubleEncodedParams(value)
		}
		return result
	}

	// Primitive types (number, boolean, etc.) return as-is
	return obj
}

const NATIVE_MCP_TOOL_PREFIX = "use_mcp_tool___"
const NATIVE_MCP_TOOL_SEPARATOR = "___"

/**
 * Check if a tool name is a dynamic MCP tool (starts with "use_mcp_tool_")
 */
function isDynamicMcpTool(toolName: string): boolean {
	return toolName.startsWith(NATIVE_MCP_TOOL_PREFIX)
}

/**
 * Extract server name and tool name from dynamic MCP tool names.
 * Format: use_mcp_tool___{serverName}___{toolName}
 * Uses triple underscores as separator to allow underscores in tool names.
 * Returns null if the format is invalid.
 */
export function extractMcpToolInfo(toolName: string): { serverName: string; toolName: string } | null {
	if (!isDynamicMcpTool(toolName)) {
		return null
	}

	// Remove the prefix
	const remainder = toolName.slice(NATIVE_MCP_TOOL_PREFIX.length)

	// Find first triple underscore to split server name and tool name

	const firstSeparatorIndex = remainder.indexOf(NATIVE_MCP_TOOL_SEPARATOR)

	if (firstSeparatorIndex === -1) {
		return null // Invalid format
	}

	const serverName = remainder.slice(0, firstSeparatorIndex)
	const extractedToolName = remainder.slice(firstSeparatorIndex + NATIVE_MCP_TOOL_SEPARATOR.length)

	if (!serverName || !extractedToolName) {
		return null // Invalid format
	}

	return { serverName, toolName: extractedToolName }
}

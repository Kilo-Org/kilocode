/**
 * Utilities for sanitizing MCP server and tool names to conform to
 * API function name requirements across all providers.
 */

/**
 * Separator used between MCP prefix, server name, and tool name.
 * We use "--" (double hyphen) because:
 * 1. It's allowed by all providers (dashes are permitted in function names)
 * 2. It won't conflict with underscores in sanitized server/tool names
 * 3. It's unique enough to be a reliable delimiter for parsing
 */
export const MCP_TOOL_SEPARATOR = "--"

/**
 * Prefix for all MCP tool function names.
 */
export const MCP_TOOL_PREFIX = "mcp"

/**
 * Encoding for hyphens in tool names.
 * We use triple underscores because:
 * 1. It's unlikely to appear naturally in tool names
 * 2. It's safe for all API providers
 * 3. It allows us to preserve hyphens through the encoding/decoding process
 *
 * This solves the problem where models (especially Claude) convert hyphens to underscores
 * in tool names when using native tool calling. By encoding hyphens as triple underscores,
 * we can decode them back to hyphens when parsing the tool name.
 */
export const HYPHEN_ENCODING = "___"

/**
 * Normalize an MCP tool name by converting underscore separators back to hyphens.
 * This handles the case where models (especially Claude) convert hyphens to underscores
 * in tool names when using native tool calling.
 *
 * For example: "mcp__server__tool" -> "mcp--server--tool"
 *
 * @param toolName - The tool name that may have underscore separators
 * @returns The normalized tool name with hyphen separators
 */
export function normalizeMcpToolName(toolName: string): string {
	// Only normalize if it looks like an MCP tool with underscore separators
	if (toolName.startsWith("mcp__")) {
		// Replace double underscores with double hyphens for the separators
		// We need to be careful to only replace the separators, not the encoded hyphens (triple underscores)
		// Pattern: mcp__server__tool -> mcp--server--tool
		// But: mcp__server__tool___name should become mcp--server--tool___name (preserve triple underscores)

		// First, temporarily replace triple underscores with a placeholder
		const placeholder = "\x00HYPHEN\x00"
		let normalized = toolName.replace(/___/g, placeholder)

		// Now replace double underscores (separators) with double hyphens
		normalized = normalized.replace(/__/g, "--")

		// Restore triple underscores from placeholder
		normalized = normalized.replace(new RegExp(placeholder, "g"), "___")

		return normalized
	}
	return toolName
}

/**
 * Check if a tool name is an MCP tool (starts with the MCP prefix and separator).
 *
 * @param toolName - The tool name to check
 * @returns true if the tool name starts with "mcp--", false otherwise
 */
export function isMcpTool(toolName: string): boolean {
	return toolName.startsWith(`${MCP_TOOL_PREFIX}${MCP_TOOL_SEPARATOR}`)
}

/**
 * Sanitize a name to be safe for use in API function names.
 * This removes special characters, ensures the name starts correctly,
 * and encodes hyphens as triple underscores to preserve them through
 * the model's tool calling process.
 *
 * @param name - The original name (e.g., MCP server name or tool name)
 * @returns A sanitized name that conforms to API requirements
 */
export function sanitizeMcpName(name: string): string {
	if (!name) {
		return "_"
	}

	// Replace spaces with underscores first
	let sanitized = name.replace(/\s+/g, "_")

	// Only allow alphanumeric, underscores, and dashes
	sanitized = sanitized.replace(/[^a-zA-Z0-9_\-]/g, "")

	// Replace any double-hyphen sequences with single hyphen to avoid separator conflicts
	sanitized = sanitized.replace(/--+/g, "-")

	// Encode single hyphens as triple underscores to preserve them
	// This allows us to decode them back to hyphens when parsing
	// e.g., "atlassian-jira_search" -> "atlassian___jira_search"
	sanitized = sanitized.replace(/-/g, HYPHEN_ENCODING)

	// Ensure the name starts with a letter or underscore
	if (sanitized.length > 0 && !/^[a-zA-Z_]/.test(sanitized)) {
		sanitized = "_" + sanitized
	}

	// If empty after sanitization, use a placeholder
	if (!sanitized) {
		sanitized = "_unnamed"
	}

	return sanitized
}

/**
 * Build a full MCP tool function name from server and tool names.
 * The format is: mcp--{sanitized_server_name}--{sanitized_tool_name}
 *
 * The total length is capped at 64 characters to conform to API limits.
 *
 * @param serverName - The MCP server name
 * @param toolName - The tool name
 * @returns A sanitized function name in the format mcp--serverName--toolName
 */
export function buildMcpToolName(serverName: string, toolName: string): string {
	const sanitizedServer = sanitizeMcpName(serverName)
	const sanitizedTool = sanitizeMcpName(toolName)

	// Build the full name: mcp--{server}--{tool}
	const fullName = `${MCP_TOOL_PREFIX}${MCP_TOOL_SEPARATOR}${sanitizedServer}${MCP_TOOL_SEPARATOR}${sanitizedTool}`

	// Truncate if necessary (max 64 chars for Gemini)
	if (fullName.length > 64) {
		return fullName.slice(0, 64)
	}

	return fullName
}

/**
 * Decode a sanitized name back to its original form by converting
 * triple underscores back to hyphens.
 *
 * @param sanitizedName - The sanitized name with encoded hyphens
 * @returns The decoded name with hyphens restored
 */
export function decodeMcpName(sanitizedName: string): string {
	return sanitizedName.replace(new RegExp(HYPHEN_ENCODING, "g"), "-")
}

/**
 * Parse an MCP tool function name back into server and tool names.
 * This handles sanitized names by splitting on the "--" separator
 * and decoding triple underscores back to hyphens.
 *
 * @param mcpToolName - The full MCP tool name (e.g., "mcp--weather--get_forecast")
 * @returns An object with serverName and toolName, or null if parsing fails
 */
export function parseMcpToolName(mcpToolName: string): { serverName: string; toolName: string } | null {
	const prefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR
	if (!mcpToolName.startsWith(prefix)) {
		return null
	}

	// Remove the "mcp--" prefix
	const remainder = mcpToolName.slice(prefix.length)

	// Split on the separator to get server and tool names
	const separatorIndex = remainder.indexOf(MCP_TOOL_SEPARATOR)
	if (separatorIndex === -1) {
		return null
	}

	const serverName = remainder.slice(0, separatorIndex)
	const toolName = remainder.slice(separatorIndex + MCP_TOOL_SEPARATOR.length)

	if (!serverName || !toolName) {
		return null
	}

	// Decode triple underscores back to hyphens
	return {
		serverName: decodeMcpName(serverName),
		toolName: decodeMcpName(toolName),
	}
}

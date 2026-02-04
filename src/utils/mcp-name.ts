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
 * Normalize a string for comparison by treating hyphens and underscores as equivalent.
 * This is used to match tool names when models convert hyphens to underscores.
 *
 * @param name - The name to normalize
 * @returns The normalized name with all hyphens converted to underscores
 */
export function normalizeForComparison(name: string): string {
	return name.replace(/-/g, "_")
}

/**
 * Normalize an MCP tool name by converting underscore separators back to hyphens.
 * This handles the case where models (especially Claude) convert hyphens to underscores
 * in tool names when using native tool calling.
 *
 * For example: "mcp__server__tool" -> "mcp--server--tool"
 *
 * This function uses fuzzy matching - it treats hyphens and underscores as equivalent
 * when normalizing the separator pattern.
 *
 * @param toolName - The tool name that may have underscore separators
 * @returns The normalized tool name with hyphen separators
 */
export function normalizeMcpToolName(toolName: string): string {
	// Normalize for comparison to detect MCP tools regardless of separator style
	const normalized = normalizeForComparison(toolName)

	// Only normalize if it looks like an MCP tool (starts with mcp__)
	if (normalized.startsWith("mcp__")) {
		// Find the pattern: mcp{sep}server{sep}tool where sep is -- or __
		// We need to convert the separators while preserving the rest

		// First, try to parse assuming all separators are underscores
		// Pattern: mcp__server__tool or mcp__server__tool_with_underscores
		const parts = toolName.split(/__|--/)

		if (parts.length >= 3 && parts[0].toLowerCase() === "mcp") {
			// Reconstruct with proper -- separators
			const serverName = parts[1]
			const toolNamePart = parts.slice(2).join("--") // Rejoin in case tool name had separator
			return `${MCP_TOOL_PREFIX}${MCP_TOOL_SEPARATOR}${serverName}${MCP_TOOL_SEPARATOR}${toolNamePart}`
		}
	}
	return toolName
}

/**
 * Check if a tool name is an MCP tool (starts with the MCP prefix and separator).
 * Uses fuzzy matching to handle both hyphen and underscore separators.
 *
 * @param toolName - The tool name to check
 * @returns true if the tool name starts with "mcp--" or "mcp__", false otherwise
 */
export function isMcpTool(toolName: string): boolean {
	const normalized = normalizeForComparison(toolName)
	return normalized.startsWith(`${MCP_TOOL_PREFIX}__`)
}

/**
 * Sanitize a name to be safe for use in API function names.
 * This removes special characters and ensures the name starts correctly.
 *
 * Note: Hyphens are preserved since they are valid in function names.
 * Models may convert hyphens to underscores, but we handle this with
 * fuzzy matching when parsing tool names.
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

	// Only allow alphanumeric, underscores, and hyphens
	sanitized = sanitized.replace(/[^a-zA-Z0-9_\-]/g, "")

	// Replace any double-hyphen sequences with single hyphen to avoid separator conflicts
	sanitized = sanitized.replace(/--+/g, "-")

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
 * Parse an MCP tool function name back into server and tool names.
 * This handles both hyphen and underscore separators using fuzzy matching.
 *
 * @param mcpToolName - The full MCP tool name (e.g., "mcp--weather--get_forecast" or "mcp__weather__get_forecast")
 * @returns An object with serverName and toolName, or null if parsing fails
 */
export function parseMcpToolName(mcpToolName: string): { serverName: string; toolName: string } | null {
	// Normalize the name to handle both separator styles
	const normalizedName = normalizeMcpToolName(mcpToolName)

	const prefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR
	if (!normalizedName.startsWith(prefix)) {
		return null
	}

	// Remove the "mcp--" prefix
	const remainder = normalizedName.slice(prefix.length)

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

	return {
		serverName,
		toolName,
	}
}

/**
 * Check if two tool names match using fuzzy comparison.
 * Treats hyphens and underscores as equivalent.
 *
 * @param name1 - First tool name
 * @param name2 - Second tool name
 * @returns true if the names match (treating - and _ as equivalent)
 */
export function toolNamesMatch(name1: string, name2: string): boolean {
	return normalizeForComparison(name1) === normalizeForComparison(name2)
}

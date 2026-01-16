import type { ToolName, ModeConfig, ExperimentId, GroupOptions, GroupEntry } from "@roo-code/types"
import { toolNames as validToolNames } from "@roo-code/types"
import { customToolRegistry } from "@roo-code/core"

import { type Mode, FileRestrictionError, getModeBySlug, getGroupName } from "../../shared/modes"
import { EXPERIMENT_IDS } from "../../shared/experiments"
import { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS } from "../../shared/tools"

/**
 * Checks if a tool name is a valid, known tool.
 * Note: This does NOT check if the tool is allowed for a specific mode,
 * only that the tool actually exists.
 */
export function isValidToolName(toolName: string, experiments?: Record<string, boolean>): toolName is ToolName {
	// Check if it's a valid static tool
	if ((validToolNames as readonly string[]).includes(toolName)) {
		return true
	}

	if (experiments?.customTools && customToolRegistry.has(toolName)) {
		return true
	}

	// Check if it's a dynamic MCP tool (mcp_serverName_toolName format).
	if (toolName.startsWith("mcp_")) {
		return true
	}

	return false
}

export function validateToolUse(
	toolName: ToolName,
	mode: Mode,
	customModes?: ModeConfig[],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, unknown>,
	experiments?: Record<string, boolean>,
	includedTools?: string[],
): void {
	// First, check if the tool name is actually a valid/known tool
	// This catches completely invalid tool names like "edit_file" that don't exist
	if (!isValidToolName(toolName, experiments)) {
		throw new Error(
			`Unknown tool "${toolName}". This tool does not exist. Please use one of the available tools: ${validToolNames.join(", ")}.`,
		)
	}

	// Then check if the tool is allowed for the current mode
	if (
		!isToolAllowedForMode(
			toolName,
			mode,
			customModes ?? [],
			toolRequirements,
			toolParams,
			experiments,
			includedTools,
		)
	) {
		throw new Error(`Tool "${toolName}" is not allowed in ${mode} mode.`)
	}
}

const EDIT_OPERATION_PARAMS = ["diff", "content", "operations", "search", "replace", "args", "line"] as const

function getGroupOptions(group: GroupEntry): GroupOptions | undefined {
	return Array.isArray(group) ? group[1] : undefined
}

function doesFileMatchRegex(filePath: string, pattern: string): boolean {
	try {
		const regex = new RegExp(pattern)
		return regex.test(filePath)
	} catch (error) {
		console.error(`Invalid regex pattern: ${pattern}`, error)
		return false
	}
}

export function isToolAllowedForMode(
	tool: string,
	modeSlug: string,
	customModes: ModeConfig[],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, any>, // All tool parameters
	experiments?: Record<string, boolean>,
	includedTools?: string[], // Opt-in tools explicitly included (e.g., from modelInfo)
): boolean {
	// Always allow these tools
	if (ALWAYS_AVAILABLE_TOOLS.includes(tool as any)) {
		return true
	}

	// For now, allow all custom tools in any mode.
	// As a follow-up we should expand the custom tool definition to include mode restrictions.
	if (experiments?.customTools && customToolRegistry.has(tool)) {
		return true
	}

	// Check if this is a dynamic MCP tool (mcp_serverName_toolName)
	// These should be allowed if the mcp group is allowed for the mode
	const isDynamicMcpTool = tool.startsWith("mcp_")

	if (experiments && Object.values(EXPERIMENT_IDS).includes(tool as ExperimentId)) {
		if (!experiments[tool]) {
			return false
		}
	}

	// Check tool requirements if any exist
	if (toolRequirements && typeof toolRequirements === "object") {
		if (tool in toolRequirements && !toolRequirements[tool]) {
			return false
		}
	} else if (toolRequirements === false) {
		// If toolRequirements is a boolean false, all tools are disabled
		return false
	}

	const mode = getModeBySlug(modeSlug, customModes)

	if (!mode) {
		return false
	}

	// Check if tool is in any of the mode's groups and respects any group options
	for (const group of mode.groups) {
		const groupName = getGroupName(group)
		const options = getGroupOptions(group)

		const groupConfig = TOOL_GROUPS[groupName]

		// Check if this is a dynamic MCP tool and the mcp group is allowed
		if (isDynamicMcpTool && groupName === "mcp") {
			// Dynamic MCP tools are allowed if the mcp group is in the mode's groups
			return true
		}

		// Check if the tool is in the group's regular tools
		const isRegularTool = groupConfig.tools.includes(tool)

		// Check if the tool is a custom tool that has been explicitly included
		const isCustomTool = groupConfig.customTools?.includes(tool) && includedTools?.includes(tool)

		// If the tool isn't in regular tools and isn't an included custom tool, continue to next group
		if (!isRegularTool && !isCustomTool) {
			continue
		}

		// If there are no options, allow the tool
		if (!options) {
			return true
		}

		// For the edit group, check file regex if specified
		if (groupName === "edit" && options.fileRegex) {
			// kilocode_change: support multiple edit tool param names
			const filePath = toolParams?.path ?? toolParams?.target_file ?? toolParams?.file_path
			// Check if this is an actual edit operation (not just path-only for streaming)
			const isEditOperation = EDIT_OPERATION_PARAMS.some((param) => toolParams?.[param])

			// Handle single file path validation
			if (filePath && isEditOperation && !doesFileMatchRegex(filePath, options.fileRegex)) {
				throw new FileRestrictionError(mode.name, options.fileRegex, options.description, filePath, tool)
			}

			// Handle XML args parameter (used by MULTI_FILE_APPLY_DIFF experiment)
			if (toolParams?.args && typeof toolParams.args === "string") {
				// Extract file paths from XML args with improved validation
				try {
					const filePathMatches = toolParams.args.match(/<path>([^<]+)<\/path>/g)
					if (filePathMatches) {
						for (const match of filePathMatches) {
							// More robust path extraction with validation
							const pathMatch = match.match(/<path>([^<]+)<\/path>/)
							if (pathMatch && pathMatch[1]) {
								const extractedPath = pathMatch[1].trim()
								// Validate that the path is not empty and doesn't contain invalid characters
								if (extractedPath && !extractedPath.includes("<") && !extractedPath.includes(">")) {
									if (!doesFileMatchRegex(extractedPath, options.fileRegex)) {
										throw new FileRestrictionError(
											mode.name,
											options.fileRegex,
											options.description,
											extractedPath,
											tool,
										)
									}
								}
							}
						}
					}
				} catch (error) {
					// Re-throw FileRestrictionError as it's an expected validation error
					if (error instanceof FileRestrictionError) {
						throw error
					}
					// If XML parsing fails, log the error but don't block the operation
					console.warn(`Failed to parse XML args for file restriction validation: ${error}`)
				}
			}
		}

		return true
	}

	return false
}

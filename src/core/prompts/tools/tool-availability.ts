import type { ToolName, ModeConfig } from "@roo-code/types"

import { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS } from "../../../shared/tools"
import { McpHub } from "../../../services/mcp/McpHub"
import { Mode, getModeConfig, isToolAllowedForMode, getGroupName } from "../../../shared/modes"
import { CodeIndexManager } from "../../../services/code-index/manager"
import { getToolRegistry } from "./schemas/tool-registry"
import { ToolArgs } from "./types"
import { isFastApplyAvailable } from "../../tools/editFileTool"
import { ClineProviderState } from "../../webview/ClineProvider"

export interface ToolAvailabilityResult {
	/**
	 * All available tools for the current mode and configuration
	 */
	availableTools: ToolName[]

	/**
	 * Tools that should use XML descriptions (traditional approach)
	 */
	xmlTools: ToolName[]

	/**
	 * Tools that should use native tool calls
	 */
	toolCallTools: ToolName[]
}

export interface ToolAvailabilityArgs extends ToolArgs {
	mode: Mode
	codeIndexManager?: CodeIndexManager
	customModes?: ModeConfig[]
	clineProviderState: ClineProviderState
}

export function getToolAvailability(args: ToolAvailabilityArgs): ToolAvailabilityResult {
	const { mode, codeIndexManager, customModes, experiments, settings } = args

	const config = getModeConfig(mode, customModes)
	const tools = new Set<ToolName>()

	// Add tools from mode's groups
	config.groups.forEach((groupEntry) => {
		const groupName = getGroupName(groupEntry)
		const toolGroup = TOOL_GROUPS[groupName]
		if (toolGroup) {
			toolGroup.tools.forEach((tool) => {
				if (
					isToolAllowedForMode(
						tool as ToolName,
						mode,
						customModes ?? [],
						undefined,
						undefined,
						experiments ?? {},
					)
				) {
					tools.add(tool as ToolName)
				}
			})
		}
	})

	// Add always available tools
	ALWAYS_AVAILABLE_TOOLS.forEach((tool) => tools.add(tool))
	// kilocode_change start: Morph fast apply
	const { clineProviderState } = args
	if (isFastApplyAvailable(clineProviderState)) {
		// When Morph is enabled, disable traditional editing tools
		const traditionalEditingTools = ["apply_diff", "write_to_file", "insert_content", "search_and_replace"]
		traditionalEditingTools.forEach((tool) => tools.delete(tool as ToolName))
	} else {
		tools.delete("edit_file")
	}
	// kilocode_change end

	// Conditionally exclude codebase_search if feature is disabled or not configured
	if (
		!codeIndexManager ||
		!(codeIndexManager.isFeatureEnabled && codeIndexManager.isFeatureConfigured && codeIndexManager.isInitialized)
	) {
		tools.delete("codebase_search")
	}

	// Conditionally exclude update_todo_list if disabled in settings
	if (settings?.todoListEnabled === false) {
		tools.delete("update_todo_list")
	}

	// Conditionally exclude generate_image if experiment is not enabled
	if (!experiments?.imageGeneration) {
		tools.delete("generate_image")
	}

	// Conditionally exclude run_slash_command if experiment is not enabled
	if (!experiments?.runSlashCommand) {
		tools.delete("run_slash_command")
	}

	const availableTools = Array.from(tools)

	// Determine which tools should use tool calls vs XML
	let toolCallTools: ToolName[] = []
	let xmlTools: ToolName[] = [...availableTools]

	if (settings?.toolCallEnabled === true) {
		const toolRegistry = getToolRegistry()
		toolCallTools = toolRegistry.getSupportedTools(availableTools)

		// Remove tool call tools from XML tools list
		xmlTools = xmlTools.filter((tool) => !toolCallTools.includes(tool))
	}

	return {
		availableTools,
		xmlTools,
		toolCallTools,
	}
}

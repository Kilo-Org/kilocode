import type OpenAI from "openai"
import type {
	ModeConfig,
	ToolName,
	ToolGroup,
	ModelInfo, // kilocode_change
} from "@roo-code/types"
import { getModeBySlug, getToolsForMode, isToolAllowedForMode } from "../../../shared/modes"
import { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS } from "../../../shared/tools"
import { defaultModeSlug } from "../../../shared/modes"
import type { CodeIndexManager } from "../../../services/code-index/manager"

// kilocode_change start
import { ClineProviderState } from "../../webview/ClineProvider"
import { isFastApplyAvailable } from "../../tools/kilocode/editFileTool"
import { ManagedIndexer } from "../../../services/code-index/managed/ManagedIndexer"
// kilocode_change end

/**
 * Filters native tools based on mode restrictions.
 * This ensures native tools are filtered the same way XML tools are filtered in the system prompt.
 *
 * @param nativeTools - Array of all available native tools
 * @param mode - Current mode slug
 * @param customModes - Custom mode configurations
 * @param experiments - Experiment flags
 * @param codeIndexManager - Code index manager for codebase_search feature check
 * @param settings - Additional settings for tool filtering
 * @returns Filtered array of tools allowed for the mode
 */
export function filterNativeToolsForMode(
	nativeTools: OpenAI.Chat.ChatCompletionTool[],
	mode: string | undefined,
	customModes: ModeConfig[] | undefined,
	experiments: Record<string, boolean> | undefined,
	codeIndexManager?: CodeIndexManager,
	settings?: Record<string, any>,
	// kilocode_change start
	state?: ClineProviderState,
	modelInfo?: ModelInfo,
	// kilocode_change end
): OpenAI.Chat.ChatCompletionTool[] {
	// Get mode configuration and all tools for this mode
	const modeSlug = mode ?? defaultModeSlug
	let modeConfig = getModeBySlug(modeSlug, customModes)

	// Fallback to default mode if current mode config is not found
	// This ensures the agent always has functional tools even if a custom mode is deleted
	// or configuration becomes corrupted
	if (!modeConfig) {
		modeConfig = getModeBySlug(defaultModeSlug, customModes)!
	}

	// Get all tools for this mode (including always-available tools)
	const allToolsForMode = getToolsForMode(modeConfig.groups)

	// Filter to only tools that pass permission checks
	const allowedToolNames = new Set(
		allToolsForMode.filter((tool) =>
			isToolAllowedForMode(
				tool as ToolName,
				modeSlug,
				customModes ?? [],
				undefined,
				undefined,
				experiments ?? {},
			),
		),
	)

	// Conditionally exclude codebase_search if feature is disabled or not configured

	// kilocode_change start
	const isCodebaseSearchAvailable =
		ManagedIndexer.getInstance().isEnabled() ||
		(codeIndexManager &&
			codeIndexManager.isFeatureEnabled &&
			codeIndexManager.isFeatureConfigured &&
			codeIndexManager.isInitialized)
	if (!isCodebaseSearchAvailable) {
		allowedToolNames.delete("codebase_search")
	}
	// kilocode_change end

	// Conditionally exclude update_todo_list if disabled in settings
	if (settings?.todoListEnabled === false) {
		allowedToolNames.delete("update_todo_list")
	}

	// Conditionally exclude generate_image if experiment is not enabled
	if (!experiments?.imageGeneration) {
		allowedToolNames.delete("generate_image")
	}

	// Conditionally exclude run_slash_command if experiment is not enabled
	if (!experiments?.runSlashCommand) {
		allowedToolNames.delete("run_slash_command")
	}

	// Conditionally exclude browser_action if disabled in settings
	if (
		settings?.browserToolEnabled === false ||
		modelInfo?.supportsImages === false // kilocode_change
	) {
		allowedToolNames.delete("browser_action")
	}

	// kilocode_change start
	if (state && isFastApplyAvailable(state)) {
		// When Fast Apply is enabled, disable traditional editing tools
		const traditionalEditingTools = ["apply_diff", "write_to_file", "insert_content"]
		traditionalEditingTools.forEach((tool) => allowedToolNames.delete(tool))
	} else {
		allowedToolNames.delete("edit_file")
	}
	// kilocode_change end

	// Filter native tools based on allowed tool names
	return nativeTools.filter((tool) => {
		// Handle both ChatCompletionTool and ChatCompletionCustomTool
		if ("function" in tool && tool.function) {
			return allowedToolNames.has(tool.function.name)
		}
		return false
	})
}

/**
 * Checks if a specific tool is allowed in the current mode.
 * This is useful for dynamically filtering system prompt content.
 *
 * @param toolName - Name of the tool to check
 * @param mode - Current mode slug
 * @param customModes - Custom mode configurations
 * @param experiments - Experiment flags
 * @param codeIndexManager - Code index manager for codebase_search feature check
 * @param settings - Additional settings for tool filtering
 * @returns true if the tool is allowed in the mode, false otherwise
 */
export function isToolAllowedInMode(
	toolName: ToolName,
	mode: string | undefined,
	customModes: ModeConfig[] | undefined,
	experiments: Record<string, boolean> | undefined,
	codeIndexManager?: CodeIndexManager,
	settings?: Record<string, any>,
): boolean {
	const modeSlug = mode ?? defaultModeSlug

	// Check if it's an always-available tool
	if (ALWAYS_AVAILABLE_TOOLS.includes(toolName)) {
		// But still check for conditional exclusions
		if (toolName === "codebase_search") {
			return !!(
				codeIndexManager &&
				codeIndexManager.isFeatureEnabled &&
				codeIndexManager.isFeatureConfigured &&
				codeIndexManager.isInitialized
			)
		}
		if (toolName === "update_todo_list") {
			return settings?.todoListEnabled !== false
		}
		if (toolName === "generate_image") {
			return experiments?.imageGeneration === true
		}
		if (toolName === "run_slash_command") {
			return experiments?.runSlashCommand === true
		}
		return true
	}

	// Check for browser_action being disabled by user settings
	if (toolName === "browser_action" && settings?.browserToolEnabled === false) {
		return false
	}

	// Check if the tool is allowed by the mode's groups
	return isToolAllowedForMode(toolName, modeSlug, customModes ?? [], undefined, undefined, experiments ?? {})
}

/**
 * Gets the list of available tools from a specific tool group for the current mode.
 * This is useful for dynamically building system prompt content based on available tools.
 *
 * @param groupName - Name of the tool group to check
 * @param mode - Current mode slug
 * @param customModes - Custom mode configurations
 * @param experiments - Experiment flags
 * @param codeIndexManager - Code index manager for codebase_search feature check
 * @param settings - Additional settings for tool filtering
 * @returns Array of tool names that are available from the group
 */
export function getAvailableToolsInGroup(
	groupName: ToolGroup,
	mode: string | undefined,
	customModes: ModeConfig[] | undefined,
	experiments: Record<string, boolean> | undefined,
	codeIndexManager?: CodeIndexManager,
	settings?: Record<string, any>,
): ToolName[] {
	const toolGroup = TOOL_GROUPS[groupName]
	if (!toolGroup) {
		return []
	}

	return toolGroup.tools.filter((tool) =>
		isToolAllowedInMode(tool as ToolName, mode, customModes, experiments, codeIndexManager, settings),
	) as ToolName[]
}

/**
 * Filters MCP tools based on whether use_mcp_tool is allowed in the current mode.
 *
 * @param mcpTools - Array of MCP tools
 * @param mode - Current mode slug
 * @param customModes - Custom mode configurations
 * @param experiments - Experiment flags
 * @returns Filtered array of MCP tools if use_mcp_tool is allowed, empty array otherwise
 */
export function filterMcpToolsForMode(
	mcpTools: OpenAI.Chat.ChatCompletionTool[],
	mode: string | undefined,
	customModes: ModeConfig[] | undefined,
	experiments: Record<string, boolean> | undefined,
): OpenAI.Chat.ChatCompletionTool[] {
	const modeSlug = mode ?? defaultModeSlug

	// MCP tools are always in the mcp group, check if use_mcp_tool is allowed
	const isMcpAllowed = isToolAllowedForMode(
		"use_mcp_tool",
		modeSlug,
		customModes ?? [],
		undefined,
		undefined,
		experiments ?? {},
	)

	return isMcpAllowed ? mcpTools : []
}

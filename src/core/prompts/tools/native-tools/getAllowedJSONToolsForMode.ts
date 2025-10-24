import { ToolName } from "@roo-code/types"
import { CodeIndexManager } from "../../../../services/code-index/manager"
import { Mode, getModeConfig, isToolAllowedForMode, getGroupName } from "../../../../shared/modes"
import { ClineProviderState } from "../../../webview/ClineProvider"
import OpenAI from "openai"
import { ALWAYS_AVAILABLE_TOOLS, TOOL_GROUPS } from "../../../../shared/tools"
import { isFastApplyAvailable } from "../../../tools/editFileTool"
import { nativeTools } from "."
import { apply_diff_multi_file, apply_diff_single_file } from "./apply_diff"

export function getAllowedJSONToolsForMode(
	mode: Mode,
	codeIndexManager: CodeIndexManager | undefined,
	clineProviderState: ClineProviderState | undefined,
	diffEnabled: boolean,
	supportsImages: boolean,
): OpenAI.Chat.ChatCompletionTool[] {
	const config = getModeConfig(mode, clineProviderState?.customModes)

	const tools = new Set<string>()

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
						clineProviderState?.customModes ?? [],
						undefined,
						undefined,
						clineProviderState?.experiments ?? {},
					)
				) {
					tools.add(tool)
				}
			})
		}
	})

	// Add always available tools
	ALWAYS_AVAILABLE_TOOLS.forEach((tool) => tools.add(tool))

	// Conditionally exclude codebase_search if feature is disabled or not configured
	if (
		!codeIndexManager ||
		!(codeIndexManager.isFeatureEnabled && codeIndexManager.isFeatureConfigured && codeIndexManager.isInitialized)
	) {
		tools.delete("codebase_search")
	}

	if (isFastApplyAvailable(clineProviderState)) {
		// When Morph is enabled, disable traditional editing tools
		const traditionalEditingTools = ["apply_diff", "write_to_file", "insert_content", "search_and_replace"]
		traditionalEditingTools.forEach((tool) => tools.delete(tool))
	} else {
		tools.delete("edit_file")
	}

	// Conditionally exclude update_todo_list if disabled in settings
	if (clineProviderState?.apiConfiguration?.todoListEnabled === false) {
		tools.delete("update_todo_list")
	}

	// Conditionally exclude generate_image if experiment is not enabled
	if (!clineProviderState?.experiments?.imageGeneration) {
		tools.delete("generate_image")
	}

	// Conditionally exclude run_slash_command if experiment is not enabled
	if (!clineProviderState?.experiments?.runSlashCommand) {
		tools.delete("run_slash_command")
	}

	if (!clineProviderState?.browserToolEnabled || !supportsImages) {
		tools.delete("browser_action")
	}

	// Create a map of tool names to native tool definitions for quick lookup
	// Exclude apply_diff tools as they are handled specially below
	const allowedTools: OpenAI.Chat.ChatCompletionTool[] = []

	let isApplyDiffToolAllowedForMode = false
	for (const nativeTool of nativeTools) {
		const toolName = nativeTool.function.name

		// If the tool is in the allowed set, add it.
		if (tools.has(toolName)) {
			if (toolName === "apply_diff") {
				isApplyDiffToolAllowedForMode = true
			} else {
				allowedTools.push(nativeTool)
			}
		}
	}

	// Handle the "apply_diff" logic separately because the same tool has different
	// implementations depending on whether multi-file diffs are enabled, but the same name is used.
	if (isApplyDiffToolAllowedForMode && diffEnabled) {
		if (clineProviderState?.experiments.multiFileApplyDiff) {
			allowedTools.push(apply_diff_multi_file)
		} else {
			allowedTools.push(apply_diff_single_file)
		}
	}

	return allowedTools
}

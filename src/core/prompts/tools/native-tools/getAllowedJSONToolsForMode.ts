import { ModelInfo, shouldUseSingleFileRead, ToolName } from "@roo-code/types"
import { CodeIndexManager } from "../../../../services/code-index/manager"
import { Mode, getModeConfig, isToolAllowedForMode, getGroupName } from "../../../../shared/modes"
import { ClineProviderState } from "../../../webview/ClineProvider"
import OpenAI from "openai"
import { ALWAYS_AVAILABLE_TOOLS, TOOL_GROUPS } from "../../../../shared/tools"
import { isFastApplyAvailable } from "../../../tools/editFileTool"
import { nativeTools } from "."
import { apply_diff_multi_file, apply_diff_single_file } from "./apply_diff"
import pWaitFor from "p-wait-for"
import { McpHub } from "../../../../services/mcp/McpHub"
import { McpServerManager } from "../../../../services/mcp/McpServerManager"
import { getMcpServerTools } from "./mcp_server"
import { ClineProvider } from "../../../webview/ClineProvider"
import { ManagedIndexer } from "../../../../services/code-index/managed/ManagedIndexer" // kilocode_change
import { ContextProxy } from "../../../config/ContextProxy"
import * as vscode from "vscode"
import { read_file_multi, read_file_single } from "./read_file"
import search_and_replace, { shouldUseSearchAndReplaceInsteadOfApplyDiff } from "./search_and_replace"

export async function getAllowedJSONToolsForMode(
	mode: Mode,
	provider: ClineProvider | undefined,
	diffEnabled: boolean = false,
	model: { id: string; info: ModelInfo } | undefined,
): Promise<OpenAI.Chat.ChatCompletionTool[]> {
	const providerState: ClineProviderState | undefined = await provider?.getState()
	const config = getModeConfig(mode, providerState?.customModes)
	const context = ContextProxy.instance.rawContext

	// Initialize code index managers for all workspace folders.
	let codeIndexManager: CodeIndexManager | undefined = undefined

	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const manager = CodeIndexManager.getInstance(context, folder.uri.fsPath)
			if (manager) {
				codeIndexManager = manager
			}
		}
	}

	const { mcpEnabled } = providerState ?? {}
	let mcpHub: McpHub | undefined
	if (mcpEnabled) {
		if (!provider) {
			throw new Error("Provider reference lost during view transition")
		}

		// Wait for MCP hub initialization through McpServerManager
		mcpHub = await McpServerManager.getInstance(provider.context, provider)

		if (!mcpHub) {
			throw new Error("Failed to get MCP hub from server manager")
		}

		// Wait for MCP servers to be connected before generating system prompt
		await pWaitFor(() => !mcpHub!.isConnecting, { timeout: 10_000 }).catch(() => {
			console.error("MCP servers failed to connect in time")
		})
	}

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
						providerState?.customModes ?? [],
						undefined,
						undefined,
						providerState?.experiments ?? {},
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
		// kilocode_change start
		if (!ManagedIndexer.getInstance()?.isEnabled()) {
			tools.delete("codebase_search")
		}
		// kilocode_change end
	}

	if (isFastApplyAvailable(providerState)) {
		// When Fast Apply is enabled, disable traditional editing tools
		const traditionalEditingTools = ["apply_diff", "write_to_file", "insert_content"]
		traditionalEditingTools.forEach((tool) => tools.delete(tool))
	} else {
		tools.delete("edit_file")
	}

	// Conditionally exclude update_todo_list if disabled in settings
	if (providerState?.apiConfiguration?.todoListEnabled === false) {
		tools.delete("update_todo_list")
	}

	// Conditionally exclude generate_image if experiment is not enabled
	if (!providerState?.experiments?.imageGeneration) {
		tools.delete("generate_image")
	}

	// Conditionally exclude run_slash_command if experiment is not enabled
	if (!providerState?.experiments?.runSlashCommand) {
		tools.delete("run_slash_command")
	}

	if (!providerState?.browserToolEnabled || !model?.info.supportsImages) {
		tools.delete("browser_action")
	}

	// Create a map of tool names to native tool definitions for quick lookup
	// Exclude apply_diff tools as they are handled specially below
	// Create a map of tool names to native tool definitions for quick lookup
	const nativeToolsMap = new Map<string, OpenAI.Chat.ChatCompletionTool>()
	nativeTools.forEach((tool) => {
		nativeToolsMap.set(tool.function.name, tool)
	})
	let allowedTools: OpenAI.Chat.ChatCompletionTool[] = []

	let isReadFileToolAllowedForMode = false
	let isApplyDiffToolAllowedForMode = false
	for (const nativeTool of nativeTools) {
		const toolName = nativeTool.function.name

		// If the tool is in the allowed set, add it.
		if (tools.has(toolName)) {
			if (toolName === "read_file") {
				isReadFileToolAllowedForMode = true
			} else if (toolName === "apply_diff") {
				isApplyDiffToolAllowedForMode = true
			} else {
				allowedTools.push(nativeTool)
			}
		}
	}

	if (isReadFileToolAllowedForMode) {
		if (model?.id && shouldUseSingleFileRead(model?.id)) {
			allowedTools.push(read_file_single)
		} else {
			allowedTools.push(read_file_multi)
		}
	}

	// Handle the "apply_diff" logic separately because the same tool has different
	// implementations depending on whether multi-file diffs are enabled, but the same name is used.
	if (isApplyDiffToolAllowedForMode && diffEnabled) {
		if (providerState?.experiments.multiFileApplyDiff) {
			allowedTools.push(apply_diff_multi_file)
		} else if (shouldUseSearchAndReplaceInsteadOfApplyDiff("json", model?.id ?? "")) {
			allowedTools.push(search_and_replace)
		} else {
			allowedTools.push(apply_diff_single_file)
		}
	}

	// Check if MCP functionality should be included
	const hasMcpGroup = config.groups.some((groupEntry) => getGroupName(groupEntry) === "mcp")
	if (hasMcpGroup && mcpHub) {
		const mcpTools = getMcpServerTools(mcpHub)
		if (mcpTools) {
			allowedTools.push(...mcpTools)
		}
	}

	return allowedTools
}

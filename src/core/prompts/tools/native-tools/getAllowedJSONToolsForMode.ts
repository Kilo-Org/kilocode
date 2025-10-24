import { ToolName } from "@roo-code/types"
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
import { ContextProxy } from "../../../config/ContextProxy"
import * as vscode from "vscode"

export async function getAllowedJSONToolsForMode(
	mode: Mode,
	provider: ClineProvider | undefined,
	supportsImages?: boolean,
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
		tools.delete("codebase_search")
	}

	if (isFastApplyAvailable(providerState)) {
		// When Fast Apply is enabled, disable traditional editing tools
		const traditionalEditingTools = ["apply_diff", "write_to_file", "insert_content", "search_and_replace"]
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

	if (!providerState?.browserToolEnabled || !supportsImages) {
		tools.delete("browser_action")
	}

	// Create a map of tool names to native tool definitions for quick lookup
	const nativeToolsMap = new Map<string, OpenAI.Chat.ChatCompletionTool>()
	nativeTools.forEach((tool) => {
		nativeToolsMap.set(tool.function.name, tool)
	})

	if (providerState?.apiConfiguration.diffEnabled) {
		if (providerState?.experiments.multiFileApplyDiff) {
			nativeToolsMap.set("apply_diff", apply_diff_multi_file)
		} else {
			nativeToolsMap.set("apply_diff", apply_diff_single_file)
		}
	}

	// Map allowed tools to their native definitions
	const allowedTools: OpenAI.Chat.ChatCompletionTool[] = []
	tools.forEach((toolName) => {
		const nativeTool = nativeToolsMap.get(toolName)
		if (nativeTool) {
			allowedTools.push(nativeTool)
		}
	})

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

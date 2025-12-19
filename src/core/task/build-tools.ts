import type OpenAI from "openai"
import type { ProviderSettings, ModeConfig, ModelInfo } from "@roo-code/types"
import type { ClineProvider } from "../webview/ClineProvider"
import { getNativeTools, getMcpServerTools } from "../prompts/tools/native-tools"
import { filterNativeToolsForMode, filterMcpToolsForMode } from "../prompts/tools/filter-tools-for-mode"
import type { ClineProviderState } from "../webview/ClineProvider" // kilocode_change

interface BuildToolsOptions {
	provider: ClineProvider
	cwd: string
	mode: string | undefined
	customModes: ModeConfig[] | undefined
	experiments: Record<string, boolean> | undefined
	apiConfiguration: ProviderSettings | undefined
	maxReadFileLine: number
	browserToolEnabled: boolean
	// kilocode_change start
	state?: ClineProviderState
	// kilocode_change end
	modelInfo?: ModelInfo
	diffEnabled: boolean
}

/**
 * Builds the complete tools array for native protocol requests.
 * Combines native tools and MCP tools, filtered by mode restrictions.
 *
 * @param options - Configuration options for building the tools
 * @returns Array of filtered native and MCP tools
 */
export async function buildNativeToolsArray(options: BuildToolsOptions): Promise<OpenAI.Chat.ChatCompletionTool[]> {
	const {
		provider,
		cwd,
		mode,
		customModes,
		experiments,
		apiConfiguration,
		maxReadFileLine,
		browserToolEnabled,
		modelInfo,
		diffEnabled,
	} = options

	const mcpHub = provider.getMcpHub()

	// Get CodeIndexManager for feature checking
	const { CodeIndexManager } = await import("../../services/code-index/manager")
	const codeIndexManager = CodeIndexManager.getInstance(provider.context, cwd)

	// Build settings object for tool filtering
	const filterSettings = {
		todoListEnabled: apiConfiguration?.todoListEnabled ?? true,
		browserToolEnabled: browserToolEnabled ?? true,
		modelInfo,
		diffEnabled,
	}

	// Determine if partial reads are enabled based on maxReadFileLine setting
	const partialReadsEnabled = maxReadFileLine !== -1

	// Build native tools with dynamic read_file tool based on partialReadsEnabled
	const nativeTools = getNativeTools(partialReadsEnabled)

	// Filter native tools based on mode restrictions
	const filteredNativeTools = filterNativeToolsForMode(
		nativeTools,
		mode,
		customModes,
		experiments,
		codeIndexManager,
		filterSettings,
		// kilocode_change start
		options.state,
		// kilocode_change end
		mcpHub,
	)

	// Filter MCP tools based on mode restrictions
	const mcpTools = getMcpServerTools(mcpHub)
	const filteredMcpTools = filterMcpToolsForMode(mcpTools, mode, customModes, experiments)

	return [...filteredNativeTools, ...filteredMcpTools]
}

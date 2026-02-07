import path from "path"

import type OpenAI from "openai"

import type { ProviderSettings, ModeConfig, ModelInfo } from "@roo-code/types"
import { customToolRegistry, formatNative } from "@roo-code/core"

import type { ClineProvider } from "../webview/ClineProvider"
import { getRooDirectoriesForCwd } from "../../services/roo-config/index.js"

import { getNativeTools, getMcpServerTools } from "../prompts/tools/native-tools"
import type { ClineProviderState } from "../webview/ClineProvider" // kilocode_change
import {
	filterNativeToolsForMode,
	filterMcpToolsForMode,
	resolveToolAlias,
} from "../prompts/tools/filter-tools-for-mode"

interface BuildToolsOptions {
	provider: ClineProvider
	cwd: string
	mode: string | undefined
	customModes: ModeConfig[] | undefined
	experiments: Record<string, boolean> | undefined
	apiConfiguration: ProviderSettings | undefined
	maxReadFileLine: number
	maxConcurrentFileReads: number
	browserToolEnabled: boolean
	// kilocode_change start
	state?: ClineProviderState
	// kilocode_change end
	modelInfo?: ModelInfo
	diffEnabled: boolean
	/**
	 * If true, returns all tools without mode filtering, but also includes
	 * the list of allowed tool names for use with allowedFunctionNames.
	 * This enables providers that support function call restrictions (e.g., Gemini)
	 * to pass all tool definitions while restricting callable tools.
	 */
	includeAllToolsWithRestrictions?: boolean
}

interface BuildToolsResult {
	/**
	 * The tools to pass to the model.
	 * If includeAllToolsWithRestrictions is true, this includes ALL tools.
	 * Otherwise, it includes only mode-filtered tools.
	 */
	tools: OpenAI.Chat.ChatCompletionTool[]
	/**
	 * The names of tools that are allowed to be called based on mode restrictions.
	 * Only populated when includeAllToolsWithRestrictions is true.
	 * Use this with allowedFunctionNames in providers that support it.
	 */
	allowedFunctionNames?: string[]
}

/**
 * Extracts the function name from a tool definition.
 */
function getToolName(tool: OpenAI.Chat.ChatCompletionTool): string {
	return (tool as OpenAI.Chat.ChatCompletionFunctionTool).function.name
}

/**
 * Builds the complete tools array for native protocol requests.
 * Combines native tools and MCP tools, filtered by mode restrictions.
 *
 * @param options - Configuration options for building the tools
 * @returns Array of filtered native and MCP tools
 */
export async function buildNativeToolsArray(options: BuildToolsOptions): Promise<OpenAI.Chat.ChatCompletionTool[]> {
	const result = await buildNativeToolsArrayWithRestrictions(options)
	return result.tools
}

/**
 * Builds the complete tools array for native protocol requests with optional mode restrictions.
 * When includeAllToolsWithRestrictions is true, returns ALL tools but also provides
 * the list of allowed tool names for use with allowedFunctionNames.
 *
 * This enables providers like Gemini to pass all tool definitions to the model
 * (so it can reference historical tool calls) while restricting which tools
 * can actually be invoked via allowedFunctionNames in toolConfig.
 *
 * @param options - Configuration options for building the tools
 * @returns BuildToolsResult with tools array and optional allowedFunctionNames
 */
export async function buildNativeToolsArrayWithRestrictions(options: BuildToolsOptions): Promise<BuildToolsResult> {
	const {
		provider,
		cwd,
		mode,
		customModes,
		experiments,
		apiConfiguration,
		maxReadFileLine,
		maxConcurrentFileReads,
		browserToolEnabled,
		modelInfo,
		diffEnabled,
		includeAllToolsWithRestrictions,
	} = options

	const mcpHub = provider.getMcpHub()

	// Get CodeIndexManager for feature checking.
	const { CodeIndexManager } = await import("../../services/code-index/manager")
	const codeIndexManager = CodeIndexManager.getInstance(provider.context, cwd)

	// Build settings object for tool filtering.
	const filterSettings = {
		todoListEnabled: apiConfiguration?.todoListEnabled ?? true,
		browserToolEnabled: browserToolEnabled ?? true,
		modelInfo,
		diffEnabled,
	}

	// Determine if partial reads are enabled based on maxReadFileLine setting.
	const partialReadsEnabled = maxReadFileLine !== -1

	// Check if the model supports images for read_file tool description.
	const supportsImages = modelInfo?.supportsImages ?? false

	// Build native tools with dynamic read_file tool based on settings.
	const nativeTools = getNativeTools({
		partialReadsEnabled,
		maxConcurrentFileReads,
		supportsImages,
	})

	// Filter native tools based on mode restrictions.
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

	// Filter MCP tools based on mode restrictions.
	const mcpTools = getMcpServerTools(mcpHub)
	const filteredMcpTools = filterMcpToolsForMode(mcpTools, mode, customModes, experiments)

	// Add custom tools if they are available and the experiment is enabled.
	let nativeCustomTools: OpenAI.Chat.ChatCompletionFunctionTool[] = []

	if (experiments?.customTools) {
		const toolDirs = getRooDirectoriesForCwd(cwd).map((dir) => path.join(dir, "tools"))
		await customToolRegistry.loadFromDirectoriesIfStale(toolDirs)
		const customTools = customToolRegistry.getAllSerialized()

		if (customTools.length > 0) {
			nativeCustomTools = customTools.map(formatNative)
		}
	}

	// Combine filtered tools (for backward compatibility and for allowedFunctionNames)
	const filteredTools = [...filteredNativeTools, ...filteredMcpTools, ...nativeCustomTools]

	// If includeAllToolsWithRestrictions is true, return ALL tools but provide
	// allowed names based on mode filtering
	if (includeAllToolsWithRestrictions) {
		// Combine ALL tools (unfiltered native + all MCP + custom)
		const allTools = [...nativeTools, ...mcpTools, ...nativeCustomTools]

		// Extract names of tools that are allowed based on mode filtering.
		// Resolve any alias names to canonical names to ensure consistency with allTools
		// (which uses canonical names). This prevents Gemini errors when tools are renamed
		// to aliases in filteredTools but allTools contains the original canonical names.
		const allowedFunctionNames = filteredTools.map((tool) => resolveToolAlias(getToolName(tool)))

		return {
			tools: allTools,
			allowedFunctionNames,
		}
	}

	// Default behavior: return only filtered tools
	return {
		tools: filteredTools,
	}
}

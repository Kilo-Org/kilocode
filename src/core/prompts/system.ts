import * as vscode from "vscode"
import * as os from "os"

import type {
	ModeConfig,
	PromptComponent,
	CustomModePrompts,
	TodoItem,
	Experiments, // kilocode_change
} from "@roo-code/types"

import type { SystemPromptSettings } from "./types"

import { Mode, modes, defaultModeSlug, getModeBySlug, getGroupName, getModeSelection } from "../../shared/modes"
import { DiffStrategy } from "../../shared/tools"
import { formatLanguage } from "../../shared/language"
import { isEmpty } from "../../utils/object"

import { McpHub } from "../../services/mcp/McpHub"
import { CodeIndexManager } from "../../services/code-index/manager"

import { PromptVariables, loadSystemPromptFile } from "./sections/custom-system-prompt"
import { getSystemPromptComponentsConfig, loadCustomPromptComponent } from "./sections/custom-prompt-components"
import type { SystemPromptComponentsConfig } from "./types/system-prompt-components"

import { getToolDescriptionsForMode } from "./tools"
import {
	getRulesSection,
	getSystemInfoSection,
	getObjectiveSection,
	getSharedToolUseSection,
	getMcpServersSection,
	getToolUseGuidelinesSection,
	getCapabilitiesSection,
	getModesSection,
	addCustomInstructions,
	markdownFormattingSection,
} from "./sections"
import { getMorphInstructions } from "./tools/edit-file" // kilocode_change: Morph fast apply

// Helper function to get prompt component, filtering out empty objects
export function getPromptComponent(
	customModePrompts: CustomModePrompts | undefined,
	mode: string,
): PromptComponent | undefined {
	const component = customModePrompts?.[mode]
	// Return undefined if component is empty
	if (isEmpty(component)) {
		return undefined
	}
	return component
}

async function generatePrompt(
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mode: Mode,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	promptComponent?: PromptComponent,
	customModeConfigs?: ModeConfig[],
	globalCustomInstructions?: string,
	diffEnabled?: boolean,
	experiments?: Record<string, boolean>,
	enableMcpServerCreation?: boolean,
	language?: string,
	rooIgnoreInstructions?: string,
	partialReadsEnabled?: boolean,
	settings?: SystemPromptSettings,
	todoList?: TodoItem[],
	compactMode?: boolean, // Add compact mode option
	componentsConfig?: SystemPromptComponentsConfig, // Add components config
): Promise<string> {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	// If diff is disabled, don't pass the diffStrategy
	const effectiveDiffStrategy = diffEnabled ? diffStrategy : undefined

	// Get the full mode config to ensure we have the role definition (used for groups, etc.)
	const modeConfig = getModeBySlug(mode, customModeConfigs) || modes.find((m) => m.slug === mode) || modes[0]
	const { roleDefinition, baseInstructions } = getModeSelection(mode, promptComponent, customModeConfigs)

	// Get system prompt components configuration
	const systemComponentsConfig = componentsConfig || getSystemPromptComponentsConfig(context)

	// Load custom components
	const customRoleDefinition = await loadCustomPromptComponent(
		cwd,
		"roleDefinition",
		systemComponentsConfig.roleDefinition,
	)
	const customMarkdownFormatting = await loadCustomPromptComponent(
		cwd,
		"markdownFormatting",
		systemComponentsConfig.markdownFormatting,
	)
	const customToolUse = await loadCustomPromptComponent(cwd, "toolUse", systemComponentsConfig.toolUse)
	const customRules = await loadCustomPromptComponent(cwd, "rules", systemComponentsConfig.rules)
	const customSystemInfo = await loadCustomPromptComponent(cwd, "systemInfo", systemComponentsConfig.systemInfo)
	const customCapabilities = await loadCustomPromptComponent(cwd, "capabilities", systemComponentsConfig.capabilities)
	const customModes = await loadCustomPromptComponent(cwd, "modes", systemComponentsConfig.modes)
	const customObjective = await loadCustomPromptComponent(cwd, "objective", systemComponentsConfig.objective)
	const customMcpServers = await loadCustomPromptComponent(cwd, "mcpServers", systemComponentsConfig.mcpServers)
	const customCustomInstructions = await loadCustomPromptComponent(
		cwd,
		"customInstructions",
		systemComponentsConfig.customInstructions,
	)

	// Check if MCP functionality should be included
	const hasMcpGroup = modeConfig.groups.some((groupEntry) => getGroupName(groupEntry) === "mcp")
	const hasMcpServers = mcpHub && mcpHub.getServers().length > 0
	const shouldIncludeMcp = hasMcpGroup && hasMcpServers

	const [modesSection, mcpServersSection] = await Promise.all([
		getModesSection(context),
		shouldIncludeMcp
			? getMcpServersSection(mcpHub, effectiveDiffStrategy, enableMcpServerCreation)
			: Promise.resolve(""),
	])

	const codeIndexManager = CodeIndexManager.getInstance(context, cwd)

	// Use compact mode to reduce token usage
	if (compactMode) {
		// Simplified prompt for compact mode - 20250809 陈凤庆 新增紧凑模式
		// 最后角色定义
		const finalRoleDefinition =
			customRoleDefinition || roleDefinition || "You are Kilo Code, an AI coding assistant."

		// 总区块定义
		const toolSection =
			customToolUse ||
			getToolDescriptionsForMode(
				mode,
				cwd,
				supportsComputerUse,
				codeIndexManager,
				effectiveDiffStrategy,
				browserViewportSize,
				shouldIncludeMcp ? mcpHub : undefined,
				customModeConfigs,
				experiments,
				partialReadsEnabled,
				settings,
				true, // Enable compact mode for tools
				enableMcpServerCreation,
			)

		const rulesSection =
			customRules ||
			`# Rules
- Project directory: ${cwd}
- Use relative paths
- Wait for user confirmation after each tool use`

		const customInstructionsSection =
			customCustomInstructions ||
			(await addCustomInstructions(baseInstructions, globalCustomInstructions || "", cwd, mode, {
				language: language ?? formatLanguage(vscode.env.language),
				rooIgnoreInstructions,
				localRulesToggleState: context.workspaceState.get("localRulesToggles"),
				globalRulesToggleState: context.globalState.get("globalRulesToggles"),
				settings,
			}))

		const basePrompt = `${finalRoleDefinition}

# Tools
${toolSection}

${rulesSection}

${customInstructionsSection}`
		return basePrompt
	}

	// Full prompt for normal mode
	const finalRoleDefinition = customRoleDefinition || roleDefinition
	const finalMarkdownFormatting = customMarkdownFormatting || markdownFormattingSection()
	const finalSharedToolUse = customToolUse || getSharedToolUseSection()
	const finalToolDescriptions =
		customToolUse ||
		getToolDescriptionsForMode(
			mode,
			cwd,
			supportsComputerUse,
			codeIndexManager,
			effectiveDiffStrategy,
			browserViewportSize,
			shouldIncludeMcp ? mcpHub : undefined,
			customModeConfigs,
			experiments,
			partialReadsEnabled,
			settings,
			compactMode,
			enableMcpServerCreation,
		)
	const finalMcpServers = customMcpServers || mcpServersSection
	const finalCapabilities =
		customCapabilities ||
		getCapabilitiesSection(
			cwd,
			supportsComputerUse,
			shouldIncludeMcp ? mcpHub : undefined,
			effectiveDiffStrategy,
			codeIndexManager,
		)
	const finalModes = customModes || modesSection
	const finalRules = customRules || getRulesSection(cwd, supportsComputerUse, effectiveDiffStrategy, codeIndexManager)
	const finalSystemInfo = customSystemInfo || getSystemInfoSection(cwd)
	const finalObjective = customObjective || getObjectiveSection(codeIndexManager, experiments)
	const finalCustomInstructions =
		customCustomInstructions ||
		(await addCustomInstructions(baseInstructions, globalCustomInstructions || "", cwd, mode, {
			language: language ?? formatLanguage(vscode.env.language),
			rooIgnoreInstructions,
			localRulesToggleState: context.workspaceState.get("localRulesToggles"), // kilocode_change
			globalRulesToggleState: context.globalState.get("globalRulesToggles"), // kilocode_change
			settings,
		}))

	const basePrompt = `${finalRoleDefinition}

${finalMarkdownFormatting}

${finalSharedToolUse}

${finalToolDescriptions}

${getToolUseGuidelinesSection(codeIndexManager)}

${getMorphInstructions(experiments) /* kilocode_change: newlines are returned by function */}${finalMcpServers}

${finalCapabilities}

${finalModes}

${finalRules}

${finalSystemInfo}

${finalObjective}

${finalCustomInstructions}`

	return basePrompt
}

export const SYSTEM_PROMPT = async (
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	inputMode: Mode = defaultModeSlug, // kilocode_change: name changed to inputMode
	customModePrompts?: CustomModePrompts,
	customModes?: ModeConfig[],
	globalCustomInstructions?: string,
	diffEnabled?: boolean,
	experiments?: Experiments, // kilocode_change: type
	enableMcpServerCreation?: boolean,
	language?: string,
	rooIgnoreInstructions?: string,
	partialReadsEnabled?: boolean,
	settings?: SystemPromptSettings,
	todoList?: TodoItem[],
	compactMode?: boolean, // Add compact mode option
	componentsConfig?: SystemPromptComponentsConfig, // Add components config
): Promise<string> => {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	const mode =
		getModeBySlug(inputMode, customModes)?.slug || modes.find((m) => m.slug === inputMode)?.slug || defaultModeSlug // kilocode_change: don't try to use non-existent modes

	// Try to load custom system prompt from file
	const variablesForPrompt: PromptVariables = {
		workspace: cwd,
		mode: mode,
		language: language ?? formatLanguage(vscode.env.language),
		shell: vscode.env.shell,
		operatingSystem: os.type(),
	}
	const fileCustomSystemPrompt = await loadSystemPromptFile(cwd, mode, variablesForPrompt)

	// Check if it's a custom mode
	const promptComponent = getPromptComponent(customModePrompts, mode)

	// Get full mode config from custom modes or fall back to built-in modes
	const currentMode = getModeBySlug(mode, customModes) || modes.find((m) => m.slug === mode) || modes[0]

	// If a file-based custom system prompt exists, use it
	if (fileCustomSystemPrompt) {
		const { roleDefinition, baseInstructions: baseInstructionsForFile } = getModeSelection(
			mode,
			promptComponent,
			customModes,
		)

		// Ensure roleDefinition is never undefined
		const safeRoleDefinition = roleDefinition || "You are Kilo Code, an AI coding assistant."

		const customInstructions = await addCustomInstructions(
			baseInstructionsForFile,
			globalCustomInstructions || "",
			cwd,
			mode,
			{
				language: language ?? formatLanguage(vscode.env.language),
				rooIgnoreInstructions,
				settings,
			},
		)

		// For file-based prompts, don't include the tool sections
		return `${safeRoleDefinition}

${fileCustomSystemPrompt}

${getMorphInstructions(experiments) /* kilocode_change: Morph fast apply */}${customInstructions}`
	}

	// If diff is disabled, don't pass the diffStrategy
	const effectiveDiffStrategy = diffEnabled ? diffStrategy : undefined

	return generatePrompt(
		context,
		cwd,
		supportsComputerUse,
		currentMode.slug,
		mcpHub,
		effectiveDiffStrategy,
		browserViewportSize,
		promptComponent,
		customModes,
		globalCustomInstructions,
		diffEnabled,
		experiments,
		enableMcpServerCreation,
		language,
		rooIgnoreInstructions,
		partialReadsEnabled,
		settings,
		todoList,
		compactMode,
		componentsConfig,
	)
}

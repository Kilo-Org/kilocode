import type { ToolName, ModeConfig } from "@roo-code/types"

import { DiffStrategy } from "../../../shared/tools"
import { McpHub } from "../../../services/mcp/McpHub"
import { Mode } from "../../../shared/modes"

import { ToolArgs } from "./types"
import { getExecuteCommandDescription } from "./execute-command"
import { getReadFileDescription } from "./read-file"
import { getSimpleReadFileDescription } from "./simple-read-file"
import { getFetchInstructionsDescription } from "./fetch-instructions"
import { shouldUseSingleFileRead } from "@roo-code/types"
import { getWriteToFileDescription } from "./write-to-file"
import { getSearchFilesDescription } from "./search-files"
import { getListFilesDescription } from "./list-files"
import { getInsertContentDescription } from "./insert-content"
import { getSearchAndReplaceDescription } from "./search-and-replace"
import { getListCodeDefinitionNamesDescription } from "./list-code-definition-names"
import { getBrowserActionDescription } from "./browser-action"
import { getAskFollowupQuestionDescription } from "./ask-followup-question"
import { getAttemptCompletionDescription } from "./attempt-completion"
import { getUseMcpToolDescription } from "./use-mcp-tool"
import { getAccessMcpResourceDescription } from "./access-mcp-resource"
import { getSwitchModeDescription } from "./switch-mode"
import { getNewTaskDescription } from "./new-task"
import { getCodebaseSearchDescription } from "./codebase-search"
import { getUpdateTodoListDescription } from "./update-todo-list"
import { getRunSlashCommandDescription } from "./run-slash-command"
import { getGenerateImageDescription } from "./generate-image"
import { CodeIndexManager } from "../../../services/code-index/manager"
import { getToolRegistry } from "./schemas/tool-registry"
import { getToolAvailability, type ToolAvailabilityArgs } from "./tool-availability"

// kilocode_change start: Morph fast apply
import { isFastApplyAvailable } from "../../tools/editFileTool"
import { getEditFileDescription } from "./edit-file"
import { type ClineProviderState } from "../../webview/ClineProvider"
// kilocode_change end

// Map of tool names to their description functions
const toolDescriptionMap: Record<string, (args: ToolArgs) => string | undefined> = {
	execute_command: (args) => getExecuteCommandDescription(args),
	read_file: (args) => {
		// Check if the current model should use the simplified read_file tool
		const modelId = args.settings?.modelId
		if (modelId && shouldUseSingleFileRead(modelId)) {
			return getSimpleReadFileDescription(args)
		}
		return getReadFileDescription(args)
	},
	fetch_instructions: (args) => getFetchInstructionsDescription(args.settings?.enableMcpServerCreation),
	write_to_file: (args) => getWriteToFileDescription(args),
	search_files: (args) => getSearchFilesDescription(args),
	list_files: (args) => getListFilesDescription(args),
	list_code_definition_names: (args) => getListCodeDefinitionNamesDescription(args),
	browser_action: (args) => getBrowserActionDescription(args),
	ask_followup_question: () => getAskFollowupQuestionDescription(),
	attempt_completion: (args) => getAttemptCompletionDescription(args),
	use_mcp_tool: (args) => getUseMcpToolDescription(args),
	access_mcp_resource: (args) => getAccessMcpResourceDescription(args),
	codebase_search: (args) => getCodebaseSearchDescription(args),
	switch_mode: () => getSwitchModeDescription(),
	new_task: (args) => getNewTaskDescription(args),
	insert_content: (args) => getInsertContentDescription(args),
	search_and_replace: (args) => getSearchAndReplaceDescription(args),
	edit_file: () => getEditFileDescription(), // kilocode_change: Morph fast apply
	apply_diff: (args) =>
		args.diffStrategy ? args.diffStrategy.getToolDescription({ cwd: args.cwd, toolOptions: args.toolOptions }) : "",
	update_todo_list: (args) => getUpdateTodoListDescription(args),
	run_slash_command: () => getRunSlashCommandDescription(),
	generate_image: (args) => getGenerateImageDescription(args),
}

export function getToolDescriptionsForMode(
	mode: Mode,
	cwd: string,
	supportsComputerUse: boolean,
	codeIndexManager?: CodeIndexManager,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	mcpHub?: McpHub,
	customModes?: ModeConfig[],
	experiments?: Record<string, boolean>,
	partialReadsEnabled?: boolean,
	settings?: Record<string, any>,
	enableMcpServerCreation?: boolean,
	modelId?: string,
	clineProviderState?: ClineProviderState, // kilocode_change
): string {
	const toolAvailabilityArgs: ToolAvailabilityArgs = {
		mode,
		cwd,
		supportsComputerUse,
		codeIndexManager,
		diffStrategy,
		browserViewportSize,
		mcpHub,
		customModes,
		partialReadsEnabled,
		settings: {
			...settings,
			enableMcpServerCreation,
			modelId,
		},
		experiments,
		clineProviderState: clineProviderState!, // kilocode_change
	}

	const { xmlTools } = getToolAvailability(toolAvailabilityArgs)

	if (xmlTools.length === 0) {
		return ""
	}

	// Map tool descriptions for XML tools only
	const descriptions = xmlTools.map((toolName) => {
		const descriptionFn = toolDescriptionMap[toolName]
		if (!descriptionFn) {
			return undefined
		}

		return descriptionFn({
			...toolAvailabilityArgs,
			toolOptions: undefined, // No tool options in group-based approach
		})
	})

	return `# Tools\n\n${descriptions.filter(Boolean).join("\n\n")}`
}

// Export individual description functions for backward compatibility
export {
	getExecuteCommandDescription,
	getReadFileDescription,
	getSimpleReadFileDescription,
	getFetchInstructionsDescription,
	getWriteToFileDescription,
	getSearchFilesDescription,
	getListFilesDescription,
	getListCodeDefinitionNamesDescription,
	getBrowserActionDescription,
	getAskFollowupQuestionDescription,
	getAttemptCompletionDescription,
	getUseMcpToolDescription,
	getAccessMcpResourceDescription,
	getSwitchModeDescription,
	getInsertContentDescription,
	getSearchAndReplaceDescription,
	getEditFileDescription, // kilocode_change: Morph fast apply
	getCodebaseSearchDescription,
	getRunSlashCommandDescription,
	getGenerateImageDescription,
}

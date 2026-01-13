import type OpenAI from "openai"
import accessMcpResource from "./access_mcp_resource"
import { apply_diff } from "./apply_diff"
import applyPatch from "./apply_patch"
import askFollowupQuestion from "./ask_followup_question"
import attemptCompletion from "./attempt_completion"
import browserAction from "./browser_action"
import codebaseSearch from "./codebase_search"
import executeCommand from "./execute_command"
import fetchInstructions from "./fetch_instructions"
import generateImage from "./generate_image"
import listFiles from "./list_files"
import newTask from "./new_task"
import { createReadFileTool } from "./read_file"
import runSlashCommand from "./run_slash_command"
import searchAndReplace from "./search_and_replace"
import searchReplace from "./search_replace"
import searchFiles from "./search_files"
import switchMode from "./switch_mode"
import updateTodoList from "./update_todo_list"
import writeToFile from "./write_to_file"

import deleteFile from "./kilocode/delete_file"
import editFile from "./kilocode/edit_file"

export { getMcpServerTools } from "./mcp_server"
export { convertOpenAIToolToAnthropic, convertOpenAIToolsToAnthropic } from "./converters"

/**
 * Get native tools array, optionally customizing based on settings.
 *
 * @param partialReadsEnabled - Whether to include line_ranges support in read_file tool (default: true)
 * @returns Array of native tool definitions
 */
export function getNativeTools(partialReadsEnabled: boolean = true): OpenAI.Chat.ChatCompletionTool[] {
	return [
		// kilocode_change start
		deleteFile,
		editFile,
		// todo:
		// condenseTool,
		// newRuleTool,
		// reportBugTool,
		// kilocode_change end
		accessMcpResource,
		apply_diff,
		applyPatch,
		askFollowupQuestion,
		attemptCompletion,
		browserAction,
		codebaseSearch,
		executeCommand,
		fetchInstructions,
		generateImage,
		listFiles,
		newTask,
		createReadFileTool(partialReadsEnabled),
		runSlashCommand,
		searchAndReplace,
		searchReplace,
		searchFiles,
		switchMode,
		updateTodoList,
		writeToFile,
	] satisfies OpenAI.Chat.ChatCompletionTool[]
}

// Backward compatibility: export default tools with line ranges enabled
export const nativeTools = getNativeTools(true)

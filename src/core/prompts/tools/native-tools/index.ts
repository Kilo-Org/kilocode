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
import { createReadFileTool, type ReadFileToolOptions } from "./read_file"
import runSlashCommand from "./run_slash_command"
import searchAndReplace from "./search_and_replace"
import searchReplace from "./search_replace"
import edit_file from "./edit_file"
import searchFiles from "./search_files"
import switchMode from "./switch_mode"
import updateTodoList from "./update_todo_list"
import writeToFile from "./write_to_file"

import deleteFile from "./kilocode/delete_file"
import fastEditFile from "./kilocode/fast_edit_file"

export { getMcpServerTools } from "./mcp_server"
export { convertOpenAIToolToAnthropic, convertOpenAIToolsToAnthropic } from "./converters"
export type { ReadFileToolOptions } from "./read_file"

/**
 * Options for customizing the native tools array.
 */
export interface NativeToolsOptions {
	/** Whether to include line_ranges support in read_file tool (default: true) */
	partialReadsEnabled?: boolean
	/** Maximum number of files that can be read in a single read_file request (default: 5) */
	maxConcurrentFileReads?: number
}

/**
 * Get native tools array, optionally customizing based on settings.
 *
 * @param options - Configuration options for the tools
 * @returns Array of native tool definitions
 */
export function getNativeTools(options: NativeToolsOptions = {}): OpenAI.Chat.ChatCompletionTool[] {
	const { partialReadsEnabled = true, maxConcurrentFileReads = 5 } = options

	const readFileOptions: ReadFileToolOptions = {
		partialReadsEnabled,
		maxConcurrentFileReads,
	}

	return [
		// kilocode_change start
		deleteFile,
		fastEditFile,
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
		createReadFileTool(readFileOptions),
		runSlashCommand,
		searchAndReplace,
		searchReplace,
		edit_file,
		searchFiles,
		switchMode,
		updateTodoList,
		writeToFile,
	] satisfies OpenAI.Chat.ChatCompletionTool[]
}

// Backward compatibility: export default tools with line ranges enabled
export const nativeTools = getNativeTools()

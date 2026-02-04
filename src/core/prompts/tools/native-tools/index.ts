import type OpenAI from "openai"
import accessMcpResource from "./access_mcp_resource"
import { apply_diff } from "./apply_diff"
import applyPatch from "./apply_patch"
import askFollowupQuestion from "./ask_followup_question"
import attemptCompletion from "./attempt_completion"
import browserAction from "./browser_action"
import codebaseSearch from "./codebase_search"
import executeCommand from "./execute_command"
import generateImage from "./generate_image"
import listFiles from "./list_files"
import newTask from "./new_task"
import readCommandOutput from "./read_command_output"
import { createReadFileTool, type ReadFileToolOptions } from "./read_file"
import runSlashCommand from "./run_slash_command"
import skill from "./skill"
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
	/** Whether the model supports image processing (default: false) */
	supportsImages?: boolean
}

/**
 * Get native tools array, optionally customizing based on settings.
 *
 * @param options - Configuration options for the tools
 * @returns Array of native tool definitions
 */
export function getNativeTools(options: NativeToolsOptions = {}): OpenAI.Chat.ChatCompletionTool[] {
	const { supportsImages = false } = options

	const readFileOptions: ReadFileToolOptions = {
		supportsImages,
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
		generateImage,
		listFiles,
		newTask,
		readCommandOutput,
		createReadFileTool(readFileOptions),
		runSlashCommand,
		skill,
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

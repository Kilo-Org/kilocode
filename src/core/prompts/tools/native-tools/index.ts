import type OpenAI from "openai"
import askFollowupQuestion from "./ask_followup_question"
import attemptCompletion from "./attempt_completion"
import browserAction from "./browser_action"
import codebaseSearch from "./codebase_search"
import executeCommand from "./execute_command"
import fetchInstructions from "./fetch_instructions"
import generateImage from "./generate_image"
import insertContent from "./insert_content"
import listCodeDefinitionNames from "./list_code_definition_names"
import listFiles from "./list_files"
import newTask from "./new_task"
import { read_file } from "./read_file"
import runSlashCommand from "./run_slash_command"
import searchFiles from "./search_files"
import switchMode from "./switch_mode"
import updateTodoList from "./update_todo_list"
import writeToFile from "./write_to_file"
import { apply_diff_single_file } from "./apply_diff"

export { getMcpServerTools } from "./mcp_server"
export { convertOpenAIToolToAnthropic, convertOpenAIToolsToAnthropic } from "./converters"

export const nativeTools = [
	apply_diff_single_file,
	askFollowupQuestion,
	attemptCompletion,
	browserAction,
	codebaseSearch,
	executeCommand,
	fetchInstructions,
	generateImage,
	insertContent,
	listCodeDefinitionNames,
	listFiles,
	newTask,
	read_file,
	runSlashCommand,
	searchFiles,
	switchMode,
	updateTodoList,
	writeToFile,
] satisfies OpenAI.Chat.ChatCompletionTool[]

import { OpenAI } from "openai/client"
import askFollowupQuestion from "./ask_followup_question"
import attemptCompletion from "./attempt_completion"
import browser_action from "./browser_action"
import codebase_search from "./codebase_search"
import editFile from "./edit_file"
import fetchInstructions from "./fetch_instructions"
import generate_image from "./generate_image"
import insert_context from "./insert_content"
import list_code_definition_names from "./list_code_definition_names"
import list_files from "./list_files"
import newTask from "./new_task"
import { read_file_single, read_file_multi } from "./read_file"
import runSlashCommand from "./run_slash_command"
import search_files from "./search_files"
import switchMode from "./switch_mode"
import updateTodoList from "./update_todo_list"
import write_to_file from "./write_to_file"
import execute_command from "./execute_command"
import { apply_diff_single_file, apply_diff_multi_file } from "./apply_diff"

export default function getNativeTools(cwd: string): OpenAI.Chat.ChatCompletionTool[] {
	return [
		apply_diff_single_file,
		apply_diff_multi_file,
		askFollowupQuestion,
		attemptCompletion,
		browser_action(),
		codebase_search(cwd),
		editFile,
		fetchInstructions,
		execute_command(cwd),
		generate_image(cwd),
		insert_context(),
		list_code_definition_names(cwd),
		list_files(cwd),
		newTask,
		read_file_single(cwd),
		read_file_multi(cwd),
		runSlashCommand,
		search_files(cwd),
		switchMode,
		updateTodoList,
		write_to_file(cwd),
	]
}

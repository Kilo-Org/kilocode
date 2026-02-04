import type { ToolData } from "../../types.js"

export interface ToolRendererProps {
	toolData: ToolData
	rawContent?: string
}

export type ToolCategory =
	| "file-read"
	| "file-write"
	| "search"
	| "command"
	| "browser"
	| "mode"
	| "completion"
	| "other"

export function getToolCategory(toolName: string): ToolCategory {
	const fileReadTools = [
		"readFile",
		"read_file",
		"fetchInstructions",
		"fetch_instructions",
		"listFilesTopLevel",
		"listFilesRecursive",
		"list_files",
	]

	const fileWriteTools = [
		"editedExistingFile",
		"appliedDiff",
		"apply_diff",
		"newFileCreated",
		"write_to_file",
		"writeToFile",
	]

	const searchTools = ["searchFiles", "search_files", "codebaseSearch", "codebase_search"]
	const commandTools = ["execute_command", "executeCommand"]
	const browserTools = ["browser_action", "browserAction"]
	const modeTools = ["switchMode", "switch_mode", "newTask", "new_task", "finishTask"]
	const completionTools = ["attempt_completion", "attemptCompletion", "ask_followup_question", "askFollowupQuestion"]

	if (fileReadTools.includes(toolName)) return "file-read"
	if (fileWriteTools.includes(toolName)) return "file-write"
	if (searchTools.includes(toolName)) return "search"
	if (commandTools.includes(toolName)) return "command"
	if (browserTools.includes(toolName)) return "browser"
	if (modeTools.includes(toolName)) return "mode"
	if (completionTools.includes(toolName)) return "completion"
	return "other"
}

import type OpenAI from "openai"

const LIST_CODE_DEFINITION_NAMES_DESCRIPTION = `Request to list definition names (classes, functions, methods, etc.) from source code. This tool can analyze either a single file or all files at the top level of a specified directory. It provides insights into the codebase structure and important constructs, encapsulating high-level concepts and relationships that are crucial for understanding the overall architecture.

Parameters:
- path: (required) The path of the file or directory (relative to the current working directory) to analyze. When given a directory, it lists definitions from all top-level source files.

Examples:

1. List definitions from a specific file:
{ "path": "src/main.ts" }

2. List definitions from all files in a directory:
{ "path": "src/" }`

const PATH_PARAMETER_DESCRIPTION = `Path to the file or directory to analyze, relative to the workspace`

export default {
	type: "function",
	function: {
		name: "list_code_definition_names",
		description: LIST_CODE_DEFINITION_NAMES_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

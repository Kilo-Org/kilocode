import type OpenAI from "openai"

const LIST_FILES_DESCRIPTION = `Request to list files and directories within the specified directory. If recursive is true, it will list all files and directories recursively. If recursive is false or not provided, it will only list the top-level contents. Do not use this tool to confirm the existence of files you may have created, as the user will let you know if the files were created successfully or not.

Parameters:
- path: (required) The path of the directory to list contents for (relative to the current workspace directory)
- recursive: (required) Whether to list files recursively. Use true for recursive listing, false for top-level only.

Example: Listing all files in the current directory (top-level only)
{ "path": ".", "recursive": false }

Example: Listing all files recursively in src directory
{ "path": "src", "recursive": true }`

const PATH_PARAMETER_DESCRIPTION = `Directory path to inspect, relative to the workspace`

const RECURSIVE_PARAMETER_DESCRIPTION = `Set true to list contents recursively; false to show only the top level`

export default {
	type: "function",
	function: {
		name: "list_files",
		description: LIST_FILES_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				recursive: {
					type: "boolean",
					description: RECURSIVE_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path", "recursive"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

import type OpenAI from "openai"

const INSERT_CONTENT_DESCRIPTION = `Use this tool specifically for adding new lines of content into a file without modifying existing content. Specify the line number to insert before, or use line 0 to append to the end. Ideal for adding imports, functions, configuration blocks, log entries, or any multi-line text block.

Parameters:
- path: (required) File path relative to workspace
- line: (required) Line number where content will be inserted (1-based). Use 0 to append at end of file. Use any positive number to insert before that line
- content: (required) The content to insert at the specified line

Example for inserting imports at start of file:
{ "path": "src/utils.ts", "line": 1, "content": "// Add imports at start of file\\nimport { sum } from './math';" }

Example for appending to the end of file:
{ "path": "src/utils.ts", "line": 0, "content": "// This is the end of the file" }`

const PATH_PARAMETER_DESCRIPTION = `File path to modify, expressed relative to the workspace`

const LINE_PARAMETER_DESCRIPTION = `1-based line number to insert before, or 0 to append at the end of the file`

const CONTENT_PARAMETER_DESCRIPTION = `Exact text to insert at the chosen location`

export default {
	type: "function",
	function: {
		name: "insert_content",
		description: INSERT_CONTENT_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				line: {
					type: "integer",
					description: LINE_PARAMETER_DESCRIPTION,
					minimum: 0,
				},
				content: {
					type: "string",
					description: CONTENT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path", "line", "content"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
